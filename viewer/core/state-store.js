/**
 * State Store - Single source of truth for all viewer state
 * Spec §4.2: filters, selection, mode, viewport
 * Provides dumpState() for diagnostic reports
 */

import { logInfo, logWarning } from '../perf/logger.js';

const defaultState = {
  // Data state
  graphData: null,
  schemaVersion: null,
  
  // Filter state (per dimension)
  filters: {
    kind: new Uint8Array(), // bitmask per node
    buildCost: { min: 0, max: Infinity },
    runtimeCost: { min: 0, max: Infinity },
    blastRadius: { min: 0, max: Infinity },
    bottleneckScore: { min: 0, max: Infinity }
  },
  
  // Selection state
  selection: {
    nodeIds: [],
    expandedCombos: []
  },
  
  // Mode state
  datasetMode: 'fixed',
  renderMode: 'normal',
  
  // Viewport state
  viewport: {
    centerX: 0,
    centerY: 0,
    zoom: 1,
    width: 800,
    height: 600
  },
  
  // Interaction state
  hover: {
    nodeId: null,
    timestamp: 0
  },
  
  // Search state
  search: {
    query: '',
    results: [],
    activeIndex: -1
  },
  
  // Breadcrumb navigation
  breadcrumb: {
    trail: [],
    collapsedFrom: -1
  },
  
  // Slider state
  sliders: {
    buildCost: [0, Infinity],
    runtimeCost: [0, Infinity],
    blastRadius: [0, Infinity],
    bottleneckScore: [0, Infinity]
  },
  
  // Combo expansion dialog state
  comboExpand: {
    visible: false,
    comboId: null,
    pendingAction: null
  },
  
  // Performance monitoring
  performance: {
    fps: 60,
    degraded: false,
    qualityLevel: 'high'
  }
};

class StateStore {
  constructor() {
    this.state = JSON.parse(JSON.stringify(defaultState));
    this.listeners = new Map();
    this.history = [];
    this.maxHistory = 50;
    
    logInfo('state-store', 'State store initialized');
  }
  
  /**
   * Get entire state (for diagnostic dump)
   */
  getState() {
    return this.state;
  }
  
  /**
   * Get specific state slice
   */
  get(slice) {
    const keys = slice.split('.');
    let value = this.state;
    for (const key of keys) {
      if (value === null || value === undefined) return undefined;
      value = value[key];
    }
    return value;
  }
  
  /**
   * Set state with optional history tracking
   */
  set(slice, value, trackHistory = true) {
    const keys = slice.split('.');
    const lastKey = keys.pop();
    
    let target = this.state;
    for (const key of keys) {
      if (!(key in target)) {
        logWarning('state-store', `Invalid state path: ${slice}`);
        return false;
      }
      target = target[key];
    }
    
    // Track history for undo/redo
    if (trackHistory && this.history.length >= this.maxHistory) {
      this.history.shift();
    }
    if (trackHistory) {
      this.history.push({
        slice,
        oldValue: target[lastKey],
        timestamp: Date.now()
      });
    }
    
    target[lastKey] = value;
    this.notify(slice, value);
    
    return true;
  }
  
  /**
   * Update filter bitmask for a dimension
   */
  updateFilterBitmask(dimension, bitmask) {
    if (!(dimension in this.state.filters)) {
      logWarning('state-store', `Unknown filter dimension: ${dimension}`);
      return false;
    }
    
    this.state.filters[dimension] = bitmask;
    this.notify(`filters.${dimension}`, bitmask);
    return true;
  }
  
  /**
   * Add node to selection
   */
  addToSelection(nodeId) {
    if (!this.state.selection.nodeIds.includes(nodeId)) {
      this.state.selection.nodeIds.push(nodeId);
      this.notify('selection.nodeIds', this.state.selection.nodeIds);
    }
  }
  
  /**
   * Remove node from selection
   */
  removeFromSelection(nodeId) {
    const index = this.state.selection.nodeIds.indexOf(nodeId);
    if (index !== -1) {
      this.state.selection.nodeIds.splice(index, 1);
      this.notify('selection.nodeIds', this.state.selection.nodeIds);
    }
  }
  
  /**
   * Clear selection
   */
  clearSelection() {
    this.state.selection.nodeIds = [];
    this.notify('selection.nodeIds', []);
  }
  
  /**
   * Expand combo
   */
  expandCombo(comboId) {
    if (!this.state.selection.expandedCombos.includes(comboId)) {
      this.state.selection.expandedCombos.push(comboId);
      this.notify('selection.expandedCombos', this.state.selection.expandedCombos);
    }
  }
  
  /**
   * Collapse combo
   */
  collapseCombo(comboId) {
    const index = this.state.selection.expandedCombos.indexOf(comboId);
    if (index !== -1) {
      this.state.selection.expandedCombos.splice(index, 1);
      this.notify('selection.expandedCombos', this.state.selection.expandedCombos);
    }
  }
  
  /**
   * Set viewport
   */
  setViewport(viewport) {
    this.state.viewport = { ...this.state.viewport, ...viewport };
    this.notify('viewport', this.state.viewport);
  }
  
  /**
   * Set hover state
   */
  setHover(nodeId) {
    this.state.hover.nodeId = nodeId;
    this.state.hover.timestamp = Date.now();
    this.notify('hover', this.state.hover);
  }
  
  /**
   * Clear hover
   */
  clearHover() {
    this.state.hover.nodeId = null;
    this.notify('hover', this.state.hover);
  }
  
  /**
   * Set search query
   */
  setSearch(query, results = [], activeIndex = -1) {
    this.state.search = { query, results, activeIndex };
    this.notify('search', this.state.search);
  }
  
  /**
   * Set breadcrumb trail
   */
  setBreadcrumb(trail, collapsedFrom = -1) {
    this.state.breadcrumb = { trail, collapsedFrom };
    this.notify('breadcrumb', this.state.breadcrumb);
  }
  
  /**
   * Update performance metrics
   */
  updatePerformance(fps, degraded, qualityLevel) {
    this.state.performance = { fps, degraded, qualityLevel };
    this.notify('performance', this.state.performance);
  }
  
  /**
   * Register state change listener
   */
  subscribe(slice, callback) {
    if (!this.listeners.has(slice)) {
      this.listeners.set(slice, new Set());
    }
    this.listeners.get(slice).add(callback);
    
    return () => {
      const listeners = this.listeners.get(slice);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }
  
  /**
   * Notify listeners of state change
   */
  notify(slice, value) {
    const listeners = this.listeners.get(slice);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(value, slice);
        } catch (error) {
          logWarning('state-store', `Listener error for ${slice}: ${error.message}`);
        }
      });
    }
    
    // Also notify wildcard listeners
    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      wildcardListeners.forEach(callback => {
        try {
          callback(value, slice);
        } catch (error) {
          logWarning('state-store', `Wildcard listener error: ${error.message}`);
        }
      });
    }
  }
  
  /**
   * Dump complete state for diagnostic report
   * This is the single function call mentioned in spec §1.3
   */
  dumpState() {
    const dump = {
      timestamp: new Date().toISOString(),
      schemaVersion: this.state.schemaVersion,
      datasetMode: this.state.datasetMode,
      renderMode: this.state.renderMode,
      stats: {
        totalNodes: this.state.graphData?.metadata?.totalNodes ?? 0,
        totalEdges: this.state.graphData?.metadata?.totalEdges ?? 0,
        visibleNodes: this.state.graphData?.nodes?.length ?? 0,
        selectedNodes: this.state.selection.nodeIds.length,
        expandedCombos: this.state.selection.expandedCombos.length
      },
      filters: {
        dimensions: Object.keys(this.state.filters),
        activeFilters: Object.entries(this.state.filters)
          .filter(([_, v]) => v instanceof Uint8Array && v.some(b => b === 0))
          .map(([k, _]) => k)
      },
      viewport: this.state.viewport,
      performance: this.state.performance,
      search: this.state.search.query ? {
        query: this.state.search.query,
        resultCount: this.state.search.results.length
      } : null,
      breadcrumb: this.state.breadcrumb.trail.length > 0 ? {
        trailLength: this.state.breadcrumb.trail.length,
        collapsedFrom: this.state.breadcrumb.collapsedFrom
      } : null,
      interaction: {
        hover: this.state.hover.nodeId,
        comboExpandVisible: this.state.comboExpand.visible
      }
    };
    
    logInfo('state-store', 'State dumped for diagnostic report');
    return dump;
  }
  
  /**
   * Reset state to defaults
   */
  reset() {
    this.state = JSON.parse(JSON.stringify(defaultState));
    this.history = [];
    this.notify('*', 'reset');
    logInfo('state-store', 'State reset to defaults');
  }
  
  /**
   * Load new graph data
   */
  loadGraphData(graphData) {
    this.state.graphData = graphData;
    this.state.schemaVersion = graphData?.metadata?.schemaVersion;
    
    // Initialize filter bitmasks
    const nodeCount = graphData?.nodes?.length ?? 0;
    if (nodeCount > 0) {
      this.state.filters.kind = new Uint8Array(nodeCount).fill(1);
    }
    
    this.notify('graphData', graphData);
    logInfo('state-store', `Loaded graph with ${nodeCount} nodes`);
  }
}

// Singleton instance
export const stateStore = new StateStore();
export default stateStore;
