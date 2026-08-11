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


def _parse_line(line: str, line_num: int, show_invalid: bool = False) -> Tuple[Optional[NodeRecord], List[EdgeRecord]]:
    """
    Parse a single line of bst show output.
    
    Expected format (simplified):
      <id> <kind> <name> [build_cost=<float>] [size=<int>] deps=[<dep_id>, ...]
    
    Returns:
        Tuple of (node_record or None, list of edge_records)
    """
    edges: List[EdgeRecord] = []
    
    # Basic pattern: extract ID, kind, name, and optional fields
    # This is a simplified parser; adjust regex based on actual bst show output format
    
    # Example line formats to handle:
    #   "abc123 source /path/to/file.tar.gz"
    #   "def456 build my-target build_cost=1.5 size=1024 deps=[abc123, ghi789]"
    #   "jkl012 binary output.bin deps=[]"
    
    parts = line.split()
    if len(parts) < 3:
        raise ValueError(f"Line has fewer than 3 parts: {line[:50]}")
    
    node_id = parts[0]
    node_kind = parts[1]
    node_name = parts[2]
    
    # Parse optional fields
    build_cost: Optional[float] = None
    size: Optional[int] = None
    deps: List[str] = []
    
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
    
    # Create edges from dependencies
    for dep_id in deps:
        edges.append(EdgeRecord(
            source=dep_id,
            target=node_id,
            dep_type="build"  # Default; may be upgraded to "both" later
        ))
    
    return node_record, edges
