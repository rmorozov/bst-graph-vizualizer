"""
layout.py — Graphviz layout integration

Computes node coordinates using Graphviz's dot layout engine.
Features:
  - rankdir=LR (left-to-right) for build dependency flow
  - Y-axis inversion to match viewer coordinate system
  - Hard error on missing graphviz dependency when --precompute-layout is used

Exit codes:
  1 — graphviz not found or layout computation fails
"""

import subprocess
import sys
import tempfile
import os
from typing import Dict, Any, List, Optional, Tuple
from pathlib import Path

from .logging_config import get_logger

logger = get_logger("layout")


class LayoutError(Exception):
    """Raised when layout computation fails."""
    pass


def check_graphviz_available() -> bool:
    """
    Check if graphviz (dot command) is available.

    Returns:
        True if dot command is found, False otherwise
    """
    try:
        result = subprocess.run(
            ["dot", "-V"],
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False
    except subprocess.TimeoutExpired:
        return False
    except Exception:
        return False


def compute_layout(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    rankdir: str = "LR"
) -> List[Dict[str, float]]:
    """
    Compute node coordinates using Graphviz dot layout.

    Args:
        nodes: List of node dicts with 'id' key
        edges: List of edge dicts with 'source' and 'target' keys
        rankdir: Layout direction ('LR', 'TB', 'RL', 'BT')

    Returns:
        List of dicts with 'id', 'x', 'y' coordinates

    Raises:
        LayoutError: if graphviz is not available or layout fails
    """
    if not check_graphviz_available():
        logger.error("Graphviz 'dot' command not found. Install graphviz to use --precompute-layout.")
        raise LayoutError("graphviz not found")

    n = len(nodes)
    logger.info(f"Computing layout for {n} nodes using Graphviz (rankdir={rankdir})")

    # Build DOT file content
    dot_content = _build_dot_file(nodes, edges, rankdir)

    # Run graphviz dot command
    try:
        layout_result = _run_dot_layout(dot_content)
    except Exception as e:
        logger.error(f"Graphviz layout failed: {e}")
        raise LayoutError(f"layout computation failed: {e}")

    logger.info(f"Layout computed successfully for {len(layout_result)} nodes")
    return layout_result


def _build_dot_file(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    rankdir: str
) -> str:
    """Build DOT format string for graphviz."""
    lines = [
        "digraph G {",
        f"  rankdir={rankdir};",
        "  node [shape=box];",
        ""
    ]

    # Add nodes
    for node in nodes:
        node_id = node["id"]
        # Sanitize ID for DOT format (replace special chars)
        dot_id = _sanitize_dot_id(node_id)
        label = node.get("name", node_id)
        lines.append(f'  "{dot_id}" [label="{_escape_dot_string(label)}"];')

    # Add edges
    for edge in edges:
        source = _sanitize_dot_id(edge["source"])
        target = _sanitize_dot_id(edge["target"])
        dep_type = edge.get("depType", "build")
        lines.append(f'  "{source}" -> "{target}";')

    lines.append("}")
    return "\n".join(lines)


def _sanitize_dot_id(node_id: str) -> str:
    """Sanitize node ID for DOT format."""
    # Replace problematic characters
    sanitized = node_id.replace("/", "_").replace(":", "_").replace(".", "_")
    return sanitized


def _escape_dot_string(s: str) -> str:
    """Escape special characters in DOT strings."""
    return s.replace('"', '\\"').replace('\n', '\\n')


def _run_dot_layout(dot_content: str) -> List[Dict[str, float]]:
    """
    Run graphviz dot command and parse output.

    Uses neato or dot with -Tplain output for easy parsing.
    """
    # Use dot with plain output format for easy parsing
    try:
        result = subprocess.run(
            ["dot", "-Tplain"],
            input=dot_content,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout for large graphs
        )

        if result.returncode != 0:
            raise LayoutError(f"dot command failed: {result.stderr[:500]}")

        return _parse_plain_output(result.stdout)

    except subprocess.TimeoutExpired:
        raise LayoutError("dot command timed out")


def _parse_plain_output(output: str) -> List[Dict[str, float]]:
    """
    Parse graphviz plain output format.

    Plain format:
    graph <scale> <bb_x1> <bb_y1> <bb_x2> <bb_y2>
    node <id> <x> <y> <width> <height> ...
    edge <tail> <head> <x1> <y1> ...
    stop
    """
    layout_nodes = []

    for line in output.strip().split('\n'):
        parts = line.split(' ')
        if parts[0] == 'node':
            # Format: node id x y width height
            if len(parts) >= 4:
                node_id = parts[1]
                try:
                    x = float(parts[2])
                    y = float(parts[3])
                    # Invert Y axis to match viewer coordinate system
                    layout_nodes.append({
                        "id": node_id,
                        "x": x,
                        "y": -y  # Y-axis inversion
                    })
                except (ValueError, IndexError):
                    continue

    return layout_nodes


def write_layout_to_file(
    layout_nodes: List[Dict[str, float]],
    output_path: str
) -> None:
    """
    Write layout coordinates to a JSON file.

    Args:
        layout_nodes: List of layout results
        output_path: Path to write JSON output
    """
    import json

    with open(output_path, 'w') as f:
        json.dump(layout_nodes, f, indent=2)

    logger.info(f"Layout written to {output_path}")
