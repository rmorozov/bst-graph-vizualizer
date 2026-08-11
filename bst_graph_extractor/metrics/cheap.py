"""
metrics/cheap.py — inexpensive graph metrics

Computes:
  - inDegree, outDegree
  - topoLayer (topological layer)
  - density
  - maxConcurrencyWidth
  
All metrics are O(V+E) or better and safe for graphs of any size.
"""

import networkx as nx
from typing import Dict, Any, List
from collections import defaultdict

from ..logging_config import get_logger

logger = get_logger("cheap_metrics")


def compute_cheap_metrics(G: nx.DiGraph) -> Dict[str, Dict[str, Any]]:
    """
    Compute all cheap metrics for nodes and graph-level stats.
    
    Args:
        G: NetworkX DiGraph
        
    Returns:
        Dict with:
          - node_metrics: {node_id: {inDegree, outDegree, topoLayer}}
          - graph_stats: {density, maxConcurrencyWidth, maxTopoLayer}
    """
    node_metrics: Dict[str, Dict[str, Any]] = {}
    
    # Compute degree metrics
    in_degrees = dict(G.in_degree())
    out_degrees = dict(G.out_degree())
    
    # Compute topological layers
    # Nodes in the same SCC will share the same layer
    topo_layers = _compute_topo_layers(G)
    
    # Assign metrics to each node
    for node_id in G.nodes():
        node_metrics[node_id] = {
            "inDegree": in_degrees.get(node_id, 0),
            "outDegree": out_degrees.get(node_id, 0),
            "topoLayer": topo_layers.get(node_id, 0)
        }
    
    # Graph-level stats
    n = G.number_of_nodes()
    m = G.number_of_edges()
    
    # Density: m / (n * (n-1)) for directed graphs
    if n > 1:
        density = m / (n * (n - 1))
    else:
        density = 0.0
    
    # Max concurrency width: maximum number of nodes at any topo layer
    layer_counts = defaultdict(int)
    for layer in topo_layers.values():
        layer_counts[layer] += 1
    
    max_concurrency_width = max(layer_counts.values()) if layer_counts else 0
    max_topo_layer = max(topo_layers.values()) if topo_layers else 0
    
    graph_stats = {
        "density": density,
        "maxConcurrencyWidth": max_concurrency_width,
        "maxTopoLayer": max_topo_layer
    }
    
    logger.info(f"Computed cheap metrics: density={density:.4f}, max_width={max_concurrency_width}")
    
    return {
        "node_metrics": node_metrics,
        "graph_stats": graph_stats
    }


def _compute_topo_layers(G: nx.DiGraph) -> Dict[str, int]:
    """
    Compute topological layers for all nodes.
    
    Nodes in cycles (same SCC) will share the same layer.
    Layer 0 = source nodes (no incoming edges from outside their SCC)
    
    Uses condensation graph to handle cycles properly.
    """
    if G.number_of_nodes() == 0:
        return {}
    
    # Get SCCs
    sccs = list(nx.strongly_connected_components(G))
    
    # Map each node to its SCC index
    node_to_scc = {}
    for i, scc in enumerate(sccs):
        for node_id in scc:
            node_to_scc[node_id] = i
    
    # Build condensation graph
    condensation = nx.condensation(G)
    
    # Compute longest path from sources in condensation DAG
    # This gives us the topo layer for each SCC
    scc_layers = {}
    
    # Use topological sort on condensation (guaranteed DAG)
    topo_order = list(nx.topological_sort(condensation))
    
    for scc_node in topo_order:
        # Get predecessor SCCs
        preds = list(condensation.predecessors(scc_node))
        
        if not preds:
            # Source SCC
            scc_layers[scc_node] = 0
        else:
            # Layer = max(predecessor layers) + 1
            scc_layers[scc_node] = max(scc_layers[p] for p in preds) + 1
    
    # Map back to original nodes
    node_layers = {}
    for node_id, scc_idx in node_to_scc.items():
        node_layers[node_id] = scc_layers.get(scc_idx, 0)
    
    return node_layers
