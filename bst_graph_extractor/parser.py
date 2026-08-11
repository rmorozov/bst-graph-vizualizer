"""
parser.py — raw bst show text → node/edge records

Parses the output of `bst show` into structured node and edge records.
Handles:
  - Normal records with dependencies
  - Empty deps (`[]`)
  - Malformed lines (optionally logged with --show-invalid)
  - Duplicate build+runtime edges → depType: "both"
  - Self-loop records
  - References to undeclared nodes (WARNING)

This module never raises exceptions for malformed input — it logs warnings
and skips bad lines, returning only valid records.
"""

import re
import logging
from typing import List, Dict, Tuple, Optional, Set
from dataclasses import dataclass, field

from .logging_config import get_logger

logger = get_logger("parser")


@dataclass
class NodeRecord:
    """A parsed node record from bst show output."""
    id: str
    kind: str  # source, build, binary, etc.
    name: str
    build_cost: Optional[float] = None
    size: Optional[int] = None


@dataclass
class EdgeRecord:
    """A parsed edge record from bst show output."""
    source: str
    target: str
    dep_type: str = "build"  # build, runtime, both


def parse_bst_show_output(raw_text: str, show_invalid: bool = False) -> Tuple[List[NodeRecord], List[EdgeRecord]]:
    """
    Parse bst show output into node and edge records.
    
    Args:
        raw_text: Raw stdout from bst show
        show_invalid: If True, log WARNING for each malformed line
        
    Returns:
        Tuple of (nodes, edges)
    """
    nodes: List[NodeRecord] = []
    edges: List[EdgeRecord] = []
    
    # Track seen edges to detect duplicates (build + runtime → "both")
    seen_edges: Dict[Tuple[str, str], str] = {}
    
    # Track declared node IDs for undeclared reference detection
    declared_ids: Set[str] = set()
    
    lines = raw_text.strip().split('\n') if raw_text.strip() else []
    
    for line_num, line in enumerate(lines, start=1):
        line = line.strip()
        if not line:
            continue
        
        try:
            node_record, edge_records = _parse_line(line, line_num, show_invalid)
            
            if node_record:
                nodes.append(node_record)
                declared_ids.add(node_record.id)
            
            for edge in edge_records:
                edge_key = (edge.source, edge.target)
                
                if edge_key in seen_edges:
                    # Duplicate edge: upgrade to "both" if different types
                    existing_type = seen_edges[edge_key]
                    if existing_type != edge.dep_type:
                        seen_edges[edge_key] = "both"
                        # Update the edge in the list
                        for e in edges:
                            if e.source == edge.source and e.target == edge.target:
                                e.dep_type = "both"
                                break
                else:
                    seen_edges[edge_key] = edge.dep_type
                    edges.append(edge)
                    
        except Exception as e:
            if show_invalid:
                logger.warning(f"[line {line_num}] Malformed line: {line[:100]}... Error: {e}")
            # Skip malformed lines silently by default
            continue
    
    # Second pass: warn about edges referencing undeclared nodes
    for edge in edges:
        if edge.source not in declared_ids:
            logger.warning(f"Edge references undeclared source node: {edge.source}")
        if edge.target not in declared_ids:
            logger.warning(f"Edge references undeclared target node: {edge.target}")
    
    return nodes, edges


# Module-level state for tracking current node during parsing
_current_node_context: Dict[int, Optional[str]] = {}


def _parse_line(line: str, line_num: int, show_invalid: bool = False) -> Tuple[Optional[NodeRecord], List[EdgeRecord]]:
    """
    Parse a single line of bst show output.
    
    Expected formats:
      - Node declaration: "<id>|<kind>" or "<id> <kind> <name> [build_cost=<float>] [size=<int>] deps=[<dep_id>, ...]"
      - Dependency line: "- <dep_id>" (must follow a node declaration)
      - Runtime dependency: "- <dep_id> [runtime]"
    
    Returns:
        Tuple of (node_record or None, list of edge_records)
    """
    global _current_node_context
    
    edges: List[EdgeRecord] = []
    node_record: Optional[NodeRecord] = None
    
    # Check if this is a dependency line (starts with '-')
    if line.startswith('-'):
        # This is a dependency line referencing the previous node
        dep_parts = line[1:].strip().split()
        if not dep_parts:
            raise ValueError(f"Empty dependency line: {line}")
        
        dep_id = dep_parts[0]
        
        # Determine dependency type
        dep_type = "build"
        if len(dep_parts) > 1 and dep_parts[1].lower() == "runtime":
            dep_type = "runtime"
        
        # Get the current node context (the node we're adding dependencies to)
        current_node = _current_node_context.get(line_num - 1)
        if current_node is None:
            # Try to find the most recent node declaration
            for prev_line in range(line_num - 1, max(0, line_num - 100), -1):
                if prev_line in _current_node_context and _current_node_context[prev_line] is not None:
                    current_node = _current_node_context[prev_line]
                    break
        
        if current_node is None:
            raise ValueError(f"Dependency line without preceding node declaration: {line}")
        
        edges.append(EdgeRecord(
            source=dep_id,
            target=current_node,
            dep_type=dep_type
        ))
        
        return None, edges
    
    # This is a node declaration line
    # Format: "<id>|<kind>" or "<id> <kind> <name> ..."
    
    if '|' in line:
        # Pipe-separated format: "node_id|kind"
        parts = line.split('|')
        if len(parts) < 2:
            raise ValueError(f"Invalid pipe-separated format: {line}")
        
        node_id = parts[0].strip()
        node_kind = parts[1].strip()
        node_name = node_id  # Use ID as name if not specified
        
        # Check for additional info after kind (e.g., "node|kind extra_info")
        extra_parts = node_kind.split(None, 1)
        if len(extra_parts) > 1:
            node_kind = extra_parts[0]
            # The rest could be name or other info
            remaining = extra_parts[1]
            if not remaining.startswith('['):
                node_name = remaining.split()[0]
    else:
        # Space-separated format
        parts = line.split()
        if len(parts) < 2:
            raise ValueError(f"Line has fewer than 2 parts: {line[:50]}")
        
        node_id = parts[0]
        node_kind = parts[1]
        node_name = parts[2] if len(parts) > 2 else node_id
    
    # Parse optional fields (for space-separated format)
    build_cost: Optional[float] = None
    size: Optional[int] = None
    deps: List[str] = []
    
    if '|' not in line:
        # Only parse optional fields for space-separated format
        for part in parts[3:]:
            if part.startswith("build_cost="):
                try:
                    build_cost = float(part.split("=", 1)[1])
                except ValueError:
                    raise ValueError(f"Invalid build_cost value: {part}")
            elif part.startswith("size="):
                try:
                    size = int(part.split("=", 1)[1])
                except ValueError:
                    raise ValueError(f"Invalid size value: {part}")
            elif part.startswith("deps="):
                deps_str = part.split("=", 1)[1]
                if deps_str != "[]":
                    # Parse dependency list
                    deps_str = deps_str.strip("[]")
                    deps = [d.strip() for d in deps_str.split(",") if d.strip()]
    
    node_record = NodeRecord(
        id=node_id,
        kind=node_kind,
        name=node_name,
        build_cost=build_cost,
        size=size
    )
    
    # Store this node as the current context for subsequent dependency lines
    _current_node_context[line_num] = node_id
    
    # Create edges from inline dependencies (space-separated format only)
    for dep_id in deps:
        edges.append(EdgeRecord(
            source=dep_id,
            target=node_id,
            dep_type="build"
        ))
    
    return node_record, edges
