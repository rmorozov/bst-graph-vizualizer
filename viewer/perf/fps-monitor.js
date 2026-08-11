/**
 * FPS Monitor - Real-time performance monitoring with degradation/recovery
 * Spec §4.9.2: adaptive quality based on FPS thresholds
 */

import { logInfo, logWarning } from './logger.js';

const FPS_SAMPLES = 30; // Number of frames to average
const DEGRADATION_THRESHOLD = 30; // FPS below this triggers degradation
const RECOVERY_THRESHOLD = 50; // FPS above this allows recovery
const MIN_SAMPLE_TIME = 100; // Minimum ms between quality changes

class FPSMonitor {
  constructor(onQualityChange) {
    this.samples = [];
    this.lastFrameTime = 0;
    this.currentFPS = 60;
    this.degraded = false;
    this.qualityLevel = 'high'; // 'high', 'medium', 'low'
    this.onQualityChange = onQualityChange;
    this.lastQualityChange = 0;
    this.frameCount = 0;
    this.running = false;
    
    this.animationFrameId = null;
  }
  
  /**
   * Start monitoring
   */
  start() {
    if (this.running) return;
    
    this.running = true;
    this.lastFrameTime = performance.now();
    this.tick();
    
    logInfo('fps-monitor', 'FPS monitoring started');
  }
  
  /**
   * Stop monitoring
   */
  stop() {
    this.running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    logInfo('fps-monitor', 'FPS monitoring stopped');
  }
  
  /**
   * Internal tick function
   */
  tick() {
    if (!this.running) return;
    
    const now = performance.now();
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;
    
    // Calculate instantaneous FPS
    const instantFPS = delta > 0 ? 1000 / delta : 60;
    
    // Add to samples
    this.samples.push(instantFPS);
    if (this.samples.length > FPS_SAMPLES) {
      this.samples.shift();
    }
    
    // Calculate average FPS
    this.currentFPS = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.frameCount++;
    
    // Check for quality adjustment
    this.checkQualityAdjustment(now);
    
    this.animationFrameId = requestAnimationFrame(() => this.tick());
  }
  
  /**
   * Check if quality should be adjusted
   */
  checkQualityAdjustment(now) {
    // Don't adjust too frequently
    if (now - this.lastQualityChange < MIN_SAMPLE_TIME) return;
    
    const wasDegraded = this.degraded;
    const wasQuality = this.qualityLevel;
    
    // Determine if we should degrade or recover
    if (this.currentFPS < DEGRADATION_THRESHOLD && !this.degraded) {
      // Need to degrade
      this.degrade();
    } else if (this.currentFPS > RECOVERY_THRESHOLD && this.degraded) {
      // Can recover
      this.recover();
    }
    
    // Notify if state changed
    if (this.degraded !== wasDegraded || this.qualityLevel !== wasQuality) {
      this.notifyQualityChange();
      this.lastQualityChange = now;
    }
  }
  
  /**
   * Degrade quality level
   */
  degrade() {
    const oldLevel = this.qualityLevel;
    
    if (this.qualityLevel === 'high') {
      this.qualityLevel = 'medium';
      this.degraded = true;
      logWarning('fps-monitor', 'Performance degraded: high → medium', { fps: Math.round(this.currentFPS) });
    } else if (this.qualityLevel === 'medium') {
      this.qualityLevel = 'low';
      this.degraded = true;
      logWarning('fps-monitor', 'Performance degraded: medium → low', { fps: Math.round(this.currentFPS) });
    }
    // Already at 'low', stay there
  }
  
  /**
   * Recover quality level
   */
  recover() {
    const oldLevel = this.qualityLevel;
    
    if (this.qualityLevel === 'low') {
      this.qualityLevel = 'medium';
      logInfo('fps-monitor', 'Performance recovered: low → medium', { fps: Math.round(this.currentFPS) });
    } else if (this.qualityLevel === 'medium') {
      this.qualityLevel = 'high';
      this.degraded = false;
      logInfo('fps-monitor', 'Performance recovered: medium → high', { fps: Math.round(this.currentFPS) });
    }
    // Already at 'high', stay there
  }
  
  /**
   * Notify callback of quality change
   */
  notifyQualityChange() {
    if (this.onQualityChange) {
      this.onQualityChange({
        qualityLevel: this.qualityLevel,
        degraded: this.degraded,
        fps: Math.round(this.currentFPS),
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Get current FPS
   */
  getFPS() {
    return Math.round(this.currentFPS);
  }
  
  /**
   * Get current quality level
   */
  getQualityLevel() {
    return this.qualityLevel;
  }
  
  /**
   * Check if currently degraded
   */
  isDegraded() {
    return this.degraded;
  }
  
  /**
   * Force a specific quality level (for manual override)
   */
  forceQuality(level) {
    if (!['high', 'medium', 'low'].includes(level)) {
      logWarning('fps-monitor', `Invalid quality level: ${level}`);
      return;
    }
    
    this.qualityLevel = level;
    this.degraded = level !== 'high';
    this.notifyQualityChange();
    this.lastQualityChange = performance.now();
    
    logInfo('fps-monitor', `Quality forced to ${level}`, { manual: true });
  }
  
  /**
   * Reset monitoring state
   */
  reset() {
    this.samples = [];
    this.currentFPS = 60;
    this.degraded = false;
    this.qualityLevel = 'high';
    this.lastQualityChange = 0;
    this.frameCount = 0;
    
    logInfo('fps-monitor', 'FPS monitor reset');
  }
  
  /**
   * Get diagnostic info
   */
  getDiagnosticInfo() {
    return {
      currentFPS: Math.round(this.currentFPS),
      averageFPS: Math.round(this.samples.reduce((a, b) => a + b, 0) / this.samples.length),
      minFPS: Math.round(Math.min(...this.samples)),
      maxFPS: Math.round(Math.max(...this.samples)),
      qualityLevel: this.qualityLevel,
      degraded: this.degraded,
      sampleCount: this.samples.length,
      frameCount: this.frameCount
    };
  }
}

export default FPSMonitor;
