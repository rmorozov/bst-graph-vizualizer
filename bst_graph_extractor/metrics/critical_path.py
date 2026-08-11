"""
metrics/critical_path.py — critical path computation

Computes:
  - cpDepth: distance from nearest source along critical path
  - cpHeight: distance to nearest sink along critical path
  - isCritical: True if node is on the longest path
  - Edge criticality: both endpoints must be non-cyclic for edge to be critical
  
For fully cyclic graphs, returns globalCriticalPathLength: 0.
"""

import networkx as nx
from typing import Dict, Any, Set, List, Tuple

from ..logging_config import get_logger

logger = get_logger("critical_path")


def compute_critical_path(G: nx.DiGraph, is_cycle: Dict[str, bool]) -> Dict[str, Any]:
    """
    Compute critical path metrics.
    
    Args:
        G: NetworkX DiGraph
        is_cycle: Dict mapping node_id → isCycle (from scc.py)
        
    Returns:
        Dict with:
          - node_metrics: {node_id: {cpDepth, cpHeight, isCritical}}
          - global_critical_path_length: length of longest path (0 if fully cyclic)
          - critical_edges: Set of (source, target) tuples
    """
    n = G.number_of_nodes()
    
    # Check if graph is fully cyclic
    if all(is_cycle.values()):
        logger.info("Graph is fully cyclic; critical path undefined")
        return {
            "node_metrics": {node: {"cpDepth": 0, "cpHeight": 0, "isCritical": False} for node in G.nodes()},
            "global_critical_path_length": 0,
            "critical_edges": set()
        }
    
    # Get DAG of non-cyclic nodes
    dag_nodes = [node for node in G.nodes() if not is_cycle.get(node, False)]
    
    if not dag_nodes:
        # All nodes are cyclic
        return {
            "node_metrics": {node: {"cpDepth": 0, "cpHeight": 0, "isCritical": False} for node in G.nodes()},
            "global_critical_path_length": 0,
            "critical_edges": set()
        }
    
    # Create subgraph of non-cyclic nodes
    dag = G.subgraph(dag_nodes).copy()
    
    # Compute longest path in DAG
    try:
        longest_path = _longest_path_in_dag(dag)
        global_critical_path_length = len(longest_path) - 1 if longest_path else 0
        critical_nodes = set(longest_path) if longest_path else set()
    except Exception as e:
        logger.warning(f"Critical path computation failed: {e}")
        longest_path = []
        global_critical_path_length = 0
        critical_nodes = set()
    
    # Compute cpDepth and cpHeight for all nodes
    node_metrics = {}
    
    for node in G.nodes():
        if is_cycle.get(node, False):
            # Cyclic nodes: no critical path metrics
            node_metrics[node] = {
                "cpDepth": 0,
                "cpHeight": 0,
                "isCritical": False
            }
        else:
            # Non-cyclic nodes: compute metrics
            cp_depth = _compute_cp_depth(dag, node)
            cp_height = _compute_cp_height(dag, node)
            is_critical = node in critical_nodes
            
            node_metrics[node] = {
                "cpDepth": cp_depth,
                "cpHeight": cp_height,
                "isCritical": is_critical
            }
    
    # Compute critical edges: both endpoints must be non-cyclic and critical
    critical_edges = set()
    for u, v in G.edges():
        if not is_cycle.get(u, False) and not is_cycle.get(v, False):
            if node_metrics.get(u, {}).get("isCritical", False) and \
               node_metrics.get(v, {}).get("isCritical", False):
                critical_edges.add((u, v))
    
    logger.info(f"Critical path length: {global_critical_path_length}, "
                f"{len(critical_nodes)} critical nodes, {len(critical_edges)} critical edges")
    
    return {
        "node_metrics": node_metrics,
        "global_critical_path_length": global_critical_path_length,
        "critical_edges": critical_edges
    }


def _longest_path_in_dag(G: nx.DiGraph) -> List[str]:
    """
    Find the longest path in a DAG using dynamic programming.
    
    Returns the path as a list of node IDs.
    """
    if G.number_of_nodes() == 0:
        return []
    
    # Topological sort
    topo_order = list(nx.topological_sort(G))
    
    # DP: longest path ending at each node
    dist = {node: 0 for node in G.nodes()}
    predecessor = {node: None for node in G.nodes()}
    
    for node in topo_order:
        for pred in G.predecessors(node):
            if dist[pred] + 1 > dist[node]:
                dist[node] = dist[pred] + 1
                predecessor[node] = pred
    
    # Find the node with maximum distance
    if not dist:
        return []
    
    end_node = max(dist.keys(), key=lambda x: dist[x])
    
    # Reconstruct path
    path = []
    current = end_node
    while current is not None:
        path.append(current)
        current = predecessor[current]
    
    path.reverse()
    return path


def _compute_cp_depth(G: nx.DiGraph, node: str) -> int:
    """Compute distance from nearest source to this node."""
    try:
        # BFS from all sources
        sources = [n for n in G.nodes() if G.in_degree(n) == 0]
        if not sources:
            return 0
        
        lengths = nx.multi_source_dijkstra_path_length(G, sources)
        return lengths.get(node, 0)
    except Exception:
        return 0


def _compute_cp_height(G: nx.DiGraph, node: str) -> int:
    """Compute distance from this node to nearest sink."""
    try:
        # BFS to all sinks (reverse graph)
        sinks = [n for n in G.nodes() if G.out_degree(n) == 0]
        if not sinks:
            return 0
        
        G_rev = G.reverse()
        lengths = nx.multi_source_dijkstra_path_length(G_rev, sinks)
        return lengths.get(node, 0)
    except Exception:
        return 0
