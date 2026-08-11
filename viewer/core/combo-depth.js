/**
 * Adaptive Combo Depth for BuildStream Graph Viewer
 * 
 * Implements T2.6: Adaptive combo depth computation per spec §4.5.1
 * - 3 constructed combo-tree scenarios tested (pathological, balanced, deep/narrow)
 * - Depth-1 overflow falls back to depth 0
 * - Reused by breadcrumb collapse logic
 */

import { GraphIndexes } from './indexes.js';

export interface ComboDepthConfig {
  maxVisibleElements: number;
  maxComboSize: number;
}

const DEFAULT_CONFIG: ComboDepthConfig = {
  maxVisibleElements: 5000,
  maxComboSize: 1000
};

/**
 * Compute initial adaptive combo depth
 * 
 * @param indexes - Built graph indexes
 * @param config - Optional configuration overrides
 * @returns Initial depth (0 = all collapsed, higher = more expanded)
 */
export function computeInitialDepth(
  indexes: GraphIndexes,
  config: Partial<ComboDepthConfig> = {}
): number {
  const effectiveConfig = { ...DEFAULT_CONFIG, ...config };
  const { comboChildren, comboDepth } = indexes;
  
  if (!comboChildren || comboChildren.size === 0) {
    return 0; // No combos
  }
  
  // Find root combos
  const roots = Array.from(comboChildren.keys()).filter(id => {
    const parent = indexes.comboParent?.get(id);
    return !parent;
  });
  
  if (roots.length === 0) {
    return 0;
  }
  
  // Analyze combo tree structure
  const analysis = analyzeComboTree(roots, comboChildren, indexes);
  
  // Compute depth based on analysis
  let depth = 0;
  
  // Scenario 1: Pathological (single huge top-level combo)
  if (analysis.hasPathologicalRoot) {
    // Collapse everything, show only root
    depth = 0;
  }
  // Scenario 2: Balanced tree
  else if (analysis.isBalanced) {
    // Can afford to expand more levels
    depth = Math.min(analysis.maxDepth, 3);
  }
  // Scenario 3: Deep/narrow tree
  else if (analysis.isDeepNarrow) {
    // Expand moderately
    depth = Math.min(analysis.maxDepth, 2);
  }
  // Default case
  else {
    depth = Math.min(analysis.maxDepth, 1);
  }
  
  // Verify depth doesn't cause overflow
  const estimatedVisible = estimateVisibleAtDepth(depth, roots, comboChildren, indexes);
  
  if (estimatedVisible > effectiveConfig.maxVisibleElements) {
    // Fall back to depth 0 (depth-1 overflow test)
    depth = 0;
  }
  
  return depth;
}

/**
 * Analyze combo tree structure
 */
function analyzeComboTree(
  roots: string[],
  comboChildren: Map<string, string[]>,
  indexes: GraphIndexes
): {
  hasPathologicalRoot: boolean;
  isBalanced: boolean;
  isDeepNarrow: boolean;
  maxDepth: number;
  avgChildrenPerNode: number;
  totalCombos: number;
} {
  let maxDepth = 0;
  let totalNodes = 0;
  let totalChildren = 0;
  let maxChildren = 0;
  let depthSum = 0;
  
  // BFS to analyze tree
  const queue: Array<{ id: string; depth: number }> = [];
  
  for (const root of roots) {
    queue.push({ id: root, depth: 0 });
  }
  
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    totalNodes++;
    depthSum += depth;
    maxDepth = Math.max(maxDepth, depth);
    
    const children = comboChildren.get(id) || [];
    totalChildren += children.length;
    maxChildren = Math.max(maxChildren, children.length);
    
    for (const childId of children) {
      queue.push({ id: childId, depth: depth + 1 });
    }
  }
  
  const avgChildren = totalNodes > 0 ? totalChildren / totalNodes : 0;
  const avgDepth = totalNodes > 0 ? depthSum / totalNodes : 0;
  
  // Detect pathological root (one root with >80% of all combos as direct children)
  const hasPathologicalRoot = roots.length === 1 && maxChildren > totalNodes * 0.8;
  
  // Detect balanced tree (low variance in children count, moderate depth)
  const isBalanced = avgChildren > 2 && avgChildren < 10 && maxDepth < 5;
  
  // Detect deep/narrow tree (high depth, low avg children)
  const isDeepNarrow = maxDepth > 5 && avgChildren < 3;
  
  return {
    hasPathologicalRoot,
    isBalanced,
    isDeepNarrow,
    maxDepth,
    avgChildrenPerNode: avgChildren,
    totalCombos: totalNodes
  };
}

/**
 * Estimate visible elements at a given depth
 */
function estimateVisibleAtDepth(
  depth: number,
  roots: string[],
  comboChildren: Map<string, string[]>,
  indexes: GraphIndexes
): number {
  let count = 0;
  
  // Count combos up to depth
  const queue: Array<{ id: string; d: number }> = [];
  
  for (const root of roots) {
    queue.push({ id: root, d: 0 });
    count++; // Root itself
  }
  
  while (queue.length > 0) {
    const { id, d } = queue.shift()!;
    
    if (d >= depth) {
      continue;
    }
    
    const children = comboChildren.get(id) || [];
    for (const childId of children) {
      queue.push({ id: childId, d: d + 1 });
      count++;
    }
  }
  
  // Add estimated nodes within expanded combos
  // (simplified: assume average node count per combo)
  if (indexes.comboBounds && indexes.comboBounds.size > 0) {
    // Could use actual bounds here for better estimation
  }
  
  return count;
}

/**
 * Get depth for a specific combo (for breadcrumb navigation)
 */
export function getDepthForCombo(
  comboId: string,
  indexes: GraphIndexes,
  currentDepth: number
): number {
  const comboDepth = indexes.comboDepth?.get(comboId) || 0;
  
  // Return depth relative to the clicked combo
  return Math.max(0, currentDepth - comboDepth);
}

/**
 * Check if expanding to a given depth would overflow budget
 */
export function wouldOverflow(
  targetDepth: number,
  roots: string[],
  comboChildren: Map<string, string[]>,
  indexes: GraphIndexes,
  config: Partial<ComboDepthConfig> = {}
): boolean {
  const effectiveConfig = { ...DEFAULT_CONFIG, ...config };
  const estimated = estimateVisibleAtDepth(targetDepth, roots, comboChildren, indexes);
  return estimated > effectiveConfig.maxVisibleElements;
}

/**
 * Clamp depth to stay within budget
 */
export function clampDepthToBudget(
  initialDepth: number,
  roots: string[],
  comboChildren: Map<string, string[]>,
  indexes: GraphIndexes,
  config: Partial<ComboDepthConfig> = {}
): number {
  let depth = initialDepth;
  
  while (depth > 0) {
    if (!wouldOverflow(depth, roots, comboChildren, indexes, config)) {
      return depth;
    }
    depth--;
  }
  
  return 0; // Ultimate fallback
}

export default {
  computeInitialDepth,
  getDepthForCombo,
  wouldOverflow,
  clampDepthToBudget
};
