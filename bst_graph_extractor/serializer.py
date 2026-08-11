"""
serializer.py — assemble final JSON output, self-validate, atomic write

Assembles all computed metrics into the final schema-valid JSON structure.
Features:
  - Self-validation against graph_data.schema.json before write
  - Atomic temp-file + rename write (never leaves truncated file)
  - Performance timing capture for metadata.performance
"""

import json
import os
import tempfile
import time
from typing import Dict, Any, List, Optional
from pathlib import Path

import jsonschema

from .logging_config import get_logger

logger = get_logger("serializer")


def load_schema() -> Dict[str, Any]:
    """Load the JSON schema from the schema directory."""
    schema_path = Path(__file__).parent / "schema" / "graph_data.schema.json"
    with open(schema_path, 'r') as f:
        return json.load(f)


def validate_output(data: Dict[str, Any], schema: Dict[str, Any]) -> bool:
    """
    Validate output data against schema.
    
    Returns:
        True if valid, raises ValueError if invalid
    """
    try:
        jsonschema.validate(instance=data, schema=schema)
        return True
    except jsonschema.ValidationError as e:
        raise ValueError(f"Output validation failed: {e.message} at {e.path}")


def assemble_output(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    node_metrics: Dict[str, Dict[str, Any]],
    graph_stats: Dict[str, Any],
    combo_aggregates: Optional[Dict[str, Dict[str, Any]]] = None,
    combos: Optional[List[Dict[str, Any]]] = None,
    performance: Optional[Dict[str, float]] = None,
    reachability_mode: str = "exact",
    betweenness_status: str = "exact",
    articulation_status: str = "success",
    global_critical_path_length: int = 0,
    layout_precomputed: bool = False,
    layout_nodes: Optional[List[Dict[str, float]]] = None,
    target: str = "",
    has_cycles: bool = False
) -> Dict[str, Any]:
    """
    Assemble all data into final output structure.
    
    Args:
        nodes: List of node objects with id, kind, name, etc.
        edges: List of edge objects with source, target, depType
        node_metrics: Per-node computed metrics
        graph_stats: Graph-level statistics (density, maxConcurrencyWidth, maxTopoLayer)
        combo_aggregates: Aggregated metrics for combos (optional)
        combos: Combo definitions (optional)
        performance: Timing data for each stage
        reachability_mode: actual reachability mode used
        betweenness_status: betweenness computation status
        articulation_status: articulation points status
        global_critical_path_length: length of critical path
        layout_precomputed: whether layout was precomputed
        layout_nodes: precomputed layout coordinates
        target: BuildStream target element
        has_cycles: whether the graph contains cycles
        
    Returns:
        Complete output dictionary ready for JSON serialization
    """
    # Enrich nodes with metrics - convert to schema format
    enriched_nodes = []
    for node in nodes:
        node_id = node.get("id")
        metrics = node_metrics.get(node_id, {})
        
        # Convert to schema-compliant Node format
        enriched_node = {
            "id": node_id,
            "type": "rect",  # Default shape
            "combo": "@root",  # Default to root combo
            "x": 0.0,  # Will be overridden by layout if available
            "y": 0.0,
            "data": {
                "label": node.get("name", node_id),
                "kind": node.get("kind", "unknown"),
                "sccId": metrics.get("sccId"),
                "inDegree": metrics.get("inDegree", 0),
                "outDegree": metrics.get("outDegree", 0),
                "topoLayer": metrics.get("topoLayer", 0),
                "cpDepth": metrics.get("cpDepth", 0),
                "cpHeight": metrics.get("cpHeight", 0),
                "isCritical": metrics.get("isCritical", False),
                "isArticulationPoint": metrics.get("isArticulation", False),
                "isCycle": metrics.get("isCycle", False),
                "blastRadius": metrics.get("blastRadius"),
                "buildCost": metrics.get("ancestorCount"),
                "bottleneckScore": metrics.get("betweenness")
            },
            "style": {
                "size": [50, 30],  # Default size
                "fill": metrics.get("fill", "#1890ff"),
                "stroke": metrics.get("stroke", "#1890ff"),
                "lineWidth": metrics.get("lineWidth", 1)
            }
        }
        enriched_nodes.append(enriched_node)
    
    # Convert edges to schema format
    enriched_edges = []
    for edge in edges:
        edge_data = {
            "id": f"{edge['source']}->{edge['target']}",
            "type": "cubic-horizontal",  # Default edge type
            "source": edge["source"],
            "target": edge["target"],
            "data": {
                "depType": edge.get("depType", "build"),
                "isCritical": edge.get("isCritical", False)
            },
            "style": {
                "stroke": edge.get("stroke", "#1890ff"),
                "endArrow": True,
                "opacity": 1.0,
                "lineWidth": edge.get("lineWidth", 1)
            }
        }
        enriched_edges.append(edge_data)
    
    # Build levelCounts from topoLayer distribution
    level_counts = {}
    for node in enriched_nodes:
        layer = str(node["data"]["topoLayer"])
        level_counts[layer] = level_counts.get(layer, 0) + 1
    
    # Build color maps
    kind_color_map = {}
    dep_type_color_map = {
        "build": "#1890ff",
        "runtime": "#52c41a",
        "both": "#722ed1"
    }
    for node in enriched_nodes:
        kind = node["data"]["kind"]
        if kind not in kind_color_map:
            # Generate deterministic color based on kind
            kind_color_map[kind] = _get_kind_color(kind)
    
    # Heatmap gradient
    heatmap_gradient = ["#fffbe6", "#fff1b8", "#ff7a45", "#cf1322"]
    
    # Build metadata with all required fields
    metadata = {
        "schemaVersion": "1.0.0",
        "target": target,
        "totalNodes": len(nodes),
        "totalEdges": len(edges),
        "globalCriticalPathLength": global_critical_path_length,
        "maxTopoLayer": graph_stats.get("maxTopoLayer", 0),
        "maxConcurrencyWidth": graph_stats.get("maxConcurrencyWidth", 0),
        "density": graph_stats.get("density", 0.0),
        "levelCounts": level_counts,
        "kindColorMap": kind_color_map,
        "depTypeColorMap": dep_type_color_map,
        "heatmapGradient": heatmap_gradient,
        "hasCycles": has_cycles,
        "layoutPrecomputed": layout_precomputed,
        "reachabilityMode": reachability_mode,
        "bottleneckMetric": betweenness_status if betweenness_status != "disabled_by_user" else "disabled",
        "articulationSemantics": "undirected_projection",
        "graphSizeClass": _classify_graph_size(len(nodes))
    }
    
    # Add optional performance data
    if performance:
        metadata["performance"] = performance
    
    # Add analysisModes
    metadata["analysisModes"] = {
        "reachability": reachability_mode,
        "betweenness": betweenness_status if betweenness_status in ["approximate", "exact", "disabled", "disabled_timeout"] else "disabled",
        "articulation": articulation_status if articulation_status in ["exact", "approximate", "disabled", "disabled_timeout"] else "disabled",
        "layout": "graphviz" if layout_precomputed else "none"
    }
    
    # Build output structure per spec §3.4
    output = {
        "metadata": metadata,
        "nodes": enriched_nodes,
        "edges": enriched_edges,
        "combos": combos or []
    }
    
    if combo_aggregates:
        output["comboAggregates"] = combo_aggregates
    
    # Add layout if precomputed
    if layout_precomputed and layout_nodes:
        output["layout"] = {"nodes": layout_nodes}
    
    return output


def _get_kind_color(kind: str) -> str:
    """Generate a deterministic color for a node kind."""
    # Predefined colors for common kinds
    predefined = {
        "build": "#1890ff",
        "import": "#52c41a",
        "compose": "#faad14",
        "script": "#722ed1",
        "source": "#eb2f96"
    }
    if kind in predefined:
        return predefined[kind]
    
    # Generate a deterministic color for unknown kinds using hash
    import hashlib
    hash_obj = hashlib.md5(kind.encode())
    hash_hex = hash_obj.hexdigest()[:6]
    return f"#{hash_hex}"


def _classify_graph_size(n: int) -> str:
    """Classify graph size per spec thresholds.
    
    Per schema enum: ['normal', 'large', 'huge', 'extreme', 'ultra']
    """
    if n < 20000:
        return "normal"
    elif n < 50000:
        return "large"
    elif n < 100000:
        return "huge"
    elif n < 200000:
        return "extreme"
    else:
        return "ultra"


def write_output_atomic(output: Dict[str, Any], output_path: str, validate: bool = True):
    """
    Write output to file atomically using temp-file + rename.
    
    This ensures that if the process is killed mid-write, the output file
    is either the previous complete version or doesn't exist - never truncated.
    
    Args:
        output: Output dictionary to serialize
        output_path: Target file path
        validate: Whether to self-validate before writing
    """
    if validate:
        logger.info("Validating output against schema...")
        schema = load_schema()
        validate_output(output, schema)
        logger.info("Output validation passed")
    
    # Get absolute path for proper temp file handling
    output_path = os.path.abspath(output_path)
    output_dir = os.path.dirname(output_path)
    
    # Create temp file in same directory (ensures same filesystem for atomic rename)
    fd, temp_path = tempfile.mkstemp(suffix='.json', dir=output_dir)
    
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(output, f, indent=2)
        
        # Atomic rename
        os.rename(temp_path, output_path)
        logger.info(f"Output written successfully to {output_path}")
        
    except Exception as e:
        # Clean up temp file on error
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        logger.error(f"Failed to write output: {e}")
        raise
