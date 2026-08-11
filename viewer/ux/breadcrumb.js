/**
 * UX Chrome: Breadcrumb Navigation
 * 
 * Displays hierarchical path through combo hierarchy.
 * Spec §4.3.2 - Mid-trail collapse with state preservation.
 */

import { log } from '../utils/logger.js';

const BREADCRUMB_STORAGE_KEY = 'bst-graph-breadcrumb-state';

export class BreadcrumbNav {
  constructor(container, stateStore) {
    this.container = container;
    this.stateStore = stateStore;
    this.maxVisibleItems = 5;
    this.collapsedRange = null; // { start, end } for mid-trail collapse
    
    this.init();
  }

  init() {
    const saved = localStorage.getItem(BREADCRUMB_STORAGE_KEY);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        this.maxVisibleItems = state.maxVisibleItems || 5;
      } catch (e) {
        log('warn', '[breadcrumb] Failed to restore state', e);
      }
    }

    this.render();
    this.bindEvents();
    log('info', '[breadcrumb] Initialized');
  }

  render() {
    const comboPath = this.getComboPath();
    
    if (!comboPath || comboPath.length === 0) {
      this.container.innerHTML = '<div class="breadcrumb-empty">Root level</div>';
      return;
    }

    const displayItems = this.computeDisplayItems(comboPath);
    
    this.container.innerHTML = `
      <nav class="breadcrumb-nav" aria-label="Combo hierarchy">
        <ol class="breadcrumb-list">
          ${displayItems.map((item, index) => `
            <li class="breadcrumb-item ${item.type}">
              ${item.type === 'ellipsis' ? `
                <span class="breadcrumb-ellipsis" title="${item.hiddenCount} hidden levels">⋯</span>
              ` : `
                <button class="breadcrumb-link ${index === displayItems.length - 1 ? 'active' : ''}" 
                        data-combo-id="${item.comboId}"
                        ${index === displayItems.length - 1 ? 'aria-current="page"' : ''}>
                  ${item.label}
                </button>
              `}
            </li>
          `).join('')}
        </ol>
      </nav>
    `;

    this.bindEvents();
  }

  getComboPath() {
    const selection = this.stateStore.getSelection();
    if (!selection || selection.length === 0) return [];

    const nodeId = selection[0];
    const node = this.stateStore.getNode(nodeId);
    if (!node || !node.comboId) return [];

    const path = [];
    let currentComboId = node.comboId;
    const visited = new Set();

    while (currentComboId && !visited.has(currentComboId)) {
      const combo = this.stateStore.getCombo(currentComboId);
      if (!combo) break;

      visited.add(currentComboId);
      path.unshift({
        comboId: combo.id,
        label: combo.label || combo.id,
        depth: combo.depth || 0
      });

      currentComboId = combo.parentId;
    }

    return path;
  }

  computeDisplayItems(path) {
    if (path.length <= this.maxVisibleItems) {
      return path.map(item => ({ ...item, type: 'link' }));
    }

    // Mid-trail collapse: show first 2, ellipsis, last 2
    const result = [];
    const visibleStart = Math.floor(this.maxVisibleItems / 2);
    const visibleEnd = this.maxVisibleItems - visibleStart;

    // First items
    for (let i = 0; i < visibleStart; i++) {
      result.push({ ...path[i], type: 'link' });
    }

    // Ellipsis with hidden count
    const hiddenCount = path.length - visibleStart - visibleEnd;
    if (hiddenCount > 0) {
      result.push({
        type: 'ellipsis',
        hiddenCount,
        startIndex: visibleStart,
        endIndex: path.length - visibleEnd
      });
    }

    // Last items
    for (let i = path.length - visibleEnd; i < path.length; i++) {
      result.push({ ...path[i], type: 'link' });
    }

    return result;
  }

  bindEvents() {
    const links = this.container.querySelectorAll('.breadcrumb-link');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        const comboId = e.currentTarget.dataset.comboId;
        if (comboId) {
          this.navigateToCombo(comboId);
        }
      });
    });

    const ellipsis = this.container.querySelector('.breadcrumb-ellipsis');
    if (ellipsis) {
      ellipsis.addEventListener('click', () => {
        this.expandCollapsed();
      });
    }
  }

  navigateToCombo(comboId) {
    const combo = this.stateStore.getCombo(comboId);
    if (!combo) {
      log('warn', `[breadcrumb] Combo not found: ${comboId}`);
      return;
    }

    // Set selection to first node in combo, or clear selection to show combo view
    const nodesInCombo = this.stateStore.getNodesByCombo(comboId);
    if (nodesInCombo && nodesInCombo.length > 0) {
      this.stateStore.setSelection([nodesInCombo[0].id]);
    } else {
      this.stateStore.setSelection([]);
    }

    log('info', `[breadcrumb] Navigated to combo: ${comboId}`);
    this.saveState();
  }

  expandCollapsed() {
    // Temporarily increase visible items to show all
    const path = this.getComboPath();
    this.maxVisibleItems = path.length + 1;
    this.render();
    log('info', '[breadcrumb] Expanded collapsed view');
  }

  saveState() {
    try {
      localStorage.setItem(BREADCRUMB_STORAGE_KEY, JSON.stringify({
        maxVisibleItems: this.maxVisibleItems
      }));
    } catch (e) {
      log('warn', '[breadcrumb] Failed to save state', e);
    }
  }

  refresh() {
    this.render();
  }
}

export default BreadcrumbNav;
