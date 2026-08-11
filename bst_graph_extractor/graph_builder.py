"""
graph_builder.py — build nx.DiGraph from parsed records

Constructs a NetworkX DiGraph from NodeRecord and EdgeRecord lists.
Handles:
  - Self-loop edges (preserved, not dropped)
  - Duplicate detection (already handled by parser)
  
This module assumes parser has already validated the records.
"""

import networkx as nx
from typing import List, Tuple

from .logging_config import get_logger
from .parser import NodeRecord, EdgeRecord

logger = get_logger("graph_builder")


def build_graph(nodes: List[NodeRecord], edges: List[EdgeRecord]) -> nx.DiGraph:
    """
    Build a NetworkX DiGraph from parsed node and edge records.
    
    Args:
        nodes: List of NodeRecord from parser
        edges: List of EdgeRecord from parser
        
    Returns:
        nx.DiGraph with all nodes and edges added
    """
    G = nx.DiGraph()
    
    # Add nodes with their attributes
    for node in nodes:
        G.add_node(
            node.id,
            kind=node.kind,
            name=node.name,
            buildCost=node.build_cost,
            size=node.size
        )
    
    # Add edges with their attributes
    for edge in edges:
        G.add_edge(
            edge.source,
            edge.target,
            depType=edge.dep_type
        )
    
    logger.info(f"Built graph with {G.number_of_nodes()} nodes and {G.number_of_edges()} edges")
    
    return G
