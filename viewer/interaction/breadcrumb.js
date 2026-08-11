/**
 * Breadcrumb Navigation — §4.4.6
 * 
 * Handles combo breadcrumb trail click behavior:
 * - Clicking mid-trail segment collapses combos below it
 * - Clears selection below clicked level
 * - Preserves active search term and slider values
 * - Clamps collapse depth on pathologically large combos
 */

import { logger } from '../perf/logger.js';

export class BreadcrumbHandler {
  /**
   * @param {Object} options
   * @param {Object} options.stateStore - State store for getting/setting filters, selection, etc.
   * @param {import('./combo-depth.js').ComboDepthController} options.comboDepthController
   * @param {(level: number) => void} options.onCollapse - Callback when collapse occurs
   * @param {() => Object} options.getIndexes - Function to get current graph indexes
   */
  constructor(options) {
    this.stateStore = options.stateStore;
    this.comboDepthController = options.comboDepthController;
    this.onCollapse = options.onCollapse;
    this.getIndexes = options.getIndexes;
    
    // Current breadcrumb trail state
    this._trail = []; // Array of {level, comboId, comboName, depth}
    this._activeLevel = -1; // Currently expanded level (-1 = root)
    
    // Budget clamp for pathological combos
    this._maxSubtreeSize = 5000; // Max nodes allowed in collapsed subtree
    
    // State preservation
    this._preservedState = {
      searchTerm: '',
      sliderValues: null
    };
  }
  
  /**
   * Update breadcrumb trail based on current combo expansion state
   * 
   * @param {Array} trail - Array of expanded combo levels
   */
  updateTrail(trail) {
    this._trail = trail;
    this._activeLevel = trail.length > 0 ? trail[trail.length - 1].level : -1;
  }
  
  /**
   * Handle click on a breadcrumb segment
   * 
   * @param {number} clickedLevel - The level that was clicked
   * @returns {Object} Collapse result with affected combo IDs
   */
  handleSegmentClick(clickedLevel) {
    logger.debug('breadcrumb', `Clicked breadcrumb level: ${clickedLevel}`);
    
    // Preserve current search and slider state BEFORE any changes
    this._preserveState();
    
    const indexes = this.getIndexes();
    if (!indexes) {
      logger.warn('breadcrumb', 'No indexes available for breadcrumb collapse');
      return { success: false, reason: 'no_indexes' };
    }
    
    // Find the combo at the clicked level
    const clickedSegment = this._trail[clickedLevel];
    if (!clickedSegment) {
      logger.warn('breadcrumb', `Invalid breadcrumb level: ${clickedLevel}`);
      return { success: false, reason: 'invalid_level' };
    }
    
    // Get all combo IDs below the clicked level (these will be collapsed)
    const combosToCollapse = [];
    for (let i = clickedLevel + 1; i < this._trail.length; i++) {
      combosToCollapse.push(this._trail[i].comboId);
    }
    
    // Check for pathological combo sizes and clamp if needed
    const clampedCombos = this._clampPathologicalCombos(combosToCollapse, indexes);
    
    // Clear selection for nodes below clicked level
    this._clearSelectionBelowLevel(clickedLevel);
    
    // Perform the collapse
    this._performCollapse(clickedLevel, clampedCombos);
    
    // Restore preserved state (search term, slider values)
    this._restoreState();
    
    logger.info('breadcrumb', 
      `Collapsed ${clampedCombos.length} combos below level ${clickedLevel}`,
      { clickedLevel, combosCollapsed: clampedCombos.length, preservedSearch: this._preservedState.searchTerm }
    );
    
    return {
      success: true,
      clickedLevel,
      combosCollapsed: clampedCombos,
      selectionCleared: true
    };
  }
  
  /**
   * Preserve current search term and slider values before collapse
   */
  _preserveState() {
    const currentState = this.stateStore.getState?.();
    
    if (currentState) {
      // Preserve search term
      this._preservedState.searchTerm = currentState.searchQuery || '';
      
      // Preserve slider values
      this._preservedState.sliderValues = {
        metricMin: currentState.metricSliderMin,
        metricMax: currentState.metricSliderMax,
        metricField: currentState.metricSliderField,
        buildStageMin: currentState.buildStageSliderMin,
        buildStageMax: currentState.buildStageSliderMax
      };
    }
    
    logger.debug('breadcrumb', 'Preserved state before collapse', this._preservedState);
  }
  
  /**
   * Restore search term and slider values after collapse
   */
  _restoreState() {
    // Restore search term
    if (this._preservedState.searchTerm && this.stateStore.setSearchQuery) {
      this.stateStore.setSearchQuery(this._preservedState.searchTerm);
    }
    
    // Restore slider values
    if (this._preservedState.sliderValues && this.stateStore.setSliderValues) {
      this.stateStore.setSliderValues(this._preservedState.sliderValues);
    }
    
    logger.debug('breadcrumb', 'Restored state after collapse', this._preservedState);
  }
  
  /**
   * Clear selection for nodes below the clicked breadcrumb level
   */
  _clearSelectionBelowLevel(clickedLevel) {
    const currentSelection = this.stateStore.getSelection?.();
    
    if (!currentSelection || !currentSelection.nodeId) {
      // No selection to clear
      return;
    }
    
    // Check if selected node is below clicked level
    const selectedNodeDepth = this._getNodeComboDepth(currentSelection.nodeId);
    const clickedDepth = this._trail[clickedLevel]?.depth || 0;
    
    if (selectedNodeDepth > clickedDepth) {
      // Selected node is below clicked level - clear selection
      logger.debug('breadcrumb', `Clearing selection: node depth ${selectedNodeDepth} > clicked depth ${clickedDepth}`);
      
      if (this.stateStore.clearSelection) {
        this.stateStore.clearSelection();
      }
    }
  }
  
  /**
   * Get the combo depth for a node
   * 
   * @param {string} nodeId
   * @returns {number}
   */
  _getNodeComboDepth(nodeId) {
    const indexes = this.getIndexes();
    if (!indexes || !indexes.nodeToComboDepth) {
      return 0;
    }
    
    const nodeIndex = indexes.nodeIdToIndex?.[nodeId];
    if (nodeIndex === undefined) {
      return 0;
    }
    
    return indexes.nodeToComboDepth[nodeIndex] || 0;
  }
  
  /**
   * Clamp pathological combos that would exceed budget
   * 
   * @param {string[]} comboIds - Combo IDs to potentially clamp
   * @param {Object} indexes - Graph indexes
   * @returns {string[]} Clamped combo IDs (may be subset)
   */
  _clampPathologicalCombos(comboIds, indexes) {
    if (!indexes.comboSizes) {
      // No size info - return all combos
      return comboIds;
    }
    
    const clamped = [];
    
    for (const comboId of comboIds) {
      const size = indexes.comboSizes[comboId] || 0;
      
      if (size > this._maxSubtreeSize) {
        logger.warn('breadcrumb', 
          `Clamping pathological combo: ${comboId} has ${size} nodes (max: ${this._maxSubtreeSize})`,
          { comboId, size, max: this._maxSubtreeSize }
        );
        // Skip this combo - don't collapse it to avoid performance issues
      } else {
        clamped.push(comboId);
      }
    }
    
    return clamped;
  }
  
  /**
   * Perform the actual collapse operation
   * 
   * @param {number} clickedLevel
   * @param {string[]} combosToCollapse
   */
  _performCollapse(clickedLevel, combosToCollapse) {
    // Update trail to remove collapsed levels
    this._trail = this._trail.slice(0, clickedLevel + 1);
    this._activeLevel = clickedLevel;
    
    // Update combo depth controller
    if (this.comboDepthController) {
      const newDepth = this._trail[clickedLevel]?.depth || 0;
      this.comboDepthController.setDepth(newDepth);
    }
    
    // Notify callback
    if (this.onCollapse) {
      this.onCollapse(clickedLevel);
    }
  }
  
  /**
   * Get current breadcrumb trail
   * 
   * @returns {Array}
   */
  getTrail() {
    return [...this._trail];
  }
  
  /**
   * Get active level
   * 
   * @returns {number}
   */
  getActiveLevel() {
    return this._activeLevel;
  }
  
  /**
   * Reset breadcrumb state
   */
  reset() {
    this._trail = [];
    this._activeLevel = -1;
    this._preservedState = {
      searchTerm: '',
      sliderValues: null
    };
  }
}

// Export factory function
export function createBreadcrumbHandler(options) {
  return new BreadcrumbHandler(options);
}
