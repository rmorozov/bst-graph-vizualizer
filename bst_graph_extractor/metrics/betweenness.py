"""
metrics/betweenness.py — betweenness centrality computation

Tiered computation based on graph size:
  - <10k nodes: exact betweenness
  - 10k-50k nodes: approximate (sampling)
  - >50k nodes: disabled by default (can be forced with --expensive-metrics)
  
Respects --no-betweenness and --metric-timeout-seconds flags.
"""

import networkx as nx
from typing import Dict, Any, Optional
import time

from ..logging_config import get_logger
from .timeout_guard import run_with_timeout

logger = get_logger("betweenness")


def compute_betweenness(
    G: nx.DiGraph,
    enable_exact: bool = False,
    timeout_seconds: float = 60.0,
    sample_ratio: float = 0.01
) -> Dict[str, Any]:
    """
    Compute betweenness centrality with tiered strategy.
    
    Args:
        G: NetworkX DiGraph
        enable_exact: If True, force exact computation regardless of size
        timeout_seconds: Maximum time for computation
        sample_ratio: Ratio of nodes to sample for approximate mode
        
    Returns:
        Dict with:
          - status: "exact" | "approximate" | "disabled_size" | "disabled_timeout" | "disabled_user"
          - node_scores: {node_id: score} or None if disabled
    """
    n = G.number_of_nodes()
    
    # Determine mode based on graph size
    if not enable_exact:
        if n > 50000:
            logger.warning(f"Betweenness disabled: graph too large ({n} nodes > 50k threshold)")
            return {
                "status": "disabled_size",
                "node_scores": None
            }
    
    # Select computation method
    if n < 10000 or enable_exact:
        method = "exact"
    else:
        method = "approximate"
    
    logger.info(f"Computing betweenness using {method} method for {n} nodes")
    
    def _compute():
        if method == "exact":
            # Use NetworkX exact betweenness
            scores = nx.betweenness_centrality(G, normalized=True)
        else:
            # Approximate via sampling
            k = max(100, int(n * sample_ratio))
            scores = nx.betweenness_centrality(G, k=k, normalized=True)
        
        return scores
    
    # Run with timeout
    start_time = time.time()
    success, result = run_with_timeout(
        _compute,
        timeout_seconds=timeout_seconds,
        fallback_value=None
    )
    elapsed = time.time() - start_time
    
    if not success or result is None:
        logger.warning(f"Betweenness timed out after {elapsed:.2f}s")
        return {
            "status": "disabled_timeout",
            "node_scores": None
        }
    
    logger.info(f"Betweenness computed in {elapsed:.2f}s ({method})")
    
    return {
        "status": method,
        "node_scores": result
    }
