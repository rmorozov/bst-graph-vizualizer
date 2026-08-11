/**
 * Interaction Sliders — §4.4.2
 * 
 * Handles metric and build-stage slider interactions with RAF throttling.
 * Collapses rapid input events to one resolver call per animation frame.
 * Disables appropriately when reachability is disabled/targeted.
 */

import { logger } from '../perf/logger.js';

export class SliderController {
  /**
   * @param {Object} options
   * @param {import('./resolver.js').VisibilityResolver} options.resolver
   * @param {(result: import('./resolver.js').ResolverResult) => void} options.onResolve - Callback when resolution completes
   * @param {() => Object} options.getState - Function to get current app state (for checking reachabilityMode)
   * @param {(mode: string) => void} options.setTargetedModeNote - Function to show targeted mode explanation
   */
  constructor(options) {
    this.resolver = options.resolver;
    this.onResolve = options.onResolve;
    this.getState = options.getState;
    this.setTargetedModeNote = options.setTargetedModeNote;
    
    // Pending updates (to be applied on next RAF)
    this._pendingUpdates = new Map();
    this._rafScheduled = false;
    
    // Slider DOM elements (set via attachSliders)
    this._metricSlider = null;
    this._buildStageSlider = null;
    this._metricFieldSelect = null;
    
    // Current values
    this._metricMin = 0;
    this._metricMax = 1;
    this._metricField = 'buildCost';
    this._buildStageMin = 0;
    this._buildStageMax = 1;
    
    // Event listeners for cleanup
    this._listeners = [];
  }
  
  /**
   * Attach slider DOM elements
   * @param {Object} elements
   * @param {HTMLInputElement} elements.metricSlider
   * @param {HTMLInputElement} elements.buildStageSlider
   * @param {HTMLSelectElement} [elements.metricFieldSelect]
   */
  attachSliders(elements) {
    this._metricSlider = elements.metricSlider;
    this._buildStageSlider = elements.buildStageSlider;
    this._metricFieldSelect = elements.metricFieldSelect;
    
    // Attach event listeners
    if (this._metricSlider) {
      const metricHandler = this._onMetricInput.bind(this);
      this._metricSlider.addEventListener('input', metricHandler);
      this._listeners.push({ el: this._metricSlider, handler: metricHandler });
    }
    
    if (this._buildStageSlider) {
      const stageHandler = this._onBuildStageInput.bind(this);
      this._buildStageSlider.addEventListener('input', stageHandler);
      this._listeners.push({ el: this._buildStageSlider, handler: stageHandler });
    }
    
    if (this._metricFieldSelect) {
      const fieldHandler = this._onMetricFieldChange.bind(this);
      this._metricFieldSelect.addEventListener('change', fieldHandler);
      this._listeners.push({ el: this._metricFieldSelect, handler: fieldHandler });
    }
    
    // Initialize slider positions
    this._updateSliderStates();
  }
  
  /**
   * Handle metric slider input
   * @param {Event} event
   */
  _onMetricInput(event) {
    const target = event.target;
    const isMin = target.dataset.type === 'min';
    
    if (isMin) {
      this._metricMin = parseFloat(target.value);
      // Ensure min <= max
      if (this._metricMin > this._metricMax) {
        this._metricMin = this._metricMax;
        target.value = this._metricMin.toString();
      }
    } else {
      this._metricMax = parseFloat(target.value);
      // Ensure max >= min
      if (this._metricMax < this._metricMin) {
        this._metricMax = this._metricMin;
        target.value = this._metricMax.toString();
      }
    }
    
    this._scheduleResolution('metricSlider');
  }
  
  /**
   * Handle build stage slider input
   * @param {Event} event
   */
  _onBuildStageInput(event) {
    const target = event.target;
    const isMin = target.dataset.type === 'min';
    
    if (isMin) {
      this._buildStageMin = parseFloat(target.value);
      if (this._buildStageMin > this._buildStageMax) {
        this._buildStageMin = this._buildStageMax;
        target.value = this._buildStageMin.toString();
      }
    } else {
      this._buildStageMax = parseFloat(target.value);
      if (this._buildStageMax < this._buildStageMin) {
        this._buildStageMax = this._buildStageMin;
        target.value = this._buildStageMax.toString();
      }
    }
    
    this._scheduleResolution('buildStageSlider');
  }
  
  /**
   * Handle metric field change (buildCost/bottleneckScore/blastRadius)
   * @param {Event} event
   */
  _onMetricFieldChange(event) {
    this._metricField = event.target.value;
    this._scheduleResolution('metricSlider');
  }
  
  /**
   * Schedule a resolution update for the next RAF
   * Multiple rapid inputs collapse into a single resolver call
   * 
   * @param {string} dimension
   */
  _scheduleResolution(dimension) {
    // Mark this dimension as needing update
    let filterValue;
    
    if (dimension === 'metricSlider') {
      filterValue = {
        min: this._metricMin,
        max: this._metricMax,
        field: this._metricField
      };
    } else if (dimension === 'buildStageSlider') {
      filterValue = {
        min: this._buildStageMin,
        max: this._buildStageMax
      };
    }
    
    this._pendingUpdates.set(dimension, filterValue);
    
    // Schedule RAF if not already scheduled
    if (!this._rafScheduled) {
      this._rafScheduled = true;
      requestAnimationFrame(this._processUpdates.bind(this));
    }
  }
  
  /**
   * Process all pending updates (called by RAF)
   */
  _processUpdates() {
    this._rafScheduled = false;
    
    // Apply each pending update
    for (const [dimension, filterValue] of this._pendingUpdates) {
      const result = this.resolver.updateFilter(dimension, filterValue);
      
      // Update UI with results
      this._updateSliderStates(result.perDimensionCounts);
      
      // Notify callback
      if (this.onResolve) {
        this.onResolve(result);
      }
    }
    
    this._pendingUpdates.clear();
  }
  
  /**
   * Update slider DOM states based on current reachability mode
   * Shows appropriate tooltips/disabled states
   */
  _updateSliderStates(perDimensionCounts) {
    const state = this.getState();
    const reachabilityMode = state?.analysisModes?.reachabilityMode || 'exact';
    
    // Check if metric slider should be disabled
    const disabledModes = ['disabled_by_user', 'disabled_memory_budget', 'disabled_timeout'];
    const isDisabled = disabledModes.includes(reachabilityMode);
    
    if (this._metricSlider && isDisabled) {
      this._metricSlider.disabled = true;
      this._showTooltip(this._metricSlider, 
        `Reachability metrics disabled: ${reachabilityMode}`
      );
    } else if (this._metricSlider) {
      this._metricSlider.disabled = false;
      this._hideTooltip(this._metricSlider);
      
      // Show targeted mode note if applicable
      if (reachabilityMode === 'targeted' && this.setTargetedModeNote) {
        this.setTargetedModeNote(
          'Showing reachability for critical nodes only. Other nodes have null values.'
        );
      }
    }
    
    // Update slider labels with counts if available
    if (perDimensionCounts) {
      const metricCountEl = document.getElementById('metric-slider-count');
      const stageCountEl = document.getElementById('stage-slider-count');
      
      if (metricCountEl) {
        metricCountEl.textContent = `${perDimensionCounts.metricSlider} nodes`;
      }
      if (stageCountEl) {
        stageCountEl.textContent = `${perDimensionCounts.buildStageSlider} nodes`;
      }
    }
  }
  
  /**
   * Show tooltip on an element
   * @param {HTMLElement} element
   * @param {string} message
   */
  _showTooltip(element, message) {
    element.title = message;
    element.setAttribute('data-tooltip', message);
  }
  
  /**
   * Hide tooltip on an element
   * @param {HTMLElement} element
   */
  _hideTooltip(element) {
    element.title = '';
    element.removeAttribute('data-tooltip');
  }
  
  /**
   * Check if we're currently in a slider-drag interaction
   * Used by hover/selection to suppress their updates during slider drag
   * 
   * @returns {boolean}
   */
  isDragging() {
    return this._rafScheduled || this._pendingUpdates.size > 0;
  }
  
  /**
   * Get current slider values
   * @returns {Object}
   */
  getValues() {
    return {
      metricMin: this._metricMin,
      metricMax: this._metricMax,
      metricField: this._metricField,
      buildStageMin: this._buildStageMin,
      buildStageMax: this._buildStageMax
    };
  }
  
  /**
   * Set slider values programmatically
   * @param {Object} values
   */
  setValues(values) {
    if (values.metricMin !== undefined) this._metricMin = values.metricMin;
    if (values.metricMax !== undefined) this._metricMax = values.metricMax;
    if (values.metricField !== undefined) this._metricField = values.metricField;
    if (values.buildStageMin !== undefined) this._buildStageMin = values.buildStageMin;
    if (values.buildStageMax !== undefined) this._buildStageMax = values.buildStageMax;
    
    // Update DOM and trigger resolution
    this._updateSliderStates();
    this._scheduleResolution('metricSlider');
    this._scheduleResolution('buildStageSlider');
  }
  
  /**
   * Clean up event listeners
   */
  destroy() {
    // Remove all event listeners
    for (const { el, handler } of this._listeners) {
      el.removeEventListener('input', handler);
      el.removeEventListener('change', handler);
    }
    this._listeners = [];
    
    // Cancel any pending RAF
    if (this._rafScheduled) {
      this._rafScheduled = false;
      // RAF will fire but _processUpdates will see flag false and do nothing
    }
  }
}

// Export factory function
export function createSliderController(options) {
  return new SliderController(options);
}
