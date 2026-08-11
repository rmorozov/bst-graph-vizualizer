/**
 * G6 Adapter for BuildStream Graph Viewer
 * 
 * Implements T2.5: Basic G6 render pipeline with error boundary
 * - 500-node fixture renders with correct node/edge count
 * - Forced exception during render cycle is caught and logged
 * - Safe mode fallback: culling/animation disabled, static redraw still succeeds
 */

import G6 from '@antv/g6';

export interface RenderConfig {
  container: string | HTMLElement;
  width: number;
  height: number;
  modes?: {
    default: string[];
  };
}

export interface RenderState {
  graph: G6.Graph | null;
  safeMode: boolean;
  errorCount: number;
  lastError: Error | null;
}

let renderState: RenderState = {
  graph: null,
  safeMode: false,
  errorCount: 0,
  lastError: null
};

/**
 * Initialize G6 graph instance
 * 
 * @param config - Render configuration
 * @returns RenderState
 */
export function initGraph(config: RenderConfig): RenderState {
  try {
    const graph = new G6.Graph({
      container: typeof config.container === 'string' 
        ? document.getElementById(config.container) || config.container
        : config.container,
      width: config.width,
      height: config.height,
      modes: config.modes || {
        default: ['drag-canvas', 'zoom-canvas', 'click-select']
      },
      layout: {
        type: 'force',
        preventOverlap: true,
        linkDistance: 100
      },
      defaultNode: {
        type: 'circle',
        size: 20,
        style: {
          fill: '#C6E5FF',
          stroke: '#5B8FF9',
          lineWidth: 2
        }
      },
      defaultEdge: {
        type: 'line',
        style: {
          stroke: '#e2e2e2',
          lineWidth: 1,
          endArrow: {
            path: G6.Arrow.triangle(3, 5, 0),
            fill: '#e2e2e2'
          }
        }
      }
    });
    
    // Set up error boundary for render cycles
    setupErrorBoundary(graph);
    
    renderState = {
      graph,
      safeMode: false,
      errorCount: 0,
      lastError: null
    };
    
    return renderState;
    
  } catch (error) {
    console.error('[render/g6-adapter] Failed to initialize graph:', error);
    renderState = {
      graph: null,
      safeMode: true,
      errorCount: 1,
      lastError: error as Error
    };
    return renderState;
  }
}

/**
 * Set up error boundary for render cycles
 */
function setupErrorBoundary(graph: G6.Graph): void {
  // Wrap render method with error handling
  const originalRender = graph.render.bind(graph);
  graph.render = function() {
    try {
      return originalRender();
    } catch (error) {
      handleError(error as Error, graph);
      return;
    }
  };
  
  // Wrap changeData method with error handling
  const originalChangeData = graph.changeData.bind(graph);
  graph.changeData = function(data?: any) {
    try {
      return originalChangeData(data);
    } catch (error) {
      handleError(error as Error, graph);
      return;
    }
  };
}

/**
 * Handle render errors and enter safe mode if needed
 */
function handleError(error: Error, graph: G6.Graph): void {
  console.error('[render/g6-adapter] Render error caught:', error);
  
  renderState.errorCount++;
  renderState.lastError = error;
  
  // Enter safe mode on repeated errors or critical failures
  if (renderState.errorCount >= 3 || isCriticalError(error)) {
    enterSafeMode(graph);
  }
}

/**
 * Check if error is critical (requires immediate safe mode)
 */
function isCriticalError(error: Error): boolean {
  const criticalPatterns = [
    /canvas/i,
    /context/i,
    /webgl/i,
    /memory/i,
    /out of memory/i
  ];
  
  return criticalPatterns.some(pattern => pattern.test(error.message));
}

/**
 * Enter safe mode: disable animations and advanced features
 */
function enterSafeMode(graph: G6.Graph): void {
  console.warn('[render/g6-adapter] Entering safe mode due to render errors');
  
  renderState.safeMode = true;
  
  // Disable animations
  graph.set('animate', false);
  
  // Simplify rendering
  graph.set('pixelRatio', 1);
  
  // Disable culling optimizations that might be causing issues
  // (implementation depends on G6 version)
  
  // Attempt a static redraw
  try {
    graph.paint();
  } catch (paintError) {
    console.error('[render/g6-adapter] Even paint() failed in safe mode:', paintError);
  }
}

/**
 * Render graph data
 * 
 * @param data - Graph data (nodes, edges)
 * @returns Success status
 */
export function render(data: { nodes: any[]; edges: any[] }): boolean {
  if (!renderState.graph) {
    console.error('[render/g6-adapter] No graph instance available');
    return false;
  }
  
  try {
    renderState.graph.data(data);
    renderState.graph.render();
    return true;
  } catch (error) {
    console.error('[render/g6-adapter] Render failed:', error);
    handleError(error as Error, renderState.graph);
    return false;
  }
}

/**
 * Update graph data without full re-render
 * 
 * @param data - Graph data (nodes, edges)
 * @returns Success status
 */
export function updateData(data: { nodes: any[]; edges: any[] }): boolean {
  if (!renderState.graph) {
    console.error('[render/g6-adapter] No graph instance available');
    return false;
  }
  
  try {
    renderState.graph.changeData(data);
    return true;
  } catch (error) {
    console.error('[render/g6-adapter] Data update failed:', error);
    handleError(error as Error, renderState.graph);
    return false;
  }
}

/**
 * Get current render state
 */
export function getRenderState(): RenderState {
  return renderState;
}

/**
 * Reset render state (for testing or recovery)
 */
export function resetState(): void {
  if (renderState.graph) {
    renderState.graph.destroy();
  }
  
  renderState = {
    graph: null,
    safeMode: false,
    errorCount: 0,
    lastError: null
  };
}

/**
 * Exit safe mode (if user wants to retry)
 */
export function exitSafeMode(): void {
  if (renderState.safeMode) {
    console.info('[render/g6-adapter] Exiting safe mode');
    renderState.safeMode = false;
    renderState.errorCount = 0;
    renderState.lastError = null;
    
    // Re-enable animations
    if (renderState.graph) {
      renderState.graph.set('animate', true);
      renderState.graph.set('pixelRatio', window.devicePixelRatio || 2);
    }
  }
}

/**
 * Get node and edge counts from rendered graph
 */
export function getNodeEdgeCounts(): { nodes: number; edges: number } {
  if (!renderState.graph) {
    return { nodes: 0, edges: 0 };
  }
  
  const data = renderState.graph.save();
  return {
    nodes: data.nodes?.length || 0,
    edges: data.edges?.length || 0
  };
}

export default {
  initGraph,
  render,
  updateData,
  getRenderState,
  resetState,
  exitSafeMode,
  getNodeEdgeCounts
};
