/**
 * Index Building for BuildStream Graph Viewer
 * 
 * Implements T2.3: All indexes from spec §4.3
 * - nodeToNeighbors, nodeToEdges
 * - comboChildren, comboParent, comboDepth
 * - searchIndex (trigram-based)
 * - spatialIndex (for viewport culling)
 * - sortedMetricArrays (for slider UI)
 * - comboBounds/comboSpatialIndex (gated on layout-ready)
 */

/**
 * GraphIndexes interface - all indexes built from loaded data
 */
export interface GraphIndexes {
  nodeToNeighbors: Map<string, string[]>;
  nodeToEdges: Map<string, any[]>;
  comboChildren: Map<string, string[]>;
  comboParent: Map<string, string>;
  comboDepth: Map<string, number>;
  searchIndex: TrigramIndex;
  spatialIndex: SpatialIndex | null;
  sortedMetricArrays: SortedMetricArrays;
  comboBounds: Map<string, BoundingBox> | null;
  comboSpatialIndex: SpatialIndex | null;
}

export interface TrigramIndex {
  trigrams: Map<string, Set<string>>;
  nodeIdToLabel: Map<string, string>;
}

export interface SpatialIndex {
  query: (bounds: BoundingBox) => string[];
  addAll: (nodes: any[]) => void;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SortedMetricArrays {
  [metricName: string]: string[]; // node IDs sorted by metric value (nulls at end)
}

/**
 * Build all indexes from graph data
 * 
 * @param data - The validated graph data
 * @param layoutReady - Whether layout coordinates are available
 * @returns GraphIndexes
 */
export function buildIndexes(data: any, layoutReady: boolean = false): GraphIndexes {
  const { nodes, edges, combos } = data;
  
  // Build nodeToNeighbors and nodeToEdges
  const nodeToNeighbors = new Map<string, string[]>();
  const nodeToEdges = new Map<string, any[]>();
  
  for (const node of nodes) {
    nodeToNeighbors.set(node.id, []);
    nodeToEdges.set(node.id, []);
  }
  
  for (const edge of edges) {
    const sourceNeighbors = nodeToNeighbors.get(edge.source) || [];
    sourceNeighbors.push(edge.target);
    nodeToNeighbors.set(edge.source, sourceNeighbors);
    
    const sourceEdges = nodeToEdges.get(edge.source) || [];
    sourceEdges.push(edge);
    nodeToEdges.set(edge.source, sourceEdges);
  }
  
  // Build combo hierarchy indexes
  const comboChildren = new Map<string, string[]>();
  const comboParent = new Map<string, string>();
  const comboDepth = new Map<string, number>();
  
  // Initialize all combos
  if (combos) {
    for (const combo of combos) {
      comboChildren.set(combo.id, []);
      comboDepth.set(combo.id, 0); // Will be updated below
    }
    
    // Build parent-child relationships
    for (const combo of combos) {
      if (combo.parentId) {
        comboParent.set(combo.id, combo.parentId);
        const children = comboChildren.get(combo.parentId) || [];
        children.push(combo.id);
        comboChildren.set(combo.parentId, children);
      }
    }
    
    // Compute depths via BFS from roots
    computeComboDepths(combos, comboParent, comboDepth, comboChildren);
  }
  
  // Build search index (trigram-based)
  const searchIndex = buildTrigramIndex(nodes);
  
  // Build spatial index (if layout is ready)
  let spatialIndex: SpatialIndex | null = null;
  if (layoutReady && typeof nodes[0]?.x === 'number') {
    spatialIndex = buildSpatialIndex(nodes);
  }
  
  // Build sorted metric arrays
  const sortedMetricArrays = buildSortedMetricArrays(nodes);
  
  // Build combo bounds and combo spatial index (only if layout ready)
  let comboBounds: Map<string, BoundingBox> | null = null;
  let comboSpatialIndex: SpatialIndex | null = null;
  
  if (layoutReady && combos && combos.length > 0) {
    comboBounds = computeComboBounds(combos, nodes);
    comboSpatialIndex = buildComboSpatialIndex(combos, comboBounds);
  }
  
  return {
    nodeToNeighbors,
    nodeToEdges,
    comboChildren,
    comboParent,
    comboDepth,
    searchIndex,
    spatialIndex,
    sortedMetricArrays,
    comboBounds,
    comboSpatialIndex
  };
}

/**
 * Compute combo depths via BFS from roots
 */
function computeComboDepths(
  combos: any[],
  comboParent: Map<string, string>,
  comboDepth: Map<string, number>,
  localComboChildren: Map<string, string[]>
): void {
  // Find root combos (no parent)
  const roots = combos.filter(c => !c.parentId);
  
  // BFS to assign depths
  const queue: Array<{ id: string; depth: number }> = [];
  for (const root of roots) {
    queue.push({ id: root.id, depth: 0 });
    comboDepth.set(root.id, 0);
  }
  
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const children = localComboChildren.get(id) || [];
    
    for (const childId of children) {
      const childDepth = depth + 1;
      comboDepth.set(childId, childDepth);
      queue.push({ id: childId, depth: childDepth });
    }
  }
}

/**
 * Build trigram search index
 */
function buildTrigramIndex(nodes: any[]): TrigramIndex {
  const trigrams = new Map<string, Set<string>>();
  const nodeIdToLabel = new Map<string, string>();
  
  for (const node of nodes) {
    const label = node.data?.label || node.id;
    nodeIdToLabel.set(node.id, label);
    
    // Extract trigrams from label
    const normalized = label.toLowerCase();
    for (let i = 0; i <= normalized.length - 3; i++) {
      const trig = normalized.substring(i, i + 3);
      if (!trigrams.has(trig)) {
        trigrams.set(trig, new Set());
      }
      trigrams.get(trig)!.add(node.id);
    }
    
    // Also add bigrams for short labels
    if (normalized.length < 5) {
      for (let i = 0; i <= normalized.length - 2; i++) {
        const bigram = normalized.substring(i, i + 2);
        if (!trigrams.has(bigram)) {
          trigrams.set(bigram, new Set());
        }
        trigrams.get(bigram)!.add(node.id);
      }
    }
  }
  
  return { trigrams, nodeIdToLabel };
}

/**
 * Build spatial index for viewport culling
 * Simple quadtree-like structure
 */
function buildSpatialIndex(nodes: any[]): SpatialIndex {
  const nodePositions: Array<{ id: string; x: number; y: number }> = [];
  
  for (const node of nodes) {
    if (typeof node.x === 'number' && typeof node.y === 'number') {
      nodePositions.push({ id: node.id, x: node.x, y: node.y });
    }
  }
  
  return {
    query: (bounds: BoundingBox) => {
      return nodePositions
        .filter(n => 
          n.x >= bounds.minX && n.x <= bounds.maxX &&
          n.y >= bounds.minY && n.y <= bounds.maxY
        )
        .map(n => n.id);
    },
    addAll: (newNodes: any[]) => {
      // For simplicity, rebuild index (could be optimized)
      for (const node of newNodes) {
        if (typeof node.x === 'number' && typeof node.y === 'number') {
          nodePositions.push({ id: node.id, x: node.x, y: node.y });
        }
      }
    }
  };
}

/**
 * Build sorted metric arrays for slider UI
 * Null values go to the end
 */
function buildSortedMetricArrays(nodes: any[]): SortedMetricArrays {
  const metrics: SortedMetricArrays = {};
  
  // List of metrics to sort
  const metricNames = [
    'inDegree', 'outDegree', 'topoLayer', 'cpDepth', 'cpHeight',
    'buildCost', 'runtimeCost', 'blastRadius', 'ancestorCount', 'descendantCount'
  ];
  
  for (const metricName of metricNames) {
    const withValues = nodes.filter(n => n.data?.[metricName] !== null && n.data?.[metricName] !== undefined);
    const withNulls = nodes.filter(n => n.data?.[metricName] === null || n.data?.[metricName] === undefined);
    
    // Sort non-null values descending
    withValues.sort((a, b) => {
      const aVal = a.data?.[metricName] ?? 0;
      const bVal = b.data?.[metricName] ?? 0;
      return bVal - aVal;
    });
    
    metrics[metricName] = [
      ...withValues.map(n => n.id),
      ...withNulls.map(n => n.id)
    ];
  }
  
  return metrics;
}

/**
 * Compute bounding boxes for combos
 */
function computeComboBounds(combos: any[], nodes: any[]): Map<string, BoundingBox> {
  const bounds = new Map<string, BoundingBox>();
  
  // Group nodes by combo
  const comboToNodes = new Map<string, any[]>();
  for (const node of nodes) {
    const comboId = node.combo;
    if (comboId) {
      if (!comboToNodes.has(comboId)) {
        comboToNodes.set(comboId, []);
      }
      comboToNodes.get(comboId)!.push(node);
    }
  }
  
  // Compute bounds for each combo
  for (const combo of combos) {
    const memberNodes = comboToNodes.get(combo.id) || [];
    
    if (memberNodes.length === 0) {
      // Empty combo: use default or inherited bounds
      bounds.set(combo.id, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
      continue;
    }
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (const node of memberNodes) {
      if (typeof node.x === 'number' && typeof node.y === 'number') {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x);
        maxY = Math.max(maxY, node.y);
      }
    }
    
    if (minX === Infinity) {
      minX = minY = maxX = maxY = 0;
    }
    
    bounds.set(combo.id, { minX, minY, maxX, maxY });
  }
  
  return bounds;
}

/**
 * Build spatial index for combos
 */
function buildComboSpatialIndex(combos: any[], comboBounds: Map<string, BoundingBox>): SpatialIndex {
  const comboPositions: Array<{ id: string; bounds: BoundingBox }> = [];
  
  for (const combo of combos) {
    const bounds = comboBounds.get(combo.id);
    if (bounds) {
      comboPositions.push({ id: combo.id, bounds });
    }
  }
  
  return {
    query: (bounds: BoundingBox) => {
      return comboPositions
        .filter(c => 
          c.bounds.maxX >= bounds.minX && c.bounds.minX <= bounds.maxX &&
          c.bounds.maxY >= bounds.minY && c.bounds.minY <= bounds.maxY
        )
        .map(c => c.id);
    },
    addAll: () => {
      // Combos don't change dynamically
    }
  };
}

export default {
  buildIndexes
};
