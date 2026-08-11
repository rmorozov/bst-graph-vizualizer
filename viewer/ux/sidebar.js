/**
 * UX Chrome: Sidebar Panel
 * 
 * Manages the collapsible sidebar showing node details, combo info, and metrics.
 * Spec §4.3.1 - Sidebar with tabs for Details/Metrics/Dependencies.
 */

import { log } from '../utils/logger.js';

const SIDEBAR_STORAGE_KEY = 'bst-graph-sidebar-state';

export class Sidebar {
  constructor(container, stateStore) {
    this.container = container;
    this.stateStore = stateStore;
    this.tabs = ['details', 'metrics', 'dependencies'];
    this.activeTab = 'details';
    this.collapsed = false;
    
    this.init();
  }

  init() {
    // Restore state from localStorage
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        this.activeTab = state.activeTab || 'details';
        this.collapsed = state.collapsed || false;
      } catch (e) {
        log('warn', '[sidebar] Failed to restore state', e);
      }
    }

    this.render();
    this.bindEvents();
    log('info', '[sidebar] Initialized');
  }

  render() {
    this.container.innerHTML = `
      <div class="sidebar ${this.collapsed ? 'collapsed' : ''}">
        <div class="sidebar-header">
          <button class="sidebar-toggle" title="Toggle sidebar">
            ${this.collapsed ? '◀' : '▶'}
          </button>
          <h3>Details</h3>
        </div>
        <div class="sidebar-tabs ${this.collapsed ? 'hidden' : ''}">
          ${this.tabs.map(tab => `
            <button class="tab-btn ${tab === this.activeTab ? 'active' : ''}" data-tab="${tab}">
              ${tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          `).join('')}
        </div>
        <div class="sidebar-content ${this.collapsed ? 'hidden' : ''}">
          ${this.renderContent()}
        </div>
      </div>
    `;
  }

  renderContent() {
    const selection = this.stateStore.getSelection();
    
    if (!selection || selection.length === 0) {
      return '<div class="empty-state">Select a node to view details</div>';
    }

    const nodeId = selection[0];
    const node = this.stateStore.getNode(nodeId);
    const combo = this.stateStore.getCombo(node?.comboId);

    switch (this.activeTab) {
      case 'details':
        return this.renderDetails(node, combo);
      case 'metrics':
        return this.renderMetrics(node);
      case 'dependencies':
        return this.renderDependencies(node);
      default:
        return '<div>Unknown tab</div>';
    }
  }

  renderDetails(node, combo) {
    if (!node) return '<div>Node not found</div>';

    return `
      <div class="detail-section">
        <h4>${node.label || node.id}</h4>
        <div class="detail-row">
          <span class="label">Type:</span>
          <span class="value">${node.type || 'unknown'}</span>
        </div>
        ${node.path ? `
        <div class="detail-row">
          <span class="label">Path:</span>
          <span class="value code">${node.path}</span>
        </div>` : ''}
        ${combo ? `
        <div class="detail-row">
          <span class="label">Combo:</span>
          <span class="value">${combo.label}</span>
        </div>` : ''}
        ${node.buildTime ? `
        <div class="detail-row">
          <span class="label">Build Time:</span>
          <span class="value">${node.buildTime.toFixed(2)}s</span>
        </div>` : ''}
      </div>
    `;
  }

  renderMetrics(node) {
    if (!node) return '<div>No metrics available</div>';

    const metrics = node.metrics || {};
    
    return `
      <div class="metrics-list">
        ${this.renderMetricRow('Betweenness', metrics.betweenness)}
        ${this.renderMetricRow('Reachability', metrics.reachability)}
        ${this.renderMetricRow('In-Degree', metrics.inDegree)}
        ${this.renderMetricRow('Out-Degree', metrics.outDegree)}
        ${this.renderMetricRow('Critical Path', metrics.onCriticalPath ? 'Yes' : 'No')}
        ${this.renderMetricRow('Articulation Point', metrics.isArticulation ? 'Yes' : 'No')}
      </div>
    `;
  }

  renderMetricRow(label, value) {
    if (value === undefined || value === null) return '';
    return `
      <div class="metric-row">
        <span class="label">${label}:</span>
        <span class="value">${typeof value === 'number' ? value.toFixed(4) : value}</span>
      </div>
    `;
  }

  renderDependencies(node) {
    if (!node) return '<div>No dependencies</div>';

    const incoming = this.stateStore.getIncomingEdges(node.id);
    const outgoing = this.stateStore.getOutgoingEdges(node.id);

    return `
      <div class="deps-section">
        <h4>Dependencies (${incoming.length})</h4>
        <ul class="deps-list">
          ${incoming.slice(0, 20).map(edge => `
            <li class="dep-item" data-node-id="${edge.source}">
              ${this.stateStore.getNode(edge.source)?.label || edge.source}
            </li>
          `).join('')}
          ${incoming.length > 20 ? `<li class="more-indicator">+${incoming.length - 20} more</li>` : ''}
        </ul>
        
        <h4>Dependents (${outgoing.length})</h4>
        <ul class="deps-list">
          ${outgoing.slice(0, 20).map(edge => `
            <li class="dep-item" data-node-id="${edge.target}">
              ${this.stateStore.getNode(edge.target)?.label || edge.target}
            </li>
          `).join('')}
          ${outgoing.length > 20 ? `<li class="more-indicator">+${outgoing.length - 20} more</li>` : ''}
        </ul>
      </div>
    `;
  }

  bindEvents() {
    // Toggle button
    const toggleBtn = this.container.querySelector('.sidebar-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggle());
    }

    // Tab buttons
    const tabBtns = this.container.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.target.dataset.tab;
        this.setActiveTab(tab);
      });
    });

    // Dependency items click
    const depItems = this.container.querySelectorAll('.dep-item');
    depItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const nodeId = e.target.dataset.nodeId;
        if (nodeId) {
          this.stateStore.setSelection([nodeId]);
        }
      });
    });

    // State store subscription
    this.stateStore.subscribe('selection', () => {
      this.refresh();
    });
  }

  toggle() {
    this.collapsed = !this.collapsed;
    this.saveState();
    this.render();
    this.bindEvents();
    log('info', `[sidebar] Toggled: ${this.collapsed ? 'collapsed' : 'expanded'}`);
  }

  setActiveTab(tab) {
    if (!this.tabs.includes(tab)) return;
    this.activeTab = tab;
    this.saveState();
    this.render();
    this.bindEvents();
    log('info', `[sidebar] Active tab: ${tab}`);
  }

  refresh() {
    const contentEl = this.container.querySelector('.sidebar-content');
    if (contentEl) {
      contentEl.innerHTML = this.renderContent();
      this.bindEvents();
    }
  }

  saveState() {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({
        activeTab: this.activeTab,
        collapsed: this.collapsed
      }));
    } catch (e) {
      log('warn', '[sidebar] Failed to save state', e);
    }
  }

  collapse() {
    if (!this.collapsed) {
      this.toggle();
    }
  }

  expand() {
    if (this.collapsed) {
      this.toggle();
    }
  }
}

export default Sidebar;
