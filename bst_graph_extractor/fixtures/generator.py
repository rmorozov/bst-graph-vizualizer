"""
Fixture Generator for BuildStream Graph Toolkit

Seeded, deterministic generator producing test scenarios in both:
- `bst show`-shaped text format (for Tool 1's parser tests)
- Schema-valid JSON format (for Tool 2's tests)

All fixtures are retrievable by name from both tool test suites.
"""

import json
import random
import hashlib
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any


SCHEMA_VERSION = "5.5.0"

# Fixed color maps for determinism
KIND_COLOR_MAP = {
    "build": "#1890ff",
    "import": "#52c41a",
    "compose": "#faad14",
    "script": "#722ed1",
    "source": "#eb2f96",
}

DEP_TYPE_COLOR_MAP = {
    "build": "#1890ff",
    "runtime": "#52c41a",
    "both": "#722ed1",
}

HEATMAP_GRADIENT = ["#fffbe6", "#fff1b8", "#ff7a45", "#cf1322"]


class FixtureGenerator:
    """Generates deterministic test fixtures for various graph scenarios."""

    def __init__(self, seed: int = 42):
        self.seed = seed
        self.rng = random.Random(seed)

    def _reset_rng(self):
        """Reset RNG to initial seed for reproducibility."""
        self.rng = random.Random(self.seed)

    def _generate_node_id(self, index: int, prefix: str = "node") -> str:
        """Generate a deterministic node ID."""
        return f"{prefix}_{index:04d}.bst"

    def _generate_label(self, index: int, prefix: str = "Node") -> str:
        """Generate a deterministic label."""
        return f"{prefix}{index:04d}"

    def _get_kind(self, index: int) -> str:
        """Deterministically assign a kind based on index."""
        kinds = list(KIND_COLOR_MAP.keys())
        return kinds[index % len(kinds)]

    def generate_empty(self) -> Tuple[str, Dict]:
        """Generate empty graph fixture."""
        self._reset_rng()
        
        # BST text format (empty response)
        bst_text = ""
        
        # JSON format
        json_data = {
            "metadata": {
                "schemaVersion": SCHEMA_VERSION,
                "target": "empty.bst",
                "totalNodes": 0,
                "totalEdges": 0,
                "globalCriticalPathLength": 0,
                "maxTopoLayer": 0,
                "maxConcurrencyWidth": 0,
                "density": 0.0,
                "levelCounts": {},
                "kindColorMap": KIND_COLOR_MAP,
                "depTypeColorMap": DEP_TYPE_COLOR_MAP,
                "heatmapGradient": HEATMAP_GRADIENT,
                "hasCycles": False,
                "layoutPrecomputed": False,
                "reachabilityMode": "exact",
                "bottleneckMetric": "disabled",
                "articulationSemantics": "undirected_projection",
                "graphSizeClass": "normal",
                "performance": {
                    "parseMs": 0, "graphConstructionMs": 0, "sccMs": 0,
                    "reachabilityMs": 0, "criticalPathMs": 0, "betweennessMs": 0,
                    "articulationMs": 0, "layoutMs": 0, "serializationMs": 0,
                    "totalMs": 0, "peakMemoryMb": 0,
                    "maxReachabilityMemoryMb": 512, "targetedReachabilityK": 2000,
                    "metricTimeoutSeconds": 60
                },
                "analysisModes": {
                    "reachability": "exact",
                    "betweenness": "disabled",
                    "articulation": "disabled",
                    "layout": "none"
                }
            },
            "nodes": [],
            "edges": [],
            "combos": []
        }
        
        return bst_text, json_data

    def generate_single_node(self) -> Tuple[str, Dict]:
        """Generate single-node graph fixture."""
        self._reset_rng()
        
        bst_text = "single|build\n"
        
        json_data = {
            "metadata": {
                "schemaVersion": SCHEMA_VERSION,
                "target": "single.bst",
                "totalNodes": 1,
                "totalEdges": 0,
                "globalCriticalPathLength": 1,
                "maxTopoLayer": 0,
                "maxConcurrencyWidth": 1,
                "density": 0.0,
                "levelCounts": {"0": 1},
                "kindColorMap": KIND_COLOR_MAP,
                "depTypeColorMap": DEP_TYPE_COLOR_MAP,
                "heatmapGradient": HEATMAP_GRADIENT,
                "hasCycles": False,
                "layoutPrecomputed": False,
                "reachabilityMode": "exact",
                "bottleneckMetric": "disabled",
                "articulationSemantics": "undirected_projection",
                "graphSizeClass": "normal",
                "performance": {
                    "parseMs": 0, "graphConstructionMs": 0, "sccMs": 0,
                    "reachabilityMs": 0, "criticalPathMs": 0, "betweennessMs": 0,
                    "articulationMs": 0, "layoutMs": 0, "serializationMs": 0,
                    "totalMs": 0, "peakMemoryMb": 0,
                    "maxReachabilityMemoryMb": 512, "targetedReachabilityK": 2000,
                    "metricTimeoutSeconds": 60
                },
                "analysisModes": {
                    "reachability": "exact",
                    "betweenness": "disabled",
                    "articulation": "disabled",
                    "layout": "none"
                }
            },
            "nodes": [{
                "id": "single.bst",
                "type": "rect",
                "combo": "@root",
                "x": 0.0,
                "y": 0.0,
                "data": {
                    "label": "single.bst",
                    "kind": "build",
                    "sccId": None,
                    "inDegree": 0,
                    "outDegree": 0,
                    "topoLayer": 0,
                    "cpDepth": 0,
                    "cpHeight": 0,
                    "blastRadius": 0,
                    "buildCost": 0,
                    "bottleneckScore": None,
                    "isCritical": True,
                    "isArticulationPoint": False,
                    "isCycle": False
                },
                "style": {
                    "size": [140, 36],
                    "fill": "#e6f7ff",
                    "stroke": "#1890ff",
                    "lineWidth": 1
                }
            }],
            "edges": [],
            "combos": [{
                "id": "@root",
                "type": "rect",
                "data": {
                    "label": "root",
                    "nodeCount": 1,
                    "minTopoLayer": 0,
                    "maxTopoLayer": 0,
                    "maxBlastRadius": 0,
                    "maxBuildCost": 0,
                    "maxBottleneckScore": None,
                    "hasCritical": True
                },
                "style": {
                    "fill": "#ffffff",
                    "stroke": "#e8e8e8",
                    "collapsedSize": [120, 60]
                }
            }]
        }
        
        return bst_text, json_data

    def generate_self_loop(self) -> Tuple[str, Dict]:
        """Generate graph with a self-loop (cyclic)."""
        self._reset_rng()
        
        bst_text = """loop_node|build
- loop_node
"""
        
        json_data = {
            "metadata": {
                "schemaVersion": SCHEMA_VERSION,
                "target": "self_loop.bst",
                "totalNodes": 1,
                "totalEdges": 1,
                "globalCriticalPathLength": 0,
                "maxTopoLayer": 0,
                "maxConcurrencyWidth": 1,
                "density": 1.0,
                "levelCounts": {"0": 1},
                "kindColorMap": KIND_COLOR_MAP,
                "depTypeColorMap": DEP_TYPE_COLOR_MAP,
                "heatmapGradient": HEATMAP_GRADIENT,
                "hasCycles": True,
                "layoutPrecomputed": False,
                "reachabilityMode": "exact",
                "bottleneckMetric": "disabled",
                "articulationSemantics": "undirected_projection",
                "graphSizeClass": "normal",
                "performance": {
                    "parseMs": 0, "graphConstructionMs": 0, "sccMs": 0,
                    "reachabilityMs": 0, "criticalPathMs": 0, "betweennessMs": 0,
                    "articulationMs": 0, "layoutMs": 0, "serializationMs": 0,
                    "totalMs": 0, "peakMemoryMb": 0,
                    "maxReachabilityMemoryMb": 512, "targetedReachabilityK": 2000,
                    "metricTimeoutSeconds": 60
                },
                "analysisModes": {
                    "reachability": "exact",
                    "betweenness": "disabled",
                    "articulation": "disabled",
                    "layout": "none"
                }
            },
            "nodes": [{
                "id": "loop_node.bst",
                "type": "rect",
                "combo": "@root",
                "x": 0.0,
                "y": 0.0,
                "data": {
                    "label": "loop_node.bst",
                    "kind": "build",
                    "sccId": 0,
                    "inDegree": 1,
                    "outDegree": 1,
                    "topoLayer": 0,
                    "cpDepth": 0,
                    "cpHeight": 0,
                    "blastRadius": None,
                    "buildCost": None,
                    "bottleneckScore": None,
                    "isCritical": False,
                    "isArticulationPoint": False,
                    "isCycle": True
                },
                "style": {
                    "size": [140, 36],
                    "fill": "#e6f7ff",
                    "stroke": "#1890ff",
                    "lineWidth": 1
                }
            }],
            "edges": [{
                "id": "e_0",
                "type": "loop",
                "source": "loop_node.bst",
                "target": "loop_node.bst",
                "data": {
                    "depType": "build",
                    "isCritical": False
                },
                "style": {
                    "stroke": "#1890ff",
                    "endArrow": False,
                    "opacity": 0.4,
                    "lineWidth": 1
                }
            }],
            "combos": [{
                "id": "@root",
                "type": "rect",
                "data": {
                    "label": "root",
                    "nodeCount": 1,
                    "minTopoLayer": 0,
                    "maxTopoLayer": 0,
                    "maxBlastRadius": None,
                    "maxBuildCost": None,
                    "maxBottleneckScore": None,
                    "hasCritical": False
                },
                "style": {
                    "fill": "#ffffff",
                    "stroke": "#e8e8e8",
                    "collapsedSize": [120, 60]
                }
            }]
        }
        
        return bst_text, json_data

    def generate_dag(self, num_nodes: int = 10, density: float = 0.2) -> Tuple[str, Dict]:
        """Generate a simple DAG fixture."""
        self._reset_rng()
        
        nodes = []
        edges = []
        bst_lines = []
        
        for i in range(num_nodes):
            node_id = self._generate_node_id(i)
            kind = self._get_kind(i)
            label = self._generate_label(i, "Node")
            
            # Determine dependencies (only to earlier nodes to avoid cycles)
            deps = []
            if i > 0:
                max_deps = min(i, int(density * num_nodes))
                num_deps = self.rng.randint(0, max(0, max_deps))
                dep_indices = self.rng.sample(range(i), min(num_deps, i))
                deps = sorted(dep_indices)
            
            bst_lines.append(f"{node_id}|{kind}")
            for dep_idx in deps:
                dep_id = self._generate_node_id(dep_idx)
                bst_lines.append(f"- {dep_id}")
            
            nodes.append({
                "id": node_id,
                "type": "rect",
                "combo": "@root",
                "x": float(i * 100),
                "y": float((i % 5) * 50),
                "data": {
                    "label": f"{node_id}",
                    "kind": kind,
                    "sccId": None,
                    "inDegree": len([e for e in edges if e["target"] == node_id]),
                    "outDegree": len(deps),
                    "topoLayer": i,
                    "cpDepth": i,
                    "cpHeight": num_nodes - i - 1,
                    "blastRadius": num_nodes - i - 1,
                    "buildCost": i,
                    "bottleneckScore": round(self.rng.random(), 4) if i > 0 else None,
                    "isCritical": i == 0 or i == num_nodes - 1,
                    "isArticulationPoint": i > 0 and i < num_nodes - 1,
                    "isCycle": False
                },
                "style": {
                    "size": [140, 36],
                    "fill": "#e6f7ff",
                    "stroke": KIND_COLOR_MAP[kind],
                    "lineWidth": 1
                }
            })
            
            for dep_idx in deps:
                dep_id = self._generate_node_id(dep_idx)
                edge_id = f"e_{len(edges)}"
                edges.append({
                    "id": edge_id,
                    "type": "cubic-horizontal",
                    "source": node_id,
                    "target": dep_id,
                    "data": {
                        "depType": "build",
                        "isCritical": False
                    },
                    "style": {
                        "stroke": "#1890ff",
                        "endArrow": False,
                        "opacity": 0.4,
                        "lineWidth": 1
                    }
                })
        
        bst_text = "\n".join(bst_lines) + "\n" if bst_lines else ""
        
        json_data = {
            "metadata": {
                "schemaVersion": SCHEMA_VERSION,
                "target": "dag.bst",
                "totalNodes": num_nodes,
                "totalEdges": len(edges),
                "globalCriticalPathLength": num_nodes,
                "maxTopoLayer": num_nodes - 1,
                "maxConcurrencyWidth": 1,
                "density": len(edges) / max(1, num_nodes * (num_nodes - 1)),
                "levelCounts": {str(i): 1 for i in range(num_nodes)},
                "kindColorMap": KIND_COLOR_MAP,
                "depTypeColorMap": DEP_TYPE_COLOR_MAP,
                "heatmapGradient": HEATMAP_GRADIENT,
                "hasCycles": False,
                "layoutPrecomputed": False,
                "reachabilityMode": "exact",
                "bottleneckMetric": "approximate",
                "articulationSemantics": "undirected_projection",
                "graphSizeClass": "normal",
                "performance": {
                    "parseMs": 0, "graphConstructionMs": 0, "sccMs": 0,
                    "reachabilityMs": 0, "criticalPathMs": 0, "betweennessMs": 0,
                    "articulationMs": 0, "layoutMs": 0, "serializationMs": 0,
                    "totalMs": 0, "peakMemoryMb": 0,
                    "maxReachabilityMemoryMb": 512, "targetedReachabilityK": 2000,
                    "metricTimeoutSeconds": 60
                },
                "analysisModes": {
                    "reachability": "exact",
                    "betweenness": "approximate",
                    "articulation": "approximate",
                    "layout": "none"
                }
            },
            "nodes": nodes,
            "edges": edges,
            "combos": [{
                "id": "@root",
                "type": "rect",
                "data": {
                    "label": "root",
                    "nodeCount": num_nodes,
                    "minTopoLayer": 0,
                    "maxTopoLayer": num_nodes - 1,
                    "maxBlastRadius": num_nodes - 1,
                    "maxBuildCost": num_nodes - 1,
                    "maxBottleneckScore": 1.0,
                    "hasCritical": True
                },
                "style": {
                    "fill": "#ffffff",
                    "stroke": "#e8e8e8",
                    "collapsedSize": [240, 120]
                }
            }]
        }
        
        return bst_text, json_data

    def generate_nested_combos(self) -> Tuple[str, Dict]:
        """Generate graph with nested combo structure."""
        self._reset_rng()
        
        bst_text = """root_target|build
- components/component_a.bst
- components/component_b.bst

components/component_a.bst|build
- base/library1.bst
- base/library2.bst

components/component_b.bst|build
- base/library3.bst

base/library1.bst|import
base/library2.bst|import
base/library3.bst|import
"""
        
        json_data = {
            "metadata": {
                "schemaVersion": SCHEMA_VERSION,
                "target": "nested.bst",
                "totalNodes": 6,
                "totalEdges": 5,
                "globalCriticalPathLength": 3,
                "maxTopoLayer": 2,
                "maxConcurrencyWidth": 2,
                "density": 0.33,
                "levelCounts": {"0": 3, "1": 2, "2": 1},
                "kindColorMap": KIND_COLOR_MAP,
                "depTypeColorMap": DEP_TYPE_COLOR_MAP,
                "heatmapGradient": HEATMAP_GRADIENT,
                "hasCycles": False,
                "layoutPrecomputed": False,
                "reachabilityMode": "exact",
                "bottleneckMetric": "exact",
                "articulationSemantics": "undirected_projection",
                "graphSizeClass": "normal",
                "performance": {
                    "parseMs": 0, "graphConstructionMs": 0, "sccMs": 0,
                    "reachabilityMs": 0, "criticalPathMs": 0, "betweennessMs": 0,
                    "articulationMs": 0, "layoutMs": 0, "serializationMs": 0,
                    "totalMs": 0, "peakMemoryMb": 0,
                    "maxReachabilityMemoryMb": 512, "targetedReachabilityK": 2000,
                    "metricTimeoutSeconds": 60
                },
                "analysisModes": {
                    "reachability": "exact",
                    "betweenness": "exact",
                    "articulation": "exact",
                    "layout": "none"
                }
            },
            "nodes": [
                {
                    "id": "root_target.bst",
                    "type": "rect",
                    "combo": "components",
                    "x": 200.0,
                    "y": 0.0,
                    "data": {
                        "label": "root_target.bst",
                        "kind": "build",
                        "sccId": None,
                        "inDegree": 0,
                        "outDegree": 2,
                        "topoLayer": 2,
                        "cpDepth": 2,
                        "cpHeight": 0,
                        "blastRadius": 0,
                        "buildCost": 5,
                        "bottleneckScore": None,
                        "isCritical": True,
                        "isArticulationPoint": False,
                        "isCycle": False
                    },
                    "style": {"size": [140, 36], "fill": "#e6f7ff", "stroke": "#1890ff", "lineWidth": 1}
                },
                {
                    "id": "components/component_a.bst",
                    "type": "rect",
                    "combo": "components",
                    "x": 100.0,
                    "y": -50.0,
                    "data": {
                        "label": "component_a.bst",
                        "kind": "build",
                        "sccId": None,
                        "inDegree": 1,
                        "outDegree": 2,
                        "topoLayer": 1,
                        "cpDepth": 1,
                        "cpHeight": 1,
                        "blastRadius": 1,
                        "buildCost": 2,
                        "bottleneckScore": 0.5,
                        "isCritical": True,
                        "isArticulationPoint": True,
                        "isCycle": False
                    },
                    "style": {"size": [140, 36], "fill": "#e6f7ff", "stroke": "#1890ff", "lineWidth": 1}
                },
                {
                    "id": "components/component_b.bst",
                    "type": "rect",
                    "combo": "components",
                    "x": 100.0,
                    "y": 50.0,
                    "data": {
                        "label": "component_b.bst",
                        "kind": "build",
                        "sccId": None,
                        "inDegree": 1,
                        "outDegree": 1,
                        "topoLayer": 1,
                        "cpDepth": 1,
                        "cpHeight": 1,
                        "blastRadius": 1,
                        "buildCost": 1,
                        "bottleneckScore": 0.0,
                        "isCritical": False,
                        "isArticulationPoint": False,
                        "isCycle": False
                    },
                    "style": {"size": [140, 36], "fill": "#e6f7ff", "stroke": "#1890ff", "lineWidth": 1}
                },
                {
                    "id": "base/library1.bst",
                    "type": "rect",
                    "combo": "base",
                    "x": 0.0,
                    "y": -100.0,
                    "data": {
                        "label": "library1.bst",
                        "kind": "import",
                        "sccId": None,
                        "inDegree": 1,
                        "outDegree": 0,
                        "topoLayer": 0,
                        "cpDepth": 0,
                        "cpHeight": 2,
                        "blastRadius": 3,
                        "buildCost": 0,
                        "bottleneckScore": 0.0,
                        "isCritical": False,
                        "isArticulationPoint": False,
                        "isCycle": False
                    },
                    "style": {"size": [140, 36], "fill": "#f6ffed", "stroke": "#52c41a", "lineWidth": 1}
                },
                {
                    "id": "base/library2.bst",
                    "type": "rect",
                    "combo": "base",
                    "x": 0.0,
                    "y": -50.0,
                    "data": {
                        "label": "library2.bst",
                        "kind": "import",
                        "sccId": None,
                        "inDegree": 1,
                        "outDegree": 0,
                        "topoLayer": 0,
                        "cpDepth": 0,
                        "cpHeight": 2,
                        "blastRadius": 2,
                        "buildCost": 0,
                        "bottleneckScore": 0.0,
                        "isCritical": False,
                        "isArticulationPoint": False,
                        "isCycle": False
                    },
                    "style": {"size": [140, 36], "fill": "#f6ffed", "stroke": "#52c41a", "lineWidth": 1}
                },
                {
                    "id": "base/library3.bst",
                    "type": "rect",
                    "combo": "base",
                    "x": 0.0,
                    "y": 50.0,
                    "data": {
                        "label": "library3.bst",
                        "kind": "import",
                        "sccId": None,
                        "inDegree": 1,
                        "outDegree": 0,
                        "topoLayer": 0,
                        "cpDepth": 0,
                        "cpHeight": 2,
                        "blastRadius": 1,
                        "buildCost": 0,
                        "bottleneckScore": 0.0,
                        "isCritical": False,
                        "isArticulationPoint": False,
                        "isCycle": False
                    },
                    "style": {"size": [140, 36], "fill": "#f6ffed", "stroke": "#52c41a", "lineWidth": 1}
                }
            ],
            "edges": [
                {"id": "e_0", "type": "cubic-horizontal", "source": "root_target.bst", "target": "components/component_a.bst", 
                 "data": {"depType": "build", "isCritical": True}, 
                 "style": {"stroke": "#1890ff", "endArrow": False, "opacity": 1.0, "lineWidth": 4}},
                {"id": "e_1", "type": "cubic-horizontal", "source": "root_target.bst", "target": "components/component_b.bst",
                 "data": {"depType": "build", "isCritical": False},
                 "style": {"stroke": "#1890ff", "endArrow": False, "opacity": 0.4, "lineWidth": 1}},
                {"id": "e_2", "type": "cubic-horizontal", "source": "components/component_a.bst", "target": "base/library1.bst",
                 "data": {"depType": "build", "isCritical": False},
                 "style": {"stroke": "#1890ff", "endArrow": False, "opacity": 0.4, "lineWidth": 1}},
                {"id": "e_3", "type": "cubic-horizontal", "source": "components/component_a.bst", "target": "base/library2.bst",
                 "data": {"depType": "build", "isCritical": False},
                 "style": {"stroke": "#1890ff", "endArrow": False, "opacity": 0.4, "lineWidth": 1}},
                {"id": "e_4", "type": "cubic-horizontal", "source": "components/component_b.bst", "target": "base/library3.bst",
                 "data": {"depType": "build", "isCritical": False},
                 "style": {"stroke": "#1890ff", "endArrow": False, "opacity": 0.4, "lineWidth": 1}}
            ],
            "combos": [
                {
                    "id": "base",
                    "type": "rect",
                    "combo": "components",
                    "data": {
                        "label": "base",
                        "nodeCount": 3,
                        "minTopoLayer": 0,
                        "maxTopoLayer": 0,
                        "maxBlastRadius": 3,
                        "maxBuildCost": 0,
                        "maxBottleneckScore": 0.0,
                        "hasCritical": False
                    },
                    "style": {"fill": "#fafafa", "stroke": "#d9d9d9", "collapsedSize": [100, 50]}
                },
                {
                    "id": "components",
                    "type": "rect",
                    "data": {
                        "label": "components",
                        "nodeCount": 5,
                        "minTopoLayer": 0,
                        "maxTopoLayer": 2,
                        "maxBlastRadius": 3,
                        "maxBuildCost": 5,
                        "maxBottleneckScore": 0.5,
                        "hasCritical": True
                    },
                    "style": {"fill": "#fafafa", "stroke": "#d9d9d9", "collapsedSize": [140, 70]}
                },
                {
                    "id": "@root",
                    "type": "rect",
                    "data": {
                        "label": "root",
                        "nodeCount": 6,
                        "minTopoLayer": 0,
                        "maxTopoLayer": 2,
                        "maxBlastRadius": 3,
                        "maxBuildCost": 5,
                        "maxBottleneckScore": 0.5,
                        "hasCritical": True
                    },
                    "style": {"fill": "#ffffff", "stroke": "#e8e8e8", "collapsedSize": [240, 120]}
                }
            ]
        }
        
        return bst_text, json_data

    def get_fixture(self, name: str) -> Tuple[str, Dict]:
        """Get a fixture by name."""
        fixtures = {
            "empty": self.generate_empty,
            "single_node": self.generate_single_node,
            "self_loop": self.generate_self_loop,
            "dag": self.generate_dag,
            "nested_combos": self.generate_nested_combos,
        }
        
        if name not in fixtures:
            raise ValueError(f"Unknown fixture: {name}. Available: {list(fixtures.keys())}")
        
        return fixtures[name]()

    def save_fixtures(self, output_dir: Path):
        """Save all fixtures to files."""
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        fixture_names = ["empty", "single_node", "self_loop", "dag", "nested_combos"]
        
        for name in fixture_names:
            bst_text, json_data = self.get_fixture(name)
            
            # Save BST text format
            bst_path = output_dir / f"{name}.txt"
            bst_path.write_text(bst_text)
            
            # Save JSON format
            json_path = output_dir / f"{name}.json"
            json_path.write_text(json.dumps(json_data, indent=2))
            
            print(f"Generated fixtures: {bst_path}, {json_path}")


def main():
    """Generate all fixtures."""
    generator = FixtureGenerator(seed=42)
    
    # Default output directory
    output_dir = Path(__file__).parent / "fixtures"
    generator.save_fixtures(output_dir)
    
    print(f"\nAll fixtures saved to {output_dir}")


if __name__ == "__main__":
    main()
