/**
 * UX Chrome: Status Bar
 * 
 * Displays real-time metrics, selection info, and performance stats.
 * Spec §4.3.3 - Context-aware status with FPS and node counts.
 */

import { log } from '../utils/logger.js';

const STATUS_STORAGE_KEY = 'bst-graph-status-state';

export class StatusBar {
  constructor(container, stateStore, renderEngine) {
    this.container = container;
    this.stateStore = stateStore;
    this.renderEngine = renderEngine;
    this.visible = true;
    this.showFPS = true;
    this.lastFpsUpdate = 0;
    
    this.init();
  }

  init() {
    const saved = localStorage.getItem(STATUS_STORAGE_KEY);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        this.visible = state.visible !== false;
        this.showFPS = state.showFPS !== false;
      } catch (e) {
        log('warn', '[statusbar] Failed to restore state', e);
      }
    }

    this.render();
    this.bindEvents();
    this.startFPSTracking();
    log('info', '[statusbar] Initialized');
  }

  render() {
    if (!this.visible) {
      this.container.innerHTML = '';
      return;
    }

    const stats = this.getStats();
    
    this.container.innerHTML = `
      <div class="status-bar ${!this.visible ? 'hidden' : ''}">
        <div class="status-section">
          <span class="status-item">
            <span class="label">Nodes:</span>
            <span class="value">${stats.nodeCount}</span>
          </span>
          <span class="status-item">
            <span class="label">Edges:</span>
            <span class="value">${stats.edgeCount}</span>
          </span>
          <span class="status-item">
            <span class="label">Visible:</span>
            <span class="value">${stats.visibleCount}</span>
          </span>
        </div>
        
        ${this.showFPS ? `
        <div class="status-section">
          <span class="status-item">
            <span class="label">FPS:</span>
            <span class="value ${stats.fps < 30 ? 'warning' : stats.fps < 15 ? 'danger' : ''}">${stats.fps}</span>
          </span>
        </div>` : ''}
        
        <div class="status-section">
          ${stats.selection.length > 0 ? `
            <span class="status-item">
              <span class="label">Selected:</span>
              <span class="value">${stats.selection[0]}</span>
            </span>
          ` : ''}
          ${stats.combo ? `
            <span class="status-item">
              <span class="label">Combo:</span>
              <span class="value">${stats.combo}</span>
            </span>
          ` : ''}
        </div>
        
        <button class="status-toggle-fps" title="Toggle FPS display">
          ${this.showFPS ? '📊' : '📈'}
        </button>
      </div>
    `;

    this.bindEvents();
  }

  getStats() {
    const nodes = this.stateStore.getAllNodes();
    const edges = this.stateStore.getAllEdges();
    const visibleNodes = this.stateStore.getVisibleNodes();
    const selection = this.stateStore.getSelection();
    
    let comboLabel = null;
    if (selection.length > 0) {
      const node = this.stateStore.getNode(selection[0]);
      if (node?.comboId) {
        const combo = this.stateStore.getCombo(node.comboId);
        comboLabel = combo?.label || combo?.id;
      }
    }

    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      visibleCount: visibleNodes.length,
      fps: this.currentFPS || 0,
      selection,
      combo: comboLabel
    };
  }

  startFPSTracking() {
    let frameCount = 0;
    let lastTime = performance.now();
    
    const updateFPS = () => {
      frameCount++;
      const now = performance.now();
      
      if (now - lastTime >= 1000) {
        this.currentFPS = Math.round((frameCount * 1000) / (now - lastTime));
        frameCount = 0;
        lastTime = now;
        
        // Throttle re-renders to every 2 seconds
        if (this.showFPS && this.visible) {
          const timeSinceUpdate = now - this.lastFpsUpdate;
          if (timeSinceUpdate >= 2000) {
            this.lastFpsUpdate = now;
            this.render();
          }
        }
      }
      
      requestAnimationFrame(updateFPS);
    };
    
    requestAnimationFrame(updateFPS);
  }

  bindEvents() {
    const fpsToggle = this.container.querySelector('.status-toggle-fps');
    if (fpsToggle) {
      fpsToggle.addEventListener('click', () => {
        this.toggleFPS();
      });
    }
  }

  toggleFPS() {
    this.showFPS = !this.showFPS;
    this.saveState();
    this.render();
    log('info', `[statusbar] FPS display: ${this.showFPS ? 'enabled' : 'disabled'}`);
  }

  toggle() {
    this.visible = !this.visible;
    this.saveState();
    this.render();
    log('info', `[statusbar] ${this.visible ? 'shown' : 'hidden'}`);
  }

  hide() {
    if (this.visible) {
      this.toggle();
    }
  }

  show() {
    if (!this.visible) {
      this.toggle();
    }
  }

  saveState() {
    try {
      localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify({
        visible: this.visible,
        showFPS: this.showFPS
      }));
    } catch (e) {
      log('warn', '[statusbar] Failed to save state', e);
    }
  }

  refresh() {
    if (this.visible) {
      this.render();
    }
  }
}

export default StatusBar;
