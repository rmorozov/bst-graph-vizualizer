"""
scc.py — Strongly Connected Components condensation

Computes SCCs and marks nodes with cycle membership.
Handles:
  - Fully cyclic graphs (single SCC)
  - Fully acyclic graphs (each node is its own SCC)
  - Self-loop-only cycles (correctly flagged as cyclic)
"""

import networkx as nx
from typing import Dict, Set, List

from .logging_config import get_logger

logger = get_logger("scc")


def compute_sccs(G: nx.DiGraph) -> Dict[str, bool]:
    """
    Compute strongly connected components and mark nodes with cycle membership.
    
    Args:
        G: NetworkX DiGraph
        
    Returns:
        Dict mapping node_id → isCycle (True if node is in a non-trivial SCC)
    """
    is_cycle: Dict[str, bool] = {}
    
    # Find all strongly connected components
    sccs = list(nx.strongly_connected_components(G))
    
    # A node is in a cycle if it's in an SCC with more than 1 node,
    # OR if it has a self-loop (single-node SCC that loops to itself)
    for scc in sccs:
        if len(scc) > 1:
            # Non-trivial SCC: all nodes are cyclic
            for node_id in scc:
                is_cycle[node_id] = True
        else:
            # Single-node SCC: check for self-loop
            node_id = list(scc)[0]
            if G.has_edge(node_id, node_id):
                is_cycle[node_id] = True
            else:
                is_cycle[node_id] = False
    
    cycle_count = sum(1 for v in is_cycle.values() if v)
    logger.info(f"Found {len(sccs)} SCCs, {cycle_count} nodes in cycles")
    
    return is_cycle


def get_condensation_graph(G: nx.DiGraph) -> nx.DiGraph:
    """
    Get the condensation graph (DAG of SCCs).
    
    Args:
        G: NetworkX DiGraph
        
    Returns:
        Condensation graph where each node represents an SCC
    """
    return nx.condensation(G)
