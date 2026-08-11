/**
 * Combo Expansion — §4.4.7
 * 
 * Handles combo expansion dialog with 4 options:
 * 1. Expand - Expand the combo normally
 * 2. Expand + Focus - Expand and center viewport on expanded content
 * 3. Show Critical Path Only - Expand only critical nodes in subtree
 * 4. Cancel - Dismiss dialog
 * 
 * "Show Critical Path Only" is disabled if subtree contains zero critical nodes.
 */

import { logger } from '../perf/logger.js';

export class ComboExpandHandler {
  /**
   * @param {Object} options
   * @param {Object} options.stateStore - State store for getting/setting state
   * @param {import('./combo-depth.js').ComboDepthController} options.comboDepthController
   * @param {(comboId: string, mode: string) => void} options.onExpand - Callback when expand occurs
   * @param {() => Object} options.getIndexes - Function to get current graph indexes
   * @param {() => Object} options.getGraphData - Function to get full graph data
   */
  constructor(options) {
    this.stateStore = options.stateStore;
    this.comboDepthController = options.comboDepthController;
    this.onExpand = options.onExpand;
    this.getIndexes = options.getIndexes;
    this.getGraphData = options.getGraphData;
    
    // Current pending expansion
    this._pendingComboId = null;
    this._pendingComboName = null;
    
    // Dialog state
    this._dialogVisible = false;
    this._criticalPathDisabled = false;
    
    // Expand modes
    this.MODES = {
      EXPAND: 'expand',
      EXPAND_FOCUS: 'expand_focus',
      CRITICAL_ONLY: 'critical_only',
      CANCEL: 'cancel'
    };
  }
  
  /**
   * Show expansion dialog for a combo
   * 
   * @param {string} comboId
   * @param {string} comboName
   * @returns {boolean} Whether dialog was shown (false if no critical nodes)
   */
  showExpandDialog(comboId, comboName) {
    logger.debug('combo-expand', `Showing expand dialog for combo: ${comboId}`);
    
    this._pendingComboId = comboId;
    this._pendingComboName = comboName;
    
    // Check if critical path option should be disabled
    const hasCriticalNodes = this._checkSubtreeHasCriticalNodes(comboId);
    this._criticalPathDisabled = !hasCriticalNodes;
    
    this._dialogVisible = true;
    
    logger.info('combo-expand', 
      `Expand dialog shown for "${comboName}"`,
      { 
        comboId, 
        comboName, 
        hasCriticalNodes,
        criticalPathDisabled: this._criticalPathDisabled
      }
    );
    
    return true;
  }
  
  /**
   * Handle user selection from expansion dialog
   * 
   * @param {string} mode - One of MODES values
   * @returns {Object} Result of the operation
   */
  handleDialogSelection(mode) {
    if (!this._dialogVisible || !this._pendingComboId) {
      logger.warn('combo-expand', 'No pending expansion');
      return { success: false, reason: 'no_pending' };
    }
    
    logger.debug('combo-expand', `Dialog selection: ${mode}`);
    
    let result;
    
    switch (mode) {
      case this.MODES.EXPAND:
        result = this._performExpand(this._pendingComboId, 'normal');
        break;
        
      case this.MODES.EXPAND_FOCUS:
        result = this._performExpand(this._pendingComboId, 'focus');
        break;
        
      case this.MODES.CRITICAL_ONLY:
        if (this._criticalPathDisabled) {
          logger.warn('combo-expand', 'Critical path option disabled - no critical nodes in subtree');
          result = { success: false, reason: 'critical_path_disabled' };
        } else {
          result = this._performExpand(this._pendingComboId, 'critical_only');
        }
        break;
        
      case this.MODES.CANCEL:
        result = { success: true, action: 'cancelled' };
        break;
        
      default:
        logger.error('combo-expand', `Unknown expand mode: ${mode}`);
        result = { success: false, reason: 'unknown_mode' };
    }
    
    // Clear pending state
    this._clearPending();
    
    return result;
  }
  
  /**
   * Perform the actual expansion
   * 
   * @param {string} comboId
   * @param {string} mode - 'normal' | 'focus' | 'critical_only'
   * @returns {Object}
   */
  _performExpand(comboId, mode) {
    logger.info('combo-expand', `Expanding combo ${comboId} with mode: ${mode}`);
    
    const indexes = this.getIndexes();
    const graphData = this.getGraphData();
    
    if (!indexes || !graphData) {
      logger.error('combo-expand', 'Missing indexes or graph data');
      return { success: false, reason: 'missing_data' };
    }
    
    // Get combo info
    const comboInfo = this._getComboInfo(comboId, indexes, graphData);
    
    if (!comboInfo) {
      logger.error('combo-expand', `Combo not found: ${comboId}`);
      return { success: false, reason: 'combo_not_found' };
    }
    
    // Determine nodes to show based on mode
    let nodesToShow;
    
    if (mode === 'critical_only') {
      // Filter to only critical nodes in subtree
      nodesToShow = comboInfo.subtreeNodeIds.filter(id => {
        const node = graphData.nodes.find(n => n.id === id);
        return node && node.isCritical;
      });
      
      logger.info('combo-expand', 
        `Critical-only mode: ${nodesToShow.length}/${comboInfo.subtreeNodeIds.length} nodes are critical`,
        { comboId, criticalCount: nodesToShow.length, totalCount: comboInfo.subtreeNodeIds.length }
      );
    } else {
      // Normal expansion - show all nodes
      nodesToShow = comboInfo.subtreeNodeIds;
    }
    
    // Update combo depth controller to expand this level
    const newDepth = Math.max(comboInfo.depth + 1, this.comboDepthController.getCurrentDepth());
    this.comboDepthController.setDepth(newDepth);
    
    // Notify callback
    if (this.onExpand) {
      this.onExpand(comboId, mode);
    }
    
    // Return result with node counts
    return {
      success: true,
      action: 'expanded',
      comboId,
      mode,
      nodesToShow: nodesToShow.length,
      totalSubtreeNodes: comboInfo.subtreeNodeIds.length,
      shouldFocusViewport: mode === 'focus'
    };
  }
  
  /**
   * Check if subtree has any critical nodes
   * 
   * @param {string} comboId
   * @returns {boolean}
   */
  _checkSubtreeHasCriticalNodes(comboId) {
    const indexes = this.getIndexes();
    const graphData = this.getGraphData();
    
    if (!indexes || !graphData) {
      return false;
    }
    
    const comboInfo = this._getComboInfo(comboId, indexes, graphData);
    
    if (!comboInfo || !comboInfo.subtreeNodeIds) {
      return false;
    }
    
    // Check if any node in subtree is critical
    for (const nodeId of comboInfo.subtreeNodeIds) {
      const node = graphData.nodes.find(n => n.id === nodeId);
      if (node && node.isCritical) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Get combo information including subtree nodes
   * 
   * @param {string} comboId
   * @param {Object} indexes
   * @param {Object} graphData
   * @returns {Object|null}
   */
  _getComboInfo(comboId, indexes, graphData) {
    // Find combo in combos array
    const combo = graphData.combos?.find(c => c.id === comboId);
    
    if (!combo) {
      return null;
    }
    
    // Get all nodes in this combo's subtree
    const subtreeNodeIds = [];
    
    if (indexes.comboChildren) {
      // Use pre-built combo children index
      const childIndices = indexes.comboChildren[comboId] || [];
      for (const idx of childIndices) {
        const nodeId = indexes.nodeIndexToId[idx];
        if (nodeId) {
          subtreeNodeIds.push(nodeId);
        }
      }
    } else {
      // Fallback: scan all nodes for matching comboId
      for (const node of graphData.nodes) {
        if (node.comboId === comboId || node.comboParent === comboId) {
          subtreeNodeIds.push(node.id);
        }
      }
    }
    
    return {
      comboId,
      comboName: combo.label || comboId,
      depth: combo.depth || 0,
      subtreeNodeIds
    };
  }
  
  /**
   * Clear pending expansion state
   */
  _clearPending() {
    this._pendingComboId = null;
    this._pendingComboName = null;
    this._dialogVisible = false;
    this._criticalPathDisabled = false;
  }
  
  /**
   * Get current dialog state
   * 
   * @returns {{visible: boolean, comboId: string|null, comboName: string|null, criticalPathDisabled: boolean}}
   */
  getDialogState() {
    return {
      visible: this._dialogVisible,
      comboId: this._pendingComboId,
      comboName: this._pendingComboName,
      criticalPathDisabled: this._criticalPathDisabled
    };
  }
  
  /**
   * Hide dialog without performing any action
   */
  hideDialog() {
    this._clearPending();
  }
  
  /**
   * Get available expand modes for current combo
   * 
   * @returns {Array<{mode: string, label: string, disabled: boolean}>}
   */
  getAvailableModes() {
    return [
      { mode: this.MODES.EXPAND, label: 'Expand', disabled: false },
      { mode: this.MODES.EXPAND_FOCUS, label: 'Expand + Focus', disabled: false },
      { mode: this.MODES.CRITICAL_ONLY, label: 'Show Critical Path Only', disabled: this._criticalPathDisabled },
      { mode: this.MODES.CANCEL, label: 'Cancel', disabled: false }
    ];
  }
}

// Export factory function
export function createComboExpandHandler(options) {
  return new ComboExpandHandler(options);
}
