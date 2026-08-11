/**
 * Main Entry Point - Viewer Application Wiring
 * Spec §4.1: Module wiring only, no logic lives here
 */

import { stateStore } from './core/state-store.js';
import { validateSchema } from './core/schema-validate.js';
import { buildIndexes } from './core/indexes.js';
import { computeModes } from './core/modes.js';
import { initRenderer } from './render/g6-adapter.js';
import { initFileLoader } from './ui/file-loader.js';
import { initSidebar } from './ux/sidebar.js';
import { initBreadcrumb } from './ux/breadcrumb.js';
import { initStatusbar } from './ux/statusbar.js';
import { initHelp } from './ux/help.js';
import { initHover } from './interaction/hover.js';
import { initSelection } from './interaction/selection.js';
import { initSearch } from './interaction/search.js';
import { initSliders } from './interaction/sliders.js';
import { initComboExpand } from './interaction/combo-expand.js';
import FPSMonitor from './perf/fps-monitor.js';
import AdaptiveQualityManager from './perf/adaptive-quality.js';
import SpatialCuller from './perf/culling.js';
import { logInfo, logError } from './perf/logger.js';

class ViewerApp {
  constructor() {
    this.initialized = false;
    this.fpsMonitor = null;
    this.qualityManager = null;
    this.culler = null;
    
    logInfo('main', 'Viewer app constructed');
  }
  
  /**
   * Initialize the viewer application
   */
  async init() {
    try {
      logInfo('main', 'Starting viewer initialization');
      
      // Initialize FPS monitoring
      this.fpsMonitor = new FPSMonitor((data) => {
        stateStore.updatePerformance(data.fps, data.degraded, data.qualityLevel);
      });
      this.fpsMonitor.start();
      
      // Initialize adaptive quality
      this.qualityManager = new AdaptiveQualityManager(
        this.fpsMonitor,
        (changes) => {
          logInfo('main', 'Quality settings changed', changes);
        }
      );
      
      // Initialize UI components
      initFileLoader(this.handleFileLoad.bind(this));
      initSidebar(stateStore);
      initBreadcrumb(stateStore);
      initStatusbar(stateStore, this.fpsMonitor);
      initHelp();
      
      // Initialize interaction handlers
      initHover(stateStore);
      initSelection(stateStore);
      initSearch(stateStore);
      initSliders(stateStore);
      initComboExpand(stateStore);
      
      // Initialize renderer (will render once data is loaded)
      initRenderer(stateStore, this.qualityManager);
      
      this.initialized = true;
      logInfo('main', 'Viewer initialization complete');
      
    } catch (error) {
      logError('main', 'Initialization failed', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Handle file load event
   */
  async handleFileLoad(graphData) {
    try {
      logInfo('main', 'Loading graph data', { 
        nodes: graphData.nodes?.length ?? 0,
        edges: graphData.edges?.length ?? 0 
      });
      
      // Validate schema
      const validation = validateSchema(graphData);
      if (!validation.valid) {
        throw new Error(`Schema validation failed: ${validation.errors.join(', ')}`);
      }
      
      // Update state store
      stateStore.loadGraphData(graphData);
      
      // Build indexes
      const indexes = buildIndexes(graphData);
      
      // Initialize culler
      this.culler = new SpatialCuller(
        indexes.spatialIndex,
        indexes.comboSpatialIndex
      );
      
      // Compute initial modes
      computeModes(graphData, stateStore);
      
      // Trigger initial render
      // Renderer will be notified via state store events
      
      logInfo('main', 'Graph data loaded successfully');
      
    } catch (error) {
      logError('main', 'Failed to load graph data', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Get diagnostic report
   */
  getDiagnosticReport() {
    return {
      appState: {
        initialized: this.initialized,
        timestamp: new Date().toISOString()
      },
      stateDump: stateStore.dumpState(),
      performance: {
        fps: this.fpsMonitor?.getDiagnosticInfo(),
        quality: this.qualityManager?.getDiagnosticInfo()
      },
      culling: this.culler?.getStats()
    };
  }
}

// Create and initialize app
const app = new ViewerApp();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}

// Export for debugging
window.viewerApp = app;

export default app;
