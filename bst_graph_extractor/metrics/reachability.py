"""
metrics/reachability.py — reachability computation (ancestors/descendants)

Supports three modes:
  - exact: Full bitset closure for all nodes (memory-intensive)
  - targeted: Only compute for articulation points, critical path, top-K degree
  - disabled_by_user: Skip entirely
  
Includes memory guard to automatically fall back to targeted mode.
"""

import networkx as nx
from typing import Dict, Any, Set, Optional, List
import time

from ..logging_config import get_logger

logger = get_logger("reachability")


def estimate_memory_requirement(n: int, avg_degree: float) -> float:
    """
    Estimate memory required for exact reachability in MB.
    
    Rough estimate: n * n bits for the full closure matrix,
    plus overhead for Python objects.
    """
    # n^2 bits = n^2 / 8 bytes = n^2 / 8 / 1024 / 1024 MB
    base_mb = (n * n) / 8 / 1024 / 1024
    # Overhead factor for Python dict/set structures
    overhead_factor = 10.0
    return base_mb * overhead_factor


def compute_reachability(
    G: nx.DiGraph,
    mode: str = "auto",
    max_memory_mb: float = 500.0,
    targeted_k: int = 100
) -> Dict[str, Any]:
    """
    Compute reachability (ancestors/descendants) for nodes.
    
    Args:
        G: NetworkX DiGraph
        mode: "exact" | "targeted" | "disabled_by_user" | "auto"
        max_memory_mb: Maximum memory budget for exact mode
        targeted_k: Number of top-degree nodes to include in targeted mode
        
    Returns:
        Dict with:
          - reachability_mode: actual mode used
          - ancestors: {node_id: Set[node_ids]} or None
          - descendants: {node_id: Set[node_ids]} or None
          - estimated_memory_mb: estimated memory for exact mode
    """
    n = G.number_of_nodes()
    
    if mode == "disabled_by_user":
        logger.info("Reachability disabled by user")
        return {
            "reachability_mode": "disabled_by_user",
            "ancestors": None,
            "descendants": None,
            "estimated_memory_mb": 0.0
        }
    
    # Estimate memory requirement
    avg_degree = sum(dict(G.out_degree()).values()) / n if n > 0 else 0
    estimated_mb = estimate_memory_requirement(n, avg_degree)
    
    # Auto mode: decide based on memory estimate
    if mode == "auto":
        if estimated_mb > max_memory_mb:
            logger.warning(
                f"Reachability: estimated memory {estimated_mb:.1f}MB exceeds budget {max_memory_mb:.1f}MB. "
                f"Using targeted mode."
            )
            mode = "targeted"
        else:
            mode = "exact"
    
    if mode == "exact":
        return _compute_exact_reachability(G)
    elif mode == "targeted":
        return _compute_targeted_reachability(G, targeted_k)
    else:
        logger.error(f"Unknown reachability mode: {mode}")
        return {
            "reachability_mode": "disabled_by_user",
            "ancestors": None,
            "descendants": None,
            "estimated_memory_mb": estimated_mb
        }


def _compute_exact_reachability(G: nx.DiGraph) -> Dict[str, Any]:
    """Compute full reachability for all nodes."""
    n = G.number_of_nodes()
    logger.info(f"Computing exact reachability for {n} nodes")
    
    start_time = time.time()
    
    ancestors = {}
    descendants = {}
    
    for node in G.nodes():
        ancestors[node] = set(nx.ancestors(G, node))
        descendants[node] = set(nx.descendants(G, node))
    
    elapsed = time.time() - start_time
    logger.info(f"Exact reachability computed in {elapsed:.2f}s")
    
    return {
        "reachability_mode": "exact",
        "ancestors": ancestors,
        "descendants": descendants,
        "estimated_memory_mb": estimate_memory_requirement(n, 0)
    }


def _compute_targeted_reachability(
    G: nx.DiGraph,
    k: int
) -> Dict[str, Any]:
    """Compute reachability only for important nodes."""
    n = G.number_of_nodes()
    logger.info(f"Computing targeted reachability for top {k} nodes")
    
    start_time = time.time()
    
    # Select target nodes: top-K by out-degree
    out_degrees = dict(G.out_degree())
    sorted_nodes = sorted(out_degrees.keys(), key=lambda x: out_degrees[x], reverse=True)
    target_nodes = set(sorted_nodes[:k])
    
    ancestors = {}
    descendants = {}
    
    for node in target_nodes:
        ancestors[node] = set(nx.ancestors(G, node))
        descendants[node] = set(nx.descendants(G, node))
    
    # Other nodes will have None values
    for node in G.nodes():
        if node not in target_nodes:
            ancestors[node] = None
            descendants[node] = None
    
    elapsed = time.time() - start_time
    logger.info(f"Targeted reachability computed in {elapsed:.2f}s for {len(target_nodes)} nodes")
    
    return {
        "reachability_mode": "targeted",
        "ancestors": ancestors,
        "descendants": descendants,
        "estimated_memory_mb": estimate_memory_requirement(len(target_nodes), 0)
    }
