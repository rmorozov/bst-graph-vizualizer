"""
metrics/articulation.py — articulation points computation

Identifies articulation points (cut vertices) in the graph.
Uses the same tiered, timeout-guarded approach as betweenness.
"""

import networkx as nx
from typing import Dict, Any, Set
import time

from ..logging_config import get_logger
from .timeout_guard import run_with_timeout

logger = get_logger("articulation")


def compute_articulation_points(
    G: nx.DiGraph,
    timeout_seconds: float = 60.0
) -> Dict[str, Any]:
    """
    Compute articulation points with timeout protection.
    
    Args:
        G: NetworkX DiGraph
        timeout_seconds: Maximum time for computation
        
    Returns:
        Dict with:
          - status: "success" | "disabled_timeout"
          - articulation_points: Set of node IDs or None if failed
    """
    n = G.number_of_nodes()
    
    logger.info(f"Computing articulation points for {n} nodes")
    
    def _compute():
        # NetworkX articulation_points works on undirected graphs
        # Convert to undirected for this analysis
        G_undirected = G.to_undirected()
        points = set(nx.articulation_points(G_undirected))
        return points
    
    # Run with timeout
    start_time = time.time()
    success, result = run_with_timeout(
        _compute,
        timeout_seconds=timeout_seconds,
        fallback_value=None
    )
    elapsed = time.time() - start_time
    
    if not success or result is None:
        logger.warning(f"Articulation points timed out after {elapsed:.2f}s")
        return {
            "status": "disabled_timeout",
            "articulation_points": None
        }
    
    logger.info(f"Found {len(result)} articulation points in {elapsed:.2f}s")
    
    return {
        "status": "success",
        "articulation_points": result
    }
