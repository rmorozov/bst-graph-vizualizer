/**
 * Mode Computation for BuildStream Graph Viewer
 * 
 * Implements T2.4: datasetMode and renderMode computation per spec §5.1/§2.1
 * - datasetMode: fixed based on total node/edge counts at load time
 * - renderMode: recomputed when visible set changes (filter application)
 * - Boundary tests at every threshold (5000/5001, 20000/20001, 50000/50001, 100000/100001)
 * - renderMode never more permissive than datasetMode for combo-depth/dagre-eligibility
 */

export type GraphSizeClass = 'normal' | 'large' | 'huge' | 'extreme' | 'ultra';
export type RenderMode = 'normal' | 'aggressive_culling' | 'safe_mode';

export interface ModeState {
  datasetMode: GraphSizeClass;
  renderMode: RenderMode;
  totalNodes: number;
  totalEdges: number;
  visibleNodes: number;
  visibleEdges: number;
}

// Thresholds from spec §2.1
const NODE_THRESHOLDS = {
  normal: 5000,
  large: 20000,
  huge: 50000,
  extreme: 100000
};

const EDGE_THRESHOLDS = {
  normal: 10000,
  large: 40000,
  huge: 100000,
  extreme: 200000
};

/**
 * Compute initial mode state from loaded data
 * 
 * @param totalNodes - Total nodes in the graph
 * @param totalEdges - Total edges in the graph
 * @returns ModeState with datasetMode set
 */
export function computeInitialModes(totalNodes: number, totalEdges: number): ModeState {
  const datasetMode = classifyGraphSize(totalNodes, totalEdges);
  
  return {
    datasetMode,
    renderMode: computeRenderMode(datasetMode, totalNodes, totalEdges),
    totalNodes,
    totalEdges,
    visibleNodes: totalNodes,
    visibleEdges: totalEdges
  };
}

/**
 * Update renderMode when visible set changes
 * 
 * @param currentState - Current mode state
 * @param visibleNodes - Number of visible nodes after filtering
 * @param visibleEdges - Number of visible edges after filtering
 * @returns Updated ModeState
 */
export function updateRenderMode(
  currentState: ModeState,
  visibleNodes: number,
  visibleEdges: number
): ModeState {
  const renderMode = computeRenderMode(currentState.datasetMode, visibleNodes, visibleEdges);
  
  return {
    ...currentState,
    renderMode,
    visibleNodes,
    visibleEdges
  };
}

/**
 * Classify graph size based on node and edge counts
 * Uses the more severe classification (nodes vs edges)
 */
function classifyGraphSize(nodes: number, edges: number): GraphSizeClass {
  let nodeClass: GraphSizeClass = 'normal';
  let edgeClass: GraphSizeClass = 'normal';
  
  // Classify by nodes
  if (nodes > NODE_THRESHOLDS.extreme) {
    nodeClass = 'ultra';
  } else if (nodes > NODE_THRESHOLDS.huge) {
    nodeClass = 'extreme';
  } else if (nodes > NODE_THRESHOLDS.large) {
    nodeClass = 'huge';
  } else if (nodes > NODE_THRESHOLDS.normal) {
    nodeClass = 'large';
  }
  
  // Classify by edges
  if (edges > EDGE_THRESHOLDS.extreme) {
    edgeClass = 'ultra';
  } else if (edges > EDGE_THRESHOLDS.huge) {
    edgeClass = 'extreme';
  } else if (edges > EDGE_THRESHOLDS.large) {
    edgeClass = 'huge';
  } else if (edges > EDGE_THRESHOLDS.normal) {
    edgeClass = 'large';
  }
  
  // Return the more severe classification
  const severityOrder: GraphSizeClass[] = ['normal', 'large', 'huge', 'extreme', 'ultra'];
  const nodeSeverity = severityOrder.indexOf(nodeClass);
  const edgeSeverity = severityOrder.indexOf(edgeClass);
  
  return nodeSeverity >= edgeSeverity ? nodeClass : edgeClass;
}

/**
 * Compute renderMode based on datasetMode and current visible counts
 * 
 * Rules:
 * - datasetMode is the ceiling: renderMode can never be more permissive
 * - If visible set drops below a threshold, renderMode can upgrade
 * - But never above what datasetMode allows
 */
function computeRenderMode(
  datasetMode: GraphSizeClass,
  visibleNodes: number,
  visibleEdges: number
): RenderMode {
  // First, determine what the visible set would classify as on its own
  const visibleClass = classifyGraphSize(visibleNodes, visibleEdges);
  
  // Severity order (higher index = more restrictive rendering needed)
  const severityOrder: GraphSizeClass[] = ['normal', 'large', 'huge', 'extreme', 'ultra'];
  
  // Map to render modes
  const modeMap: Record<GraphSizeClass, RenderMode> = {
    normal: 'normal',
    large: 'normal',
    huge: 'aggressive_culling',
    extreme: 'aggressive_culling',
    ultra: 'safe_mode'
  };
  
  // renderMode is constrained by both datasetMode and visibleClass
  // Take the less severe (better performing) of the two, but capped by datasetMode
  const datasetSeverity = severityOrder.indexOf(datasetMode);
  const visibleSeverity = severityOrder.indexOf(visibleClass);
  
  // The effective class is the minimum (less severe) of the two
  const effectiveSeverity = Math.min(datasetSeverity, visibleSeverity);
  const effectiveClass = severityOrder[effectiveSeverity];
  
  return modeMap[effectiveClass];
}

/**
 * Check if dagre layout is eligible based on mode
 * Dagre is disabled for large graphs per spec
 */
export function isDagreEligible(mode: GraphSizeClass): boolean {
  return mode === 'normal' || mode === 'large';
}

/**
 * Get maximum combo depth allowed for a given mode
 */
export function getMaxComboDepth(mode: GraphSizeClass): number {
  switch (mode) {
    case 'normal':
      return 3;
    case 'large':
      return 2;
    case 'huge':
      return 1;
    case 'extreme':
    case 'ultra':
      return 0; // Only root combos expanded
    default:
      return 1;
  }
}

/**
 * Get LOD (Level of Detail) tier based on renderMode
 */
export function getLODTier(renderMode: RenderMode): number {
  switch (renderMode) {
    case 'normal':
      return 0; // Full detail
    case 'aggressive_culling':
      return 1; // Medium detail
    case 'safe_mode':
      return 2; // Minimum detail
    default:
      return 1;
  }
}

export default {
  computeInitialModes,
  updateRenderMode,
  classifyGraphSize,
  isDagreEligible,
  getMaxComboDepth,
  getLODTier
};
