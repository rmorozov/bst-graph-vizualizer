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
    layout_nodes: Optional[List[Dict[str, float]]] = None
) -> Dict[str, Any]:
    """
    Assemble all data into final output structure.
    
    Args:
        nodes: List of node objects with id, kind, name, etc.
        edges: List of edge objects with source, target, depType
        node_metrics: Per-node computed metrics
        graph_stats: Graph-level statistics
        combo_aggregates: Aggregated metrics for combos (optional)
        combos: Combo definitions (optional)
        performance: Timing data for each stage
        reachability_mode: actual reachability mode used
        betweenness_status: betweenness computation status
        articulation_status: articulation points status
        global_critical_path_length: length of critical path
        layout_precomputed: whether layout was precomputed
        layout_nodes: precomputed layout coordinates
        
    Returns:
        Complete output dictionary ready for JSON serialization
    """
    # Enrich nodes with metrics
    enriched_nodes = []
    for node in nodes:
        node_id = node.get("id")
        metrics = node_metrics.get(node_id, {})
        
        enriched_node = {**node, **metrics}
        enriched_nodes.append(enriched_node)
    
    # Build output structure per spec §3.4
    output = {
        "schemaVersion": "1.0.0",
        "metadata": {
            "totalNodes": len(nodes),
            "totalEdges": len(edges),
            "graphSizeClass": _classify_graph_size(len(nodes)),
            "performance": performance or {},
            "analysisModes": {
                "reachability": reachability_mode,
                "betweenness": betweenness_status,
                "articulation": articulation_status
            },
            "globalCriticalPathLength": global_critical_path_length,
            "layoutPrecomputed": layout_precomputed
        },
        "nodes": enriched_nodes,
        "edges": edges,
        "combos": [],  # Required by schema, even if empty
        "graphStats": graph_stats
    }
    
    if combo_aggregates:
        output["comboAggregates"] = combo_aggregates
    
    # Add layout if precomputed
    if layout_precomputed and layout_nodes:
        output["layout"] = {"nodes": layout_nodes}
    
    return output


def _classify_graph_size(n: int) -> str:
    """Classify graph size per spec thresholds."""
    if n < 5000:
        return "small"
    elif n < 20000:
        return "medium"
    elif n < 50000:
        return "large"
    elif n < 100000:
        return "very_large"
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
