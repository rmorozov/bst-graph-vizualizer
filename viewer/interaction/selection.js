/**
 * Selection & Neighborhood — §4.4.4
 * 
 * Handles node selection with prioritized truncation and budget enforcement.
 * Ensures zero dangling edges: every rendered edge has both endpoints present.
 * Critical nodes outrank non-critical regardless of hop distance.
 */

import { logger } from '../perf/logger.js';

export class SelectionHandler {
  /**
   * @param {Object} options
   * @param {Object} options.indexes - Graph indexes (nodeToNeighbors, nodeIndexToId, etc.)
   * @param {Object} options.graphData - Full graph data (nodes/edges arrays)
   * @param {number} options.budget - Maximum nodes to include in selection (default 500)
   * @param {(nodeIds: string[], truncated: boolean, total: number) => void} options.onSelect - Callback
   */
  constructor(options) {
    this.indexes = options.indexes;
    this.graphData = options.graphData;
    this.budget = options.budget || 500;
    this.onSelect = options.onSelect;
    
    // Current selection state
    this._selectedNodeId = null;
    this._selectedNodeIds = new Set();
    this._truncated = false;
    this._totalCount = 0;
    
    // Build critical node lookup for fast ranking
    this._criticalNodeIndices = new Set();
    if (graphData.nodes) {
      for (let i = 0; i < graphData.nodes.length; i++) {
        const node = graphData.nodes[i];
        if (node.isCritical) {
          this._criticalNodeIndices.add(i);
        }
      }
    }
  }
  
  /**
   * Select a node and compute its neighborhood within budget
   * 
   * Prioritization rules:
   * 1. Selected node (always included)
   * 2. Critical nodes in neighborhood (any hop distance)
   * 3. Non-critical nodes by hop distance (1st hop before 2nd hop)
   * 
   * Zero dangling edges guarantee:
   * - Every edge in the rendered output has both endpoints in the selected set
   * - Edges are filtered AFTER node selection to ensure this
   * 
   * @param {string} nodeId - The selected node ID
   * @returns {{nodeIds: string[], edgeIds: string[], truncated: boolean, total: number}}
   */
  selectNode(nodeId) {
    logger.debug('selection', `Selecting node: ${nodeId}`);
    
    const nodeIndex = this.indexes.nodeIdToIndex[nodeId];
    if (nodeIndex === undefined) {
      logger.warn('selection', `Unknown node ID: ${nodeId}`);
      return { nodeIds: [], edgeIds: [], truncated: false, total: 0 };
    }
    
    this._selectedNodeId = nodeId;
    this._selectedNodeIds.clear();
    this._selectedNodeIds.add(nodeIndex);
    
    // Collect neighbors by hop distance
    const neighborsByHop = this._collectNeighborsByHop(nodeIndex);
    
    // Separate critical and non-critical nodes
    const criticalNodes = [];
    const nonCriticalByHop = { 1: [], 2: [], 3: [] };
    
    for (const [hopDistance, indices] of Object.entries(neighborsByHop)) {
      for (const idx of indices) {
        if (this._criticalNodeIndices.has(idx)) {
          criticalNodes.push(idx);
        } else {
          const hop = parseInt(hopDistance);
          if (nonCriticalByHop[hop]) {
            nonCriticalByHop[hop].push(idx);
          }
        }
      }
    }
    
    // Build prioritized list:
    // 1. Selected node (already added)
    // 2. All critical nodes (regardless of hop)
    // 3. Non-critical by hop distance (1st → 2nd → 3rd)
    const totalCount = 1 + neighborsByHop[1].length + neighborsByHop[2].length + neighborsByHop[3].length;
    this._totalCount = totalCount;
    
    // Add critical nodes first
    for (const idx of criticalNodes) {
      if (this._selectedNodeIds.size < this.budget) {
        this._selectedNodeIds.add(idx);
      }
    }
    
    // Add non-critical by hop distance
    for (const hop of [1, 2, 3]) {
      for (const idx of nonCriticalByHop[hop]) {
        if (this._selectedNodeIds.size < this.budget) {
          this._selectedNodeIds.add(idx);
        }
      }
    }
    
    // Check if we truncated
    this._truncated = this._selectedNodeIds.size < totalCount;
    
    // Convert indices to IDs
    const selectedNodeIds = [];
    for (const idx of this._selectedNodeIds) {
      const id = this.indexes.nodeIndexToId[idx];
      if (id) {
        selectedNodeIds.push(id);
      }
    }
    
    // Filter edges to only those with both endpoints in selection
    const selectedEdgeIds = this._filterEdges(selectedNodeIds);
    
    // Log truncation message if applicable
    if (this._truncated) {
      const shownCount = selectedNodeIds.length;
      logger.info('selection', 
        `Selection truncated: showing ${shownCount} of ${totalCount} nodes`,
        { nodeId, shown: shownCount, total: totalCount, budget: this.budget }
      );
    }
    
    // Verify zero dangling edges
    const danglingEdges = this._verifyNoDanglingEdges(selectedNodeIds, selectedEdgeIds);
    if (danglingEdges > 0) {
      logger.error('selection', 
        `BUG: ${danglingEdges} dangling edges detected`,
        { nodeId, selectedNodeCount: selectedNodeIds.length, selectedEdgeCount: selectedEdgeIds.length }
      );
    }
    
    // Notify callback
    if (this.onSelect) {
      this.onSelect(selectedNodeIds, this._truncated, totalCount);
    }
    
    return {
      nodeIds: selectedNodeIds,
      edgeIds: selectedEdgeIds,
      truncated: this._truncated,
      total: totalCount
    };
  }
  
  /**
   * Collect neighbors by hop distance (1, 2, 3 hops from selected node)
   * 
   * @param {number} startNodeIndex
   * @returns {Object} Map of hop distance → array of node indices
   */
  _collectNeighborsByHop(startNodeIndex) {
    const visited = new Set([startNodeIndex]);
    const byHop = { 1: [], 2: [], 3: [] };
    
    // BFS to collect neighbors by hop distance
    let currentFrontier = [startNodeIndex];
    
    for (let hop = 1; hop <= 3; hop++) {
      const nextFrontier = [];
      
      for (const nodeIdx of currentFrontier) {
        // Get all neighbors (both directions)
        const neighbors = this._getAllNeighbors(nodeIdx);
        
        for (const neighborIdx of neighbors) {
          if (!visited.has(neighborIdx)) {
            visited.add(neighborIdx);
            byHop[hop].push(neighborIdx);
            nextFrontier.push(neighborIdx);
          }
        }
      }
      
      currentFrontier = nextFrontier;
      
      // Stop early if no more neighbors
      if (currentFrontier.length === 0) {
        break;
      }
    }
    
    return byHop;
  }
  
  /**
   * Get all neighbors of a node (incoming + outgoing)
   * 
   * @param {number} nodeIndex
   * @returns {number[]}
   */
  _getAllNeighbors(nodeIndex) {
    const neighbors = new Set();
    
    // Outgoing neighbors
    const outgoing = this.indexes.nodeToOutgoing?.[nodeIndex];
    if (outgoing) {
      for (let i = 0; i < outgoing.length; i++) {
        neighbors.add(outgoing[i]);
      }
    }
    
    // Incoming neighbors
    const incoming = this.indexes.nodeToIncoming?.[nodeIndex];
    if (incoming) {
      for (let i = 0; i < incoming.length; i++) {
        neighbors.add(incoming[i]);
      }
    }
    
    return Array.from(neighbors);
  }
  
  /**
   * Filter edges to only those with both endpoints in the selected set
   * This ensures zero dangling edges in the rendered output
   * 
   * @param {string[]} selectedNodeIds
   * @returns {string[]} Selected edge IDs
   */
  _filterEdges(selectedNodeIds) {
    const selectedSet = new Set(selectedNodeIds);
    const selectedEdgeIds = [];
    
    // Build index-to-ID mapping for quick lookup
    const idToIndexMap = {};
    for (const id of selectedNodeIds) {
      const idx = this.indexes.nodeIdToIndex[id];
      if (idx !== undefined) {
        idToIndexMap[idx] = true;
      }
    }
    
    // Filter edges
    if (this.graphData.edges) {
      for (let i = 0; i < this.graphData.edges.length; i++) {
        const edge = this.graphData.edges[i];
        const sourceIdx = this.indexes.nodeIdToIndex[edge.source];
        const targetIdx = this.indexes.nodeIdToIndex[edge.target];
        
        // Include edge only if both endpoints are selected
        if (idToIndexMap[sourceIdx] && idToIndexMap[targetIdx]) {
          selectedEdgeIds.push(edge.id);
        }
      }
    }
    
    return selectedEdgeIds;
  }
  
  /**
   * Verify that no dangling edges exist in the selection
   * Returns count of dangling edges found (should be 0)
   * 
   * @param {string[]} nodeIds
   * @param {string[]} edgeIds
   * @returns {number}
   */
  _verifyNoDanglingEdges(nodeIds, edgeIds) {
    const nodeSet = new Set(nodeIds);
    let danglingCount = 0;
    
    for (let i = 0; i < edgeIds.length; i++) {
      const edgeId = edgeIds[i];
      const edge = this.graphData.edges.find(e => e.id === edgeId);
      
      if (edge && (!nodeSet.has(edge.source) || !nodeSet.has(edge.target))) {
        danglingCount++;
      }
    }
    
    return danglingCount;
  }
  
  /**
   * Clear current selection
   */
  clearSelection() {
    this._selectedNodeId = null;
    this._selectedNodeIds.clear();
    this._truncated = false;
    this._totalCount = 0;
    
    if (this.onSelect) {
      this.onSelect([], false, 0);
    }
  }
  
  /**
   * Get current selection state
   * 
   * @returns {{nodeId: string|null, nodeIds: string[], truncated: boolean, total: number}}
   */
  getCurrentState() {
    return {
      nodeId: this._selectedNodeId,
      nodeIds: Array.from(this._selectedNodeIds).map(idx => this.indexes.nodeIndexToId[idx]),
      truncated: this._truncated,
      total: this._totalCount
    };
  }
  
  /**
   * Get truncation message for UI display
   * 
   * @returns {string|null} Message or null if not truncated
   */
  getTruncationMessage() {
    if (!this._truncated) {
      return null;
    }
    
    const shownCount = this._selectedNodeIds.size;
    return `Showing ${shownCount} of ${this._totalCount} nodes`;
  }
}

// Export factory function
export function createSelectionHandler(options) {
  return new SelectionHandler(options);
}
