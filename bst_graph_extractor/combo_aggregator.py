"""
combo_aggregator.py — aggregate metrics for combo nodes

Computes per-metric aggregates (min/max/avg/sum) for combo nodes
based on their member nodes. Handles null values correctly:
  - All-null members → aggregate is null (not 0)
  - Mixed null/non-null → aggregate computed over non-null only
  
Also computes collapsedSize based on nodeCount formula.
"""

import math
from typing import Dict, Any, List, Optional
from collections import defaultdict

from .logging_config import get_logger

logger = get_logger("combo_aggregator")


def compute_combo_aggregates(
    combos: List[Dict[str, Any]],
    node_metrics: Dict[str, Dict[str, Any]]
) -> Dict[str, Dict[str, Any]]:
    """
    Compute aggregate metrics for each combo.
    
    Args:
        combos: List of combo definitions with children lists
        node_metrics: Per-node metrics from other stages
        
    Returns:
        Dict mapping combo_id → aggregated metrics
    """
    combo_aggregates = {}
    
    for combo in combos:
        combo_id = combo["id"]
        children = combo.get("children", [])
        
        # Collect metrics from child nodes
        child_metrics = _collect_child_metrics(children, node_metrics)
        
        # Compute aggregates for each metric
        aggregates = {}
        
        # Build cost aggregates
        build_costs = [m.get("buildCost") for m in child_metrics if m.get("buildCost") is not None]
        if build_costs:
            aggregates["maxBuildCost"] = max(build_costs)
            aggregates["minBuildCost"] = min(build_costs)
            aggregates["avgBuildCost"] = sum(build_costs) / len(build_costs)
            aggregates["sumBuildCost"] = sum(build_costs)
        else:
            # All null → aggregates are null
            aggregates["maxBuildCost"] = None
            aggregates["minBuildCost"] = None
            aggregates["avgBuildCost"] = None
            aggregates["sumBuildCost"] = None
        
        # Bottleneck score aggregates
        bottleneck_scores = [m.get("bottleneckScore") for m in child_metrics if m.get("bottleneckScore") is not None]
        if bottleneck_scores:
            aggregates["maxBottleneckScore"] = max(bottleneck_scores)
            aggregates["avgBottleneckScore"] = sum(bottleneck_scores) / len(bottleneck_scores)
        else:
            aggregates["maxBottleneckScore"] = None
            aggregates["avgBottleneckScore"] = None
        
        # Blast radius aggregates
        blast_radii = [m.get("blastRadius") for m in child_metrics if m.get("blastRadius") is not None]
        if blast_radii:
            aggregates["maxBlastRadius"] = max(blast_radii)
            aggregates["avgBlastRadius"] = sum(blast_radii) / len(blast_radii)
        else:
            aggregates["maxBlastRadius"] = None
            aggregates["avgBlastRadius"] = None
        
        # Node count
        aggregates["nodeCount"] = len(children)
        
        # Collapsed size (visual representation when collapsed)
        aggregates["collapsedSize"] = _compute_collapsed_size(len(children))
        
        combo_aggregates[combo_id] = aggregates
    
    logger.info(f"Computed aggregates for {len(combo_aggregates)} combos")
    
    return combo_aggregates


def _collect_child_metrics(
    children: List[str],
    node_metrics: Dict[str, Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Collect metrics for all child nodes."""
    metrics = []
    for child_id in children:
        if child_id in node_metrics:
            metrics.append(node_metrics[child_id])
    return metrics


def _compute_collapsed_size(node_count: int) -> int:
    """
    Compute collapsed visual size based on node count.
    
    Formula: max(minSize, log2(nodeCount + 1) * scale)
    This ensures large combos don't dominate the view when collapsed.
    """
    min_size = 20
    scale = 5
    
    if node_count == 0:
        return min_size
    
    size = int(math.log2(node_count + 1) * scale)
    return max(min_size, size)
