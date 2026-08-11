/**
 * Adaptive Quality Manager - FPS-based quality adjustment with interaction gating
 * Spec §4.9.2: degrade/recover with interaction-gated recovery
 */

import { logInfo, logWarning } from './logger.js';

const QUALITY_SETTINGS = {
  high: {
    nodeLabels: true,
    edgeLabels: true,
    nodeGlow: true,
    edgeBundling: false,
    lodThreshold: 0.3,
    maxVisibleNodes: Infinity,
    maxVisibleEdges: Infinity,
    animationEnabled: true
  },
  medium: {
    nodeLabels: true,
    edgeLabels: false,
    nodeGlow: false,
    edgeBundling: false,
    lodThreshold: 0.5,
    maxVisibleNodes: 10000,
    maxVisibleEdges: 50000,
    animationEnabled: true
  },
  low: {
    nodeLabels: false,
    edgeLabels: false,
    nodeGlow: false,
    edgeBundling: true,
    lodThreshold: 0.7,
    maxVisibleNodes: 5000,
    maxVisibleEdges: 20000,
    animationEnabled: false
  }
};

class AdaptiveQualityManager {
  constructor(fpsMonitor, onQualityChange) {
    this.fpsMonitor = fpsMonitor;
    this.onQualityChange = onQualityChange;
    this.currentQuality = 'high';
    this.isInteracting = false;
    this.interactionTimeout = null;
    this.pendingRecovery = false;
    this.manualOverride = false;
    
    // Subscribe to FPS monitor
    if (this.fpsMonitor) {
      this.fpsMonitor.onQualityChange = (data) => this.handleFPSChange(data);
    }
    
    logInfo('adaptive-quality', 'Adaptive quality manager initialized');
  }
  
  /**
   * Handle FPS-based quality change from monitor
   */
  handleFPSChange(data) {
    const { qualityLevel, degraded, fps } = data;
    
    // Don't auto-adjust during interaction or manual override
    if (this.isInteracting || this.manualOverride) {
      this.pendingRecovery = !degraded;
      return;
    }
    
    this.applyQualitySettings(qualityLevel, 'auto');
  }
  
  /**
   * Apply quality settings
   */
  applyQualitySettings(qualityLevel, source = 'auto') {
    if (qualityLevel === this.currentQuality && source !== 'force') {
      return;
    }
    
    const oldQuality = this.currentQuality;
    this.currentQuality = qualityLevel;
    
    const settings = QUALITY_SETTINGS[qualityLevel];
    
    logInfo('adaptive-quality', `Quality changed: ${oldQuality} → ${qualityLevel}`, { 
      source,
      ...settings 
    });
    
    if (this.onQualityChange) {
      this.onQualityChange({
        quality: qualityLevel,
        settings,
        source,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Mark interaction as started (disables auto-recovery)
   */
  startInteraction() {
    if (this.isInteracting) return;
    
    this.isInteracting = true;
    clearTimeout(this.interactionTimeout);
    
    logInfo('adaptive-quality', 'Interaction started, auto-recovery paused');
  }
  
  /**
   * Mark interaction as ended (enables pending recovery after delay)
   */
  endInteraction() {
    if (!this.isInteracting) return;
    
    this.isInteracting = false;
    
    // Gate recovery: wait 500ms after interaction ends
    this.interactionTimeout = setTimeout(() => {
      if (this.pendingRecovery && !this.manualOverride) {
        this.applyQualitySettings('high', 'recovery');
        this.pendingRecovery = false;
      }
    }, 500);
    
    logInfo('adaptive-quality', 'Interaction ended, recovery gated');
  }
  
  /**
   * Force a specific quality level (manual override)
   */
  forceQuality(level) {
    if (!['high', 'medium', 'low'].includes(level)) {
      logWarning('adaptive-quality', `Invalid quality level: ${level}`);
      return;
    }
    
    this.manualOverride = true;
    this.pendingRecovery = false;
    this.applyQualitySettings(level, 'manual');
    
    logInfo('adaptive-quality', 'Manual quality override enabled');
  }
  
  /**
   * Clear manual override (return to auto)
   */
  clearManualOverride() {
    this.manualOverride = false;
    logInfo('adaptive-quality', 'Manual override cleared, returning to auto');
    
    // Re-evaluate based on current FPS
    if (this.fpsMonitor) {
      const fps = this.fpsMonitor.getFPS();
      if (fps < 30) {
        this.applyQualitySettings('low', 'auto');
      } else if (fps < 50) {
        this.applyQualitySettings('medium', 'auto');
      } else {
        this.applyQualitySettings('high', 'auto');
      }
    }
  }
  
  /**
   * Get current quality settings
   */
  getCurrentSettings() {
    return QUALITY_SETTINGS[this.currentQuality];
  }
  
  /**
   * Check if a feature is enabled at current quality
   */
  isFeatureEnabled(feature) {
    const settings = this.getCurrentSettings();
    return settings[feature] ?? false;
  }
  
  /**
   * Get diagnostic info
   */
  getDiagnosticInfo() {
    return {
      currentQuality: this.currentQuality,
      isInteracting: this.isInteracting,
      manualOverride: this.manualOverride,
      pendingRecovery: this.pendingRecovery,
      settings: this.getCurrentSettings(),
      fps: this.fpsMonitor?.getFPS() ?? 0
    };
  }
  
  /**
   * Reset to defaults
   */
  reset() {
    this.currentQuality = 'high';
    this.isInteracting = false;
    this.pendingRecovery = false;
    this.manualOverride = false;
    clearTimeout(this.interactionTimeout);
    
    logInfo('adaptive-quality', 'Adaptive quality reset');
  }
}

export default AdaptiveQualityManager;
