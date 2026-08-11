/**
 * UX Chrome: Help & Keyboard Shortcuts
 * 
 * Displays help modal with keyboard shortcuts and interaction guide.
 * Spec §4.3.4 - Context-sensitive help with search capability.
 */

import { log } from '../utils/logger.js';

const HELP_STORAGE_KEY = 'bst-graph-help-state';

export class HelpPanel {
  constructor(container, stateStore) {
    this.container = container;
    this.stateStore = stateStore;
    this.visible = false;
    this.activeSection = 'shortcuts';
    
    this.shortcuts = [
      { keys: ['Space'], action: 'Pan canvas', context: 'Always' },
      { keys: ['Shift', '+', 'Drag'], action: 'Box select', context: 'Always' },
      { keys: ['Ctrl/Cmd', '+', 'Click'], action: 'Multi-select', context: 'Always' },
      { keys: ['Escape'], action: 'Clear selection', context: 'Always' },
      { keys: ['F'], action: 'Fit to screen', context: 'Always' },
      { keys: ['R'], action: 'Reset zoom', context: 'Always' },
      { keys: ['H'], action: 'Toggle help', context: 'Always' },
      { keys: ['S'], action: 'Toggle sidebar', context: 'Always' },
      { keys: ['B'], action: 'Toggle breadcrumb', context: 'Always' },
      { keys: ['M'], action: 'Toggle metrics overlay', context: 'Always' },
      { keys: ['+', 'Scroll'], action: 'Zoom in', context: 'Always' },
      { keys: ['-', 'Scroll'], action: 'Zoom out', context: 'Always' },
      { keys: ['0'], action: 'Reset view', context: 'Always' },
      { keys: ['G'], action: 'Toggle grid', context: 'Always' },
      { keys: ['L'], action: 'Toggle labels', context: 'Always' },
      { keys: ['C'], action: 'Expand combo', context: 'Combo selected' },
      { keys: ['D'], action: 'Show dependencies', context: 'Node selected' },
      { keys: ['/'], action: 'Focus search', context: 'Always' },
    ];

    this.init();
  }

  init() {
    const saved = localStorage.getItem(HELP_STORAGE_KEY);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        this.lastViewed = state.lastViewed;
      } catch (e) {
        log('warn', '[help] Failed to restore state', e);
      }
    }

    this.bindGlobalEvents();
    log('info', '[help] Initialized');
  }

  bindGlobalEvents() {
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === 'h' || e.key === 'H' || e.key === '?') {
        e.preventDefault();
        this.toggle();
      }

      if (e.key === 'Escape' && this.visible) {
        this.hide();
      }
    });
  }

  toggle() {
    this.visible = !this.visible;
    if (this.visible) {
      this.render();
      this.saveState();
      log('info', '[help] Shown');
    } else {
      this.hide();
    }
  }

  show() {
    if (!this.visible) {
      this.visible = true;
      this.render();
      this.saveState();
      log('info', '[help] Shown');
    }
  }

  hide() {
    if (this.visible) {
      this.visible = false;
      this.container.innerHTML = '';
      log('info', '[help] Hidden');
    }
  }

  render() {
    if (!this.visible) {
      this.container.innerHTML = '';
      return;
    }

    this.container.innerHTML = `
      <div class="help-overlay" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <div class="help-panel">
          <div class="help-header">
            <h2 id="help-title">Help & Shortcuts</h2>
            <button class="help-close" aria-label="Close help">&times;</button>
          </div>
          
          <div class="help-tabs">
            <button class="help-tab ${this.activeSection === 'shortcuts' ? 'active' : ''}" data-section="shortcuts">
              Keyboard Shortcuts
            </button>
            <button class="help-tab ${this.activeSection === 'interactions' ? 'active' : ''}" data-section="interactions">
              Interactions
            </button>
            <button class="help-tab ${this.activeSection === 'metrics' ? 'active' : ''}" data-section="metrics">
              Metrics Guide
            </button>
          </div>
          
          <div class="help-content">
            ${this.renderContent()}
          </div>
          
          <div class="help-footer">
            <span class="help-tip">Tip: Press <kbd>H</kbd> or <kbd>?</kbd> to toggle this help</span>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderContent() {
    switch (this.activeSection) {
      case 'shortcuts':
        return this.renderShortcuts();
      case 'interactions':
        return this.renderInteractions();
      case 'metrics':
        return this.renderMetricsGuide();
      default:
        return '<div>Unknown section</div>';
    }
  }

  renderShortcuts() {
    return `
      <div class="shortcuts-table">
        <table>
          <thead>
            <tr>
              <th>Keys</th>
              <th>Action</th>
              <th>Context</th>
            </tr>
          </thead>
          <tbody>
            ${this.shortcuts.map(shortcut => `
              <tr>
                <td class="keys-cell">
                  ${shortcut.keys.map(k => `<kbd>${k}</kbd>`).join(' + ')}
                </td>
                <td>${shortcut.action}</td>
                <td>${shortcut.context}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderInteractions() {
    return `
      <div class="interactions-guide">
        <section>
          <h3>Navigation</h3>
          <ul>
            <li><strong>Pan:</strong> Hold Space and drag, or use middle mouse button</li>
            <li><strong>Zoom:</strong> Mouse wheel or pinch gesture on touch devices</li>
            <li><strong>Fit:</strong> Press F to fit all visible nodes</li>
          </ul>
        </section>
        
        <section>
          <h3>Selection</h3>
          <ul>
            <li><strong>Single click:</strong> Select a node</li>
            <li><strong>Ctrl/Cmd + click:</strong> Add to selection</li>
            <li><strong>Shift + drag:</strong> Box select multiple nodes</li>
            <li><strong>Escape:</strong> Clear selection</li>
          </ul>
        </section>
        
        <section>
          <h3>Combos</h3>
          <ul>
            <li><strong>Click combo:</strong> Select all nodes in combo</li>
            <li><strong>Double-click combo:</strong> Expand combo dialog</li>
            <li><strong>Breadcrumb:</strong> Navigate up the hierarchy</li>
          </ul>
        </section>
        
        <section>
          <h3>Search</h3>
          <ul>
            <li><strong>/ key:</strong> Focus search box</li>
            <li><strong>Type 3+ chars:</strong> See matching results</li>
            <li><strong>Click result:</strong> Navigate to node</li>
          </ul>
        </section>
      </div>
    `;
  }

  renderMetricsGuide() {
    return `
      <div class="metrics-guide">
        <section>
          <h3>Graph Metrics</h3>
          
          <div class="metric-item">
            <h4>Betweenness Centrality</h4>
            <p>Measures how often a node appears on shortest paths between other nodes. High values indicate bridge nodes.</p>
          </div>
          
          <div class="metric-item">
            <h4>Reachability</h4>
            <p>Number of nodes reachable from this node following outgoing edges. Indicates influence scope.</p>
          </div>
          
          <div class="metric-item">
            <h4>In-Degree / Out-Degree</h4>
            <p>Number of incoming/outgoing edges. High in-degree = popular target. High out-degree = many dependencies.</p>
          </div>
          
          <div class="metric-item">
            <h4>Critical Path</h4>
            <p>Nodes on the longest path through the graph. These determine minimum build time.</p>
          </div>
          
          <div class="metric-item">
            <h4>Articulation Point</h4>
            <p>Nodes whose removal would disconnect the graph. Critical for connectivity.</p>
          </div>
        </section>
        
        <section>
          <h3>Visualization Modes</h3>
          <ul>
            <li><strong>Dataset Mode:</strong> Shows all nodes regardless of visibility filters</li>
            <li><strong>Render Mode:</strong> Only shows currently visible nodes after filtering</li>
            <li><strong>Reachability Mode:</strong> Highlights nodes reachable from selection</li>
          </ul>
        </section>
      </div>
    `;
  }

  bindEvents() {
    // Close button
    const closeBtn = this.container.querySelector('.help-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Overlay click to close
    const overlay = this.container.querySelector('.help-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.hide();
        }
      });
    }

    // Tab switching
    const tabs = this.container.querySelectorAll('.help-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.activeSection = e.target.dataset.section;
        this.render();
      });
    });
  }

  saveState() {
    try {
      localStorage.setItem(HELP_STORAGE_KEY, JSON.stringify({
        lastViewed: new Date().toISOString()
      }));
    } catch (e) {
      log('warn', '[help] Failed to save state', e);
    }
  }

  isFirstTime() {
    return !this.lastViewed;
  }

  showOnFirstRun() {
    if (this.isFirstTime()) {
      this.show();
      return true;
    }
    return false;
  }
}

export default HelpPanel;
