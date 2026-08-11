/**
 * Visibility Resolver — §4.4.1
 * 
 * Computes the intersection of all active filter dimensions using Uint8Array masks.
 * Each dimension produces a mask where 1 = visible, 0 = hidden.
 * The final visible set is the bitwise AND of all dimension masks.
 * 
 * Performance contract:
 * - Changing one filter dimension recomputes only that dimension's mask + the final AND pass
 * - On 100k nodes, single-dimension change completes within documented time budget (logged)
 */

import { logger } from '../perf/logger.js';

/**
 * @typedef {Object} FilterMasks
 * @property {Uint8Array} metricSlider - Mask for metric slider filter
 * @property {Uint8Array} buildStageSlider - Mask for build stage slider filter
 * @property {Uint8Array} kindFilter - Mask for kind/type filter
 * @property {Uint8Array} searchFilter - Mask for search results
 * @property {Uint8Array} comboDepthFilter - Mask for combo depth visibility
 */

/**
 * @typedef {Object} ResolverResult
 * @property {Uint8Array} finalMask - Bitwise AND of all dimension masks
 * @property {number} visibleCount - Number of visible nodes
 * @property {Record<string, number>} perDimensionCounts - Visible count per dimension
 * @property {number} computationTimeMs - Time taken to compute
 */

export class VisibilityResolver {
  /**
   * @param {Object} indexes - Pre-built indexes from core/indexes.js
   * @param {number} indexes.nodeCount - Total node count
   * @param {Float64Array} indexes.sortedBuildCost - Sorted build costs
   * @param {Float64Array} indexes.sortedBottleneckScore - Sorted bottleneck scores
   * @param {Int32Array} indexes.sortedBlastRadius - Sorted blast radius values
   * @param {Int32Array} indexes.nodeToKind - Node kind indices
   * @param {string[]} indexes.kindLabels - Kind label mapping
   * @param {Int32Array} indexes.nodeToComboDepth - Combo depth per node
   */
  constructor(indexes) {
    this.indexes = indexes;
    this.nodeCount = indexes.nodeCount;
    
    // Cached masks - reused to avoid allocation churn
    this._metricMask = new Uint8Array(this.nodeCount);
    this._buildStageMask = new Uint8Array(this.nodeCount);
    this._kindMask = new Uint8Array(this.nodeCount);
    this._searchMask = new Uint8Array(this.nodeCount);
    this._comboDepthMask = new Uint8Array(this.nodeCount);
    
    // Final computed mask
    this._finalMask = new Uint8Array(this.nodeCount);
    
    // Current filter state
    this._currentFilters = {
      metricMin: 0,
      metricMax: 1,
      metricField: 'buildCost', // 'buildCost' | 'bottleneckScore' | 'blastRadius'
      buildStageMin: 0,
      buildStageMax: 1,
      allowedKinds: null, // null = all kinds allowed
      searchResultIndices: null, // Int32Array of matching node indices
      maxComboDepth: Infinity
    };
    
    // Performance tracking
    this._lastComputationTime = 0;
    this._dimensionCallCounts = {
      metricSlider: 0,
      buildStageSlider: 0,
      kindFilter: 0,
      searchFilter: 0,
      comboDepthFilter: 0
    };
  }
  
  /**
   * Update a single filter dimension and recompute visibility
   * Only recomputes the changed dimension's mask + final AND pass
   * 
   * @param {string} dimension - Which dimension changed
   * @param {Object} filterValue - The new filter value (dimension-specific)
   * @returns {ResolverResult} Updated visibility result
   */
  updateFilter(dimension, filterValue) {
    const startTime = performance.now();
    
    // Update the specific dimension's state and compute its mask
    switch (dimension) {
      case 'metricSlider':
        this._currentFilters.metricMin = filterValue.min;
        this._currentFilters.metricMax = filterValue.max;
        this._currentFilters.metricField = filterValue.field || 'buildCost';
        this._computeMetricMask();
        this._dimensionCallCounts.metricSlider++;
        break;
        
      case 'buildStageSlider':
        this._currentFilters.buildStageMin = filterValue.min;
        this._currentFilters.buildStageMax = filterValue.max;
        this._computeBuildStageMask();
        this._dimensionCallCounts.buildStageSlider++;
        break;
        
      case 'kindFilter':
        this._currentFilters.allowedKinds = filterValue.allowedKinds;
        this._computeKindMask();
        this._dimensionCallCounts.kindFilter++;
        break;
        
      case 'searchFilter':
        this._currentFilters.searchResultIndices = filterValue.resultIndices;
        this._computeSearchMask();
        this._dimensionCallCounts.searchFilter++;
        break;
        
      case 'comboDepthFilter':
        this._currentFilters.maxComboDepth = filterValue.maxDepth;
        this._computeComboDepthMask();
        this._dimensionCallCounts.comboDepthFilter++;
        break;
        
      default:
        logger.warn('resolver', `Unknown filter dimension: ${dimension}`);
        return this.getResult();
    }
    
    // Recompute final AND pass
    this._computeFinalMask();
    
    const endTime = performance.now();
    this._lastComputationTime = endTime - startTime;
    
    // Log if exceeding budget on large graphs (>500ms on 100k nodes)
    if (this.nodeCount >= 100000 && this._lastComputationTime > 500) {
      logger.warn('resolver', 
        `Filter computation took ${this._lastComputationTime.toFixed(2)}ms on ${this.nodeCount} nodes`,
        { dimension, budget: 500 }
      );
    }
    
    return this.getResult();
  }
  
  /**
   * Compute metric slider mask based on current min/max/field
   * Handles null values by placing them at the end (hidden when filtering)
   */
  _computeMetricMask() {
    const { metricField, metricMin, metricMax } = this._currentFilters;
    const mask = this._metricMask;
    
    // Get the appropriate sorted array and null flags
    let values;
    let nullFlags;
    
    switch (metricField) {
      case 'buildCost':
        values = this.indexes.sortedBuildCost;
        nullFlags = this.indexes.buildCostNullFlags;
        break;
      case 'bottleneckScore':
        values = this.indexes.sortedBottleneckScore;
        nullFlags = this.indexes.bottleneckScoreNullFlags;
        break;
      case 'blastRadius':
        values = this.indexes.sortedBlastRadius;
        nullFlags = this.indexes.blastRadiusNullFlags;
        break;
      default:
        values = this.indexes.sortedBuildCost;
        nullFlags = this.indexes.buildCostNullFlags;
    }
    
    // Compute mask: 1 if value in [min, max] and not null, 0 otherwise
    for (let i = 0; i < this.nodeCount; i++) {
      if (nullFlags && nullFlags[i]) {
        // Null values are always hidden when filtering by metric
        mask[i] = 0;
      } else {
        const normalizedValue = values[i];
        mask[i] = (normalizedValue >= metricMin && normalizedValue <= metricMax) ? 1 : 0;
      }
    }
  }
  
  /**
   * Compute build stage slider mask
   * Build stages are already normalized to [0, 1] range
   */
  _computeBuildStageMask() {
    const { buildStageMin, buildStageMax } = this._currentFilters;
    const mask = this._buildStageMask;
    const stages = this.indexes.sortedBuildStages;
    
    for (let i = 0; i < this.nodeCount; i++) {
      mask[i] = (stages[i] >= buildStageMin && stages[i] <= buildStageMax) ? 1 : 0;
    }
  }
  
  /**
   * Compute kind filter mask
   * If allowedKinds is null, all kinds are visible
   */
  _computeKindMask() {
    const { allowedKinds } = this._currentFilters;
    const mask = this._kindMask;
    const nodeToKind = this.indexes.nodeToKind;
    
    if (allowedKinds === null) {
      // All kinds allowed - set all to 1
      mask.fill(1);
      return;
    }
    
    // Create a lookup set for O(1) kind checking
    const allowedSet = new Set(allowedKinds);
    
    for (let i = 0; i < this.nodeCount; i++) {
      const kindIndex = nodeToKind[i];
      mask[i] = allowedSet.has(kindIndex) ? 1 : 0;
    }
  }
  
  /**
   * Compute search filter mask
   * Only nodes in searchResultIndices are visible (if search is active)
   */
  _computeSearchMask() {
    const { searchResultIndices } = this._currentFilters;
    const mask = this._searchMask;
    
    if (searchResultIndices === null || searchResultIndices.length === 0) {
      // No search active - all nodes visible
      mask.fill(1);
      return;
    }
    
    // Clear mask first
    mask.fill(0);
    
    // Set only matching indices to 1
    for (let i = 0; i < searchResultIndices.length; i++) {
      const nodeIndex = searchResultIndices[i];
      if (nodeIndex >= 0 && nodeIndex < this.nodeCount) {
        mask[nodeIndex] = 1;
      }
    }
  }
  
  /**
   * Compute combo depth filter mask
   * Only nodes at or above the maxComboDepth are visible
   */
  _computeComboDepthMask() {
    const { maxComboDepth } = this._currentFilters;
    const mask = this._comboDepthMask;
    const nodeToComboDepth = this.indexes.nodeToComboDepth;
    
    if (maxComboDepth === Infinity) {
      // No depth limit - all nodes visible
      mask.fill(1);
      return;
    }
    
    for (let i = 0; i < this.nodeCount; i++) {
      mask[i] = (nodeToComboDepth[i] <= maxComboDepth) ? 1 : 0;
    }
  }
  
  /**
   * Compute final mask as bitwise AND of all dimension masks
   */
  _computeFinalMask() {
    const final = this._finalMask;
    
    // Start with all 1s, then AND with each dimension
    for (let i = 0; i < this.nodeCount; i++) {
      final[i] = 1;
    }
    
    // AND with each dimension mask
    for (let i = 0; i < this.nodeCount; i++) {
      final[i] &= this._metricMask[i];
      final[i] &= this._buildStageMask[i];
      final[i] &= this._kindMask[i];
      final[i] &= this._searchMask[i];
      final[i] &= this._comboDepthMask[i];
    }
  }
  
  /**
   * Get the current visibility result
   * 
   * @returns {ResolverResult} Current visibility state
   */
  getResult() {
    const final = this._finalMask;
    let visibleCount = 0;
    
    for (let i = 0; i < this.nodeCount; i++) {
      if (final[i] === 1) visibleCount++;
    }
    
    // Compute per-dimension counts
    const perDimensionCounts = {
      metricSlider: this._countVisible(this._metricMask),
      buildStageSlider: this._countVisible(this._buildStageMask),
      kindFilter: this._countVisible(this._kindMask),
      searchFilter: this._countVisible(this._searchMask),
      comboDepthFilter: this._countVisible(this._comboDepthMask)
    };
    
    return {
      finalMask: this._finalMask,
      visibleCount,
      perDimensionCounts,
      computationTimeMs: this._lastComputationTime
    };
  }
  
  /**
   * Count visible nodes in a mask
   * @param {Uint8Array} mask 
   * @returns {number}
   */
  _countVisible(mask) {
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 1) count++;
    }
    return count;
  }
  
  /**
   * Get call counts per dimension (for testing/verification)
   * @returns {Record<string, number>}
   */
  getDimensionCallCounts() {
    return { ...this._dimensionCallCounts };
  }
  
  /**
   * Reset all filters to default state (all visible)
   */
  reset() {
    this._currentFilters = {
      metricMin: 0,
      metricMax: 1,
      metricField: 'buildCost',
      buildStageMin: 0,
      buildStageMax: 1,
      allowedKinds: null,
      searchResultIndices: null,
      maxComboDepth: Infinity
    };
    
    // Set all masks to 1 (all visible)
    this._metricMask.fill(1);
    this._buildStageMask.fill(1);
    this._kindMask.fill(1);
    this._searchMask.fill(1);
    this._comboDepthMask.fill(1);
    this._finalMask.fill(1);
    
    this._dimensionCallCounts = {
      metricSlider: 0,
      buildStageSlider: 0,
      kindFilter: 0,
      searchFilter: 0,
      comboDepthFilter: 0
    };
    
    this._lastComputationTime = 0;
  }
}

// Export singleton factory function
export function createResolver(indexes) {
  return new VisibilityResolver(indexes);
}
