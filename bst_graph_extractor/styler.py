"""
styler.py — deterministic color/style precomputation

Computes visual styles for nodes and edges based on their properties:
- Deterministic color assignment by node kind
- Critical node/edge styling (#ff4d4f for critical, lineWidth 3/4)
- Heatmap-compatible colors when heatmap is active
"""

import hashlib
from typing import Dict, Any, Set, Tuple

from .logging_config import get_logger

logger = get_logger("styler")


# Spec constants for critical styling
CRITICAL_NODE_COLOR = "#ff4d4f"
CRITICAL_EDGE_COLOR = "#ff4d4f"
CRITICAL_NODE_LINE_WIDTH = 3
CRITICAL_EDGE_LINE_WIDTH = 4

# Heatmap-on critical color (cyan for contrast)
CRITICAL_HEATMAP_COLOR = "#00d9ff"

# Default colors by node kind
KIND_COLORS = {
    "source": "#52c41a",
    "build": "#1890ff",
    "binary": "#722ed1",
    "default": "#faad14"
}


def compute_styles(
    node_metrics: Dict[str, Dict[str, Any]],
    edge_data: Set[Tuple[str, str]],
    critical_nodes: Set[str],
    critical_edges: Set[Tuple[str, str]],
    heatmap_active: bool = False
) -> Dict[str, Any]:
    """
    Compute visual styles for all nodes and edges.
    
    Args:
        node_metrics: Per-node metrics including kind, isCritical, etc.
        edge_data: Set of (source, target) edge tuples
        critical_nodes: Set of critical node IDs
        critical_edges: Set of critical edge (source, target) tuples
        heatmap_active: Whether heatmap visualization is enabled
        
    Returns:
        Dict with node_styles and edge_styles
    """
    node_styles = {}
    edge_styles = {}
    
    # Compute node styles
    for node_id, metrics in node_metrics.items():
        kind = metrics.get("kind", "default")
        is_critical = node_id in critical_nodes
        
        # Base color by kind
        base_color = KIND_COLORS.get(kind, KIND_COLORS["default"])
        
        # Critical nodes override color
        if is_critical:
            fill_color = CRITICAL_NODE_COLOR
            stroke_color = CRITICAL_HEATMAP_COLOR if heatmap_active else CRITICAL_NODE_COLOR
        else:
            fill_color = base_color
            stroke_color = base_color
        
        node_styles[node_id] = {
            "fill": fill_color,
            "stroke": stroke_color,
            "lineWidth": CRITICAL_NODE_LINE_WIDTH if is_critical else 1,
            "isCritical": is_critical
        }
    
    # Compute edge styles
    for source, target in edge_data:
        edge_key = (source, target)
        is_critical = edge_key in critical_edges
        
        if is_critical:
            color = CRITICAL_HEATMAP_COLOR if heatmap_active else CRITICAL_EDGE_COLOR
            line_width = CRITICAL_EDGE_LINE_WIDTH
        else:
            color = "#d9d9d9"
            line_width = 1
        
        edge_styles[edge_key] = {
            "stroke": color,
            "lineWidth": line_width,
            "isCritical": is_critical
        }
    
    logger.info(f"Computed styles for {len(node_styles)} nodes and {len(edge_styles)} edges")
    
    return {
        "node_styles": node_styles,
        "edge_styles": edge_styles
    }


def get_color_for_kind(kind: str) -> str:
    """Get deterministic color for a node kind."""
    return KIND_COLORS.get(kind, KIND_COLORS["default"])
