/**
 * Hover Interaction — §4.4.3
 * 
 * Handles hover interactions with budget enforcement (≤200 nodes).
 * Unsorted neighbor list, no sorting calls allowed.
 * Suppresses during slider drag or rapid pan/zoom.
 */

import { logger } from '../perf/logger.js';

export class HoverHandler {
  /**
   * @param {Object} options
   * @param {Object} options.indexes - Graph indexes
   * @param {number} options.budget - Maximum nodes to return (default 200)
   * @param {() => boolean} options.isInteractionActive - Function to check if slider/pan is active
   * @param {(nodeIds: string[]) => void} options.onHover - Callback with hovered node IDs
   */
  constructor(options) {
    this.indexes = options.indexes;
    this.budget = options.budget || 200;
    this.isInteractionActive = options.isInteractionActive;
    this.onHover = options.onHover;
    
    // Current hover state
    this._currentHoverNodeId = null;
    this._hoveredNodeIds = [];
    
    // Performance tracking
    this._sortCallCount = 0;
    this._lastComputationTime = 0;
  }
  
  /**
   * Handle hover event on a node
   * 
   * @param {string} nodeId - The hovered node ID
   * @returns {string[]|null} Array of visible neighbor node IDs (budget-limited), or null if suppressed
   */
  handleHover(nodeId) {
    const startTime = performance.now();
    
    // Suppress if interaction is active (slider drag, rapid pan)
    if (this.isInteractionActive && this.isInteractionActive()) {
      logger.debug('hover', 'Suppressing hover during active interaction');
      return null;
    }
    
    // Clear previous hover
    this._currentHoverNodeId = nodeId;
    
    // Get neighbors for this node
    const neighborIndices = this._getNeighborIndices(nodeId);
    
    if (!neighborIndices || neighborIndices.length === 0) {
      this._hoveredNodeIds = [];
      this._finishHover([]);
      return [];
    }
    
    // Verify no sort was called (budget constraint)
    const initialSortCount = this._sortCallCount;
    
    // Convert indices to IDs and apply budget
    const resultIds = [];
    let count = 0;
    
    for (let i = 0; i < neighborIndices.length && count < this.budget; i++) {
      const idx = neighborIndices[i];
      const id = this.indexes.nodeIndexToId[idx];
      if (id) {
        resultIds.push(id);
        count++;
      }
    }
    
    // Verify no sort was called during this operation
    if (this._sortCallCount > initialSortCount) {
      logger.error('hover', 
        `Budget violation: ${this._sortCallCount - initialSortCount} sort calls made`,
        { nodeId, budget: this.budget }
      );
    }
    
    this._hoveredNodeIds = resultIds;
    this._lastComputationTime = performance.now() - startTime;
    
    // Log if hub node detected (many neighbors but truncated)
    if (neighborIndices.length > this.budget) {
      logger.info('hover', 
        `Hub node detected: ${neighborIndices.length} neighbors, showing ${resultIds.length}`,
        { nodeId, totalNeighbors: neighborIndices.length, shown: resultIds.length }
      );
    }
    
    this._finishHover(resultIds);
    return resultIds;
  }
  
  /**
   * Get neighbor indices for a node
   * Uses pre-built nodeToNeighbors index
   * 
   * @param {string} nodeId
   * @returns {number[]|null}
   */
  _getNeighborIndices(nodeId) {
    const nodeIndex = this.indexes.nodeIdToIndex[nodeId];
    if (nodeIndex === undefined) {
      logger.warn('hover', `Unknown node ID: ${nodeId}`);
      return null;
    }
    
    // Get both incoming and outgoing neighbors
    const neighbors = new Set();
    
    // Outgoing neighbors
    const outgoing = this.indexes.nodeToOutgoing[nodeIndex];
    if (outgoing) {
      for (let i = 0; i < outgoing.length; i++) {
        neighbors.add(outgoing[i]);
      }
    }
    
    // Incoming neighbors
    const incoming = this.indexes.nodeToIncoming[nodeIndex];
    if (incoming) {
      for (let i = 0; i < incoming.length; i++) {
        neighbors.add(incoming[i]);
      }
    }
    
    // Convert to array (no sorting!)
    return Array.from(neighbors);
  }
  
  /**
   * Finish hover processing and notify callback
   * 
   * @param {string[]} nodeIds
   */
  _finishHover(nodeIds) {
    if (this.onHover) {
      this.onHover(nodeIds);
    }
  }
  
  /**
   * Clear current hover state
   */
  clearHover() {
    this._currentHoverNodeId = null;
    this._hoveredNodeIds = [];
    this._finishHover([]);
  }
  
  /**
   * Get current hover state
   * 
   * @returns {{nodeId: string|null, neighborIds: string[]}}
   */
  getCurrentState() {
    return {
      nodeId: this._currentHoverNodeId,
      neighborIds: this._hoveredNodeIds
    };
  }
  
  /**
   * Get performance metrics
   * 
   * @returns {{sortCallCount: number, lastComputationTime: number}}
   */
  getMetrics() {
    return {
      sortCallCount: this._sortCallCount,
      lastComputationTime: this._lastComputationTime
    };
  }
  
  /**
   * Reset performance tracking (for testing)
   */
  resetMetrics() {
    this._sortCallCount = 0;
    this._lastComputationTime = 0;
  }
}

// Export factory function
export function createHoverHandler(options) {
  return new HoverHandler(options);
}
