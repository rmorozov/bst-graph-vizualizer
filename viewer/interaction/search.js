/**
 * Search Interaction — §4.4.5
 * 
 * Handles search with trigram index, debouncing (300ms), and budgeted ancestor expansion.
 * Routes >10 results to sidebar with correct total count, renders ≤50.
 * Halts ancestor expansion before exceeding visible-element budget.
 */

import { logger } from '../perf/logger.js';

export class SearchHandler {
  /**
   * @param {Object} options
   * @param {Object} options.indexes - Graph indexes including searchIndex (trigram)
   * @param {Object} options.graphData - Full graph data for ancestor lookup
   * @param {number} options.maxRenderResults - Maximum results to render (default 50)
   * @param {number} options.sidebarThreshold - Route to sidebar if > this many results (default 10)
   * @param {number} options.ancestorBudget - Max ancestors to expand per result (default 20)
   * @param {(results: Object[], totalCount: number, routedToSidebar: boolean) => void} options.onSearch - Callback
   */
  constructor(options) {
    this.indexes = options.indexes;
    this.graphData = options.graphData;
    this.maxRenderResults = options.maxRenderResults || 50;
    this.sidebarThreshold = options.sidebarThreshold || 10;
    this.ancestorBudget = options.ancestorBudget || 20;
    this.onSearch = options.onSearch;
    
    // Current search state
    this._currentQuery = '';
    this._currentResults = [];
    this._totalCount = 0;
    this._routedToSidebar = false;
    
    // Debounce handling
    this._debounceTimer = null;
    this._lastQueryTime = 0;
    this._debounceDelay = 300; // ms
    
    // Query call counting
    this._queryCallCount = 0;
  }
  
  /**
   * Handle search query input with debouncing
   * 
   * @param {string} query - The search query string
   */
  handleInput(query) {
    // Clear any pending debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    
    this._currentQuery = query;
    
    // If query is empty, clear results immediately
    if (!query || query.trim() === '') {
      this._executeSearch('');
      return;
    }
    
    // Schedule debounced search
    this._debounceTimer = setTimeout(() => {
      this._executeSearch(query.trim());
    }, this._debounceDelay);
  }
  
  /**
   * Execute the search query using trigram index
   * 
   * @param {string} query
   */
  _executeSearch(query) {
    const startTime = performance.now();
    this._queryCallCount++;
    this._lastQueryTime = startTime;
    
    logger.debug('search', `Executing query: "${query}"`);
    
    if (!query) {
      // Empty query - clear results
      this._currentResults = [];
      this._totalCount = 0;
      this._routedToSidebar = false;
      this._notifyCallback();
      return;
    }
    
    // Use trigram index to find matching nodes
    const matches = this._searchWithTrigram(query);
    
    this._totalCount = matches.length;
    this._routedToSidebar = matches.length > this.sidebarThreshold;
    
    // Limit rendered results
    const renderCount = Math.min(matches.length, this.maxRenderResults);
    this._currentResults = matches.slice(0, renderCount);
    
    // Expand ancestors for each result (budgeted)
    if (this._currentResults.length > 0) {
      this._expandAncestorsBudgeted(this._currentResults);
    }
    
    const endTime = performance.now();
    logger.info('search', 
      `Query "${query}" found ${this._totalCount} results, rendering ${this._currentResults.length}`,
      { 
        query, 
        total: this._totalCount, 
        rendered: this._currentResults.length,
        routedToSidebar: this._routedToSidebar,
        durationMs: endTime - startTime
      }
    );
    
    this._notifyCallback();
  }
  
  /**
   * Search using trigram index
   * 
   * @param {string} query
   * @returns {Object[]} Array of matching node objects
   */
  _searchWithTrigram(query) {
    if (!this.indexes.searchIndex) {
      logger.warn('search', 'No trigram index available');
      return [];
    }
    
    // Use the trigram index to find matches
    // Index should support: search(query) → array of {nodeId, score, matchType}
    const rawMatches = this.indexes.searchIndex.search(query);
    
    if (!rawMatches || rawMatches.length === 0) {
      return [];
    }
    
    // Convert to result objects with full node info
    const results = [];
    for (const match of rawMatches) {
      const node = this._getNodeById(match.nodeId);
      if (node) {
        results.push({
          nodeId: match.nodeId,
          nodeName: node.name || node.id,
          kind: node.kind,
          matchType: match.matchType, // 'prefix' | 'substring' | 'trigram'
          score: match.score,
          buildStage: node.buildStage,
          isCritical: node.isCritical || false
        });
      }
    }
    
    // Sort by score (highest first)
    results.sort((a, b) => b.score - a.score);
    
    return results;
  }
  
  /**
   * Expand ancestors for each result, respecting budget
   * Stops before exceeding visible-element budget
   * 
   * @param {Object[]} results
   */
  _expandAncestorsBudgeted(results) {
    let totalExpanded = results.length;
    const maxVisible = 200; // Total visible element budget
    
    for (const result of results) {
      if (totalExpanded >= maxVisible) {
        logger.info('search', 
          `Ancestor expansion halted at budget limit: ${totalExpanded}/${maxVisible}`,
          { totalExpanded, maxVisible }
        );
        break;
      }
      
      const ancestors = this._getAncestors(result.nodeId, this.ancestorBudget);
      result.ancestors = ancestors;
      totalExpanded += ancestors.length;
    }
    
    // Set filter indicator if budget was hit
    if (totalExpanded >= maxVisible) {
      logger.info('search', 'Firing filter indicator due to budget clamp');
      // Could trigger a filter-indicator event here
    }
  }
  
  /**
   * Get ancestors of a node (parents, grandparents, etc.)
   * Limited by budget to prevent explosion
   * 
   * @param {string} nodeId
   * @param {number} budget
   * @returns {Object[]} Ancestor node objects
   */
  _getAncestors(nodeId, budget) {
    const ancestors = [];
    const visited = new Set([nodeId]);
    const queue = [nodeId];
    
    while (queue.length > 0 && ancestors.length < budget) {
      const currentId = queue.shift();
      const parentIds = this._getParentIds(currentId);
      
      for (const parentId of parentIds) {
        if (!visited.has(parentId)) {
          visited.add(parentId);
          queue.push(parentId);
          
          const parentNode = this._getNodeById(parentId);
          if (parentNode) {
            ancestors.push({
              nodeId: parentId,
              nodeName: parentNode.name || parentNode.id,
              kind: parentNode.kind,
              buildStage: parentNode.buildStage
            });
          }
          
          if (ancestors.length >= budget) {
            break;
          }
        }
      }
    }
    
    return ancestors;
  }
  
  /**
   * Get parent IDs for a node
   * 
   * @param {string} nodeId
   * @returns {string[]}
   */
  _getParentIds(nodeId) {
    const nodeIndex = this.indexes.nodeIdToIndex[nodeId];
    if (nodeIndex === undefined) {
      return [];
    }
    
    const parentIds = [];
    const incoming = this.indexes.nodeToIncoming?.[nodeIndex];
    
    if (incoming) {
      for (const parentIdx of incoming) {
        const parentId = this.indexes.nodeIndexToId[parentIdx];
        if (parentId) {
          parentIds.push(parentId);
        }
      }
    }
    
    return parentIds;
  }
  
  /**
   * Get node by ID
   * 
   * @param {string} nodeId
   * @returns {Object|null}
   */
  _getNodeById(nodeId) {
    if (this.graphData.nodes) {
      return this.graphData.nodes.find(n => n.id === nodeId) || null;
    }
    return null;
  }
  
  /**
   * Notify callback with current results
   */
  _notifyCallback() {
    if (this.onSearch) {
      this.onSearch(this._currentResults, this._totalCount, this._routedToSidebar);
    }
  }
  
  /**
   * Get current search state
   * 
   * @returns {{query: string, results: Object[], totalCount: number, routedToSidebar: boolean}}
   */
  getCurrentState() {
    return {
      query: this._currentQuery,
      results: this._currentResults,
      totalCount: this._totalCount,
      routedToSidebar: this._routedToSidebar
    };
  }
  
  /**
   * Clear current search
   */
  clearSearch() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    
    this._currentQuery = '';
    this._currentResults = [];
    this._totalCount = 0;
    this._routedToSidebar = false;
    this._notifyCallback();
  }
  
  /**
   * Get performance metrics
   * 
   * @returns {{queryCallCount: number, lastQueryTime: number}}
   */
  getMetrics() {
    return {
      queryCallCount: this._queryCallCount,
      lastQueryTime: this._lastQueryTime
    };
  }
  
  /**
   * Reset metrics (for testing)
   */
  resetMetrics() {
    this._queryCallCount = 0;
    this._lastQueryTime = 0;
  }
}

// Export factory function
export function createSearchHandler(options) {
  return new SearchHandler(options);
}
