/**
 * Spatial Culling - Viewport-based node/edge visibility culling
 * Spec §4.9.1: spatialIndex/comboSpatialIndex viewport queries
 */

import { logDebug } from './logger.js';

class SpatialCuller {
  constructor(spatialIndex, comboSpatialIndex) {
    this.spatialIndex = spatialIndex;
    this.comboSpatialIndex = comboSpatialIndex;
    this.viewport = null;
    this.cachedVisibleNodes = null;
    this.cachedVisibleCombos = null;
    this.lastViewportKey = null;
  }
  
  /**
   * Update viewport bounds
   */
  setViewport(viewport) {
    const key = `${viewport.centerX},${viewport.centerY},${viewport.zoom},${viewport.width},${viewport.height}`;
    
    // Cache hit?
    if (key === this.lastViewportKey) {
      return {
        nodes: this.cachedVisibleNodes,
        combos: this.cachedVisibleCombos
      };
    }
    
    this.viewport = viewport;
    this.lastViewportKey = key;
    
    // Calculate world-space bounds
    const halfWidth = (viewport.width / 2) / viewport.zoom;
    const halfHeight = (viewport.height / 2) / viewport.zoom;
    
    this.viewportBounds = {
      minX: viewport.centerX - halfWidth,
      maxX: viewport.centerX + halfWidth,
      minY: viewport.centerY - halfHeight,
      maxY: viewport.centerY + halfHeight
    };
    
    // Query spatial indexes
    this.cachedVisibleNodes = this.queryNodeIndex();
    this.cachedVisibleCombos = this.queryComboIndex();
    
    logDebug('culling', `Viewport updated: ${this.cachedVisibleNodes.length} nodes, ${this.cachedVisibleCombos.length} combos visible`);
    
    return {
      nodes: this.cachedVisibleNodes,
      combos: this.cachedVisibleCombos
    };
  }
  
  /**
   * Query node spatial index
   */
  queryNodeIndex() {
    if (!this.spatialIndex || !this.viewportBounds) {
      return [];
    }
    
    const { minX, maxX, minY, maxY } = this.viewportBounds;
    return this.spatialIndex.rangeQuery(minX, maxX, minY, maxY);
  }
  
  /**
   * Query combo spatial index
   */
  queryComboIndex() {
    if (!this.comboSpatialIndex || !this.viewportBounds) {
      return [];
    }
    
    const { minX, maxX, minY, maxY } = this.viewportBounds;
    return this.comboSpatialIndex.rangeQuery(minX, maxX, minY, maxY);
  }
  
  /**
   * Check if a specific node is visible in viewport
   */
  isNodeVisible(nodeId, nodeBounds) {
    if (!this.viewportBounds || !nodeBounds) {
      return true; // Conservative: assume visible if we can't determine
    }
    
    return !(
      nodeBounds.x < this.viewportBounds.minX ||
      nodeBounds.x > this.viewportBounds.maxX ||
      nodeBounds.y < this.viewportBounds.minY ||
      nodeBounds.y > this.viewportBounds.maxY
    );
  }
  
  /**
   * Check if a specific combo is visible in viewport
   */
  isComboVisible(comboId, comboBounds) {
    if (!this.viewportBounds || !comboBounds) {
      return true; // Conservative: assume visible if we can't determine
    }
    
    return !(
      comboBounds.minX < this.viewportBounds.minX && comboBounds.maxX < this.viewportBounds.minX ||
      comboBounds.minX > this.viewportBounds.maxX && comboBounds.maxX > this.viewportBounds.maxX ||
      comboBounds.minY < this.viewportBounds.minY && comboBounds.maxY < this.viewportBounds.minY ||
      comboBounds.minY > this.viewportBounds.maxY && comboBounds.maxY > this.viewportBounds.maxY
    );
  }
  
  /**
   * Get culling statistics
   */
  getStats() {
    const totalNodes = this.spatialIndex?.size ?? 0;
    const totalCombos = this.comboSpatialIndex?.size ?? 0;
    const visibleNodes = this.cachedVisibleNodes?.length ?? 0;
    const visibleCombos = this.cachedVisibleCombos?.length ?? 0;
    
    return {
      totalNodes,
      visibleNodes,
      culledNodes: totalNodes - visibleNodes,
      nodeVisibilityRatio: totalNodes > 0 ? visibleNodes / totalNodes : 0,
      totalCombos,
      visibleCombos,
      culledCombos: totalCombos - visibleCombos,
      comboVisibilityRatio: totalCombos > 0 ? visibleCombos / totalCombos : 0,
      viewport: this.viewportBounds
    };
  }
  
  /**
   * Clear cached results (forces re-query on next setViewport)
   */
  clearCache() {
    this.cachedVisibleNodes = null;
    this.cachedVisibleCombos = null;
    this.lastViewportKey = null;
  }
}

export default SpatialCuller;
