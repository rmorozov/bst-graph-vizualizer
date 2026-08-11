"""
CLI Interface for BuildStream Graph Extractor

Implements T1.1: CLI scaffold, argument parsing, exit codes.
- Parses every flag in spec §3.1
- Enforces --no-betweenness > --expensive-metrics precedence
- Validates flag combinations
- Exit codes: 0 success, 1 fatal error, 2 invalid CLI arguments

Main extraction pipeline:
  1. Run bst show via bst_interface
  2. Parse output via parser
  3. Build graph via graph_builder
  4. Compute SCCs via scc
  5. Compute cheap metrics
  6. Compute reachability
  7. Compute betweenness (if enabled)
  8. Compute articulation points (if enabled)
  9. Compute critical path
  10. Aggregate combo metrics
  11. Compute styles
  12. Optionally compute layout
  13. Serialize and write output
"""

import argparse
import sys
import time
from typing import Optional, Tuple, Dict, Any


# Default values from spec §3.1
DEFAULT_OUTPUT = "graph_data.json"
DEFAULT_MAX_REACHABILITY_MEMORY_MB = 512
DEFAULT_TARGETED_REACHABILITY_K = 2000
DEFAULT_METRIC_TIMEOUT_SECONDS = 60
DEFAULT_BETWEENNESS_SAMPLES = 500


def create_parser() -> argparse.ArgumentParser:
    """Create and configure the argument parser with all documented flags."""
    parser = argparse.ArgumentParser(
        prog="bst_graph_extractor.py",
        description="Extract and analyze BuildStream dependency graphs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exit codes:
  0  Success (possibly with warnings)
  1  Fatal error (e.g., bst binary not found, subprocess failure)
  2  Invalid CLI arguments or flag combination

Examples:
  %(prog)s myproject.bst
  %(prog)s myproject.bst -o output.json --precompute-layout
  %(prog)s myproject.bst --expensive-metrics --max-reachability-memory 1024
  %(prog)s myproject.bst --no-betweenness --no-reachability
"""
    )
    
    # Required positional argument
    parser.add_argument(
        "TARGET",
        help="BuildStream target element"
    )
    
    # Output options
    parser.add_argument(
        "-o", "--output",
        default=DEFAULT_OUTPUT,
        help=f"JSON output file (default: {DEFAULT_OUTPUT})"
    )
    
    # Parsing options
    parser.add_argument(
        "--show-invalid",
        action="store_true",
        help="Show parsing warnings to stderr"
    )
    
    parser.add_argument(
        "--include-runtime",
        action="store_true",
        help="Include runtime dependencies in the graph"
    )
    
    # Layout options
    parser.add_argument(
        "--precompute-layout",
        action="store_true",
        help="Use graphviz for node positioning (rankdir=LR, Y-inverted). Required for graphs >20k nodes."
    )
    
    # Expensive metrics control
    parser.add_argument(
        "--expensive-metrics",
        action="store_true",
        help="Force exact betweenness and articulation points regardless of size. Warns above 20k nodes."
    )
    
    parser.add_argument(
        "--betweenness-samples",
        type=int,
        default=DEFAULT_BETWEENNESS_SAMPLES,
        metavar="N",
        help=f"Number of sources for approximate betweenness (default: {DEFAULT_BETWEENNESS_SAMPLES}). Ignored in exact mode."
    )
    
    parser.add_argument(
        "--no-betweenness",
        action="store_true",
        help="Disable betweenness centrality computation entirely. Highest precedence - overrides --expensive-metrics."
    )
    
    parser.add_argument(
        "--no-reachability",
        action="store_true",
        help="Disable reachability computation entirely (reachabilityMode: disabled_by_user)"
    )
    
    # Reachability memory/performance controls
    parser.add_argument(
        "--max-reachability-memory",
        type=int,
        default=DEFAULT_MAX_REACHABILITY_MEMORY_MB,
        metavar="MB",
        help=f"Memory budget for exact bitset closure in MB (default: {DEFAULT_MAX_REACHABILITY_MEMORY_MB})"
    )
    
    parser.add_argument(
        "--targeted-reachability-k",
        type=int,
        default=DEFAULT_TARGETED_REACHABILITY_K,
        metavar="K",
        help=f"Size of high-value subset for targeted reachability (default: {DEFAULT_TARGETED_REACHABILITY_K})"
    )
    
    # Timeout control
    parser.add_argument(
        "--metric-timeout-seconds",
        type=float,
        default=DEFAULT_METRIC_TIMEOUT_SECONDS,
        metavar="S",
        help=f"Wall-clock timeout per expensive-metric stage (default: {DEFAULT_METRIC_TIMEOUT_SECONDS})"
    )
    
    # Performance reporting
    parser.add_argument(
        "--performance-report",
        action="store_true",
        help="Include timing/memory info in metadata.performance"
    )
    
    # Verbosity control
    verbosity_group = parser.add_mutually_exclusive_group()
    verbosity_group.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Increase log verbosity (INFO level)"
    )
    verbosity_group.add_argument(
        "-q", "--quiet",
        action="store_true",
        help="Decrease log verbosity (ERROR only)"
    )
    
    return parser


def validate_args(args: argparse.Namespace) -> Tuple[bool, Optional[str]]:
    """
    Validate argument combinations and constraints.
    
    Returns:
        (is_valid, error_message): Tuple where is_valid is True if args are valid,
                                   and error_message is None or a descriptive error string.
    """
    # Check for negative values where not allowed
    if args.max_reachability_memory < 0:
        return False, "--max-reachability-memory must be non-negative"
    
    if args.targeted_reachability_k < 0:
        return False, "--targeted-reachability-k must be non-negative"
    
    if args.betweenness_samples < 0:
        return False, "--betweenness-samples must be non-negative"
    
    if args.metric_timeout_seconds < 0:
        return False, "--metric-timeout-seconds must be non-negative"
    
    # All other validations are handled by argparse itself
    return True, None


def parse_arguments(argv=None) -> Tuple[argparse.Namespace, int, Optional[str]]:
    """
    Parse command-line arguments with proper error handling.
    
    Args:
        argv: Command-line arguments (defaults to sys.argv[1:])
        
    Returns:
        Tuple of (parsed_args, exit_code, error_message)
        - On success: (args, 0, None)
        - On validation error: (None, 2, "error message")
        - On parse error: argparse exits with code 2
    """
    parser = create_parser()
    
    try:
        args = parser.parse_args(argv)
    except SystemExit as e:
        # argparse calls sys.exit on error; we let it through with code 2
        return argparse.Namespace(), 2, f"Invalid arguments: {e}"
    
    # Validate argument combinations
    is_valid, error_msg = validate_args(args)
    if not is_valid:
        return None, 2, error_msg
    
    # Apply precedence rules: --no-betweenness overrides --expensive-metrics
    if args.no_betweenness and args.expensive_metrics:
        # This is explicitly allowed per spec - --no-betweenness has highest precedence
        # We don't reject it, just note that betweenness will be disabled
        pass
    
    return args, 0, None


def run_extraction(args) -> int:
    """
    Run the full extraction pipeline.
    
    Returns:
        Exit code (0 for success, 1 for error)
    """
    from .logging_config import setup_logging
    from .bst_interface import run_bst_show, BstInterfaceError
    from .parser import parse_bst_show_output
    from .graph_builder import build_graph
    from .scc import compute_sccs
    from .metrics.cheap import compute_cheap_metrics
    from .metrics.reachability import compute_reachability
    from .metrics.betweenness import compute_betweenness
    from .metrics.articulation import compute_articulation_points
    from .metrics.critical_path import compute_critical_path
    from .combo_aggregator import compute_combo_aggregates
    from .styler import compute_styles
    from .layout import compute_layout, LayoutError, check_graphviz_available
    from .serializer import assemble_output, write_output_atomic
    
    # Setup logging based on verbosity flags
    from .logging_config import initialize_logging, get_logger
    initialize_logging(verbose=args.verbose, quiet=args.quiet)
    
    logger = get_logger("cli")
    
    # Track performance timing
    performance = {}
    start_total = time.time()
    
    try:
        # Stage 1: Run bst show (or read from file if it's a .txt fixture)
        logger.info(f"Running bst show for target: {args.TARGET}")
        stage_start = time.time()
        
        # Check if TARGET is a fixture file (.txt)
        import os
        if args.TARGET.endswith('.txt') and os.path.isfile(args.TARGET):
            # Read directly from fixture file
            with open(args.TARGET, 'r') as f:
                bst_output = f.read()
            logger.info(f"Read fixture from file: {args.TARGET}")
        else:
            # Run bst show normally
            try:
                bst_output = run_bst_show(args.TARGET)
            except BstInterfaceError as e:
                logger.error(f"Failed to run bst show: {e}")
                return 1
        
        performance["bst_show"] = time.time() - stage_start
        
        # Stage 2: Parse output
        logger.info("Parsing bst show output...")
        stage_start = time.time()
        nodes, edges = parse_bst_show_output(bst_output, show_invalid=args.show_invalid)
        performance["parsing"] = time.time() - stage_start
        logger.info(f"Parsed {len(nodes)} nodes and {len(edges)} edges")
        
        # Stage 3: Build graph
        logger.info("Building graph...")
        stage_start = time.time()
        G = build_graph(nodes, edges)
        performance["graph_building"] = time.time() - stage_start
        
        # Stage 4: Compute SCCs
        logger.info("Computing strongly connected components...")
        stage_start = time.time()
        is_cycle = compute_sccs(G)
        performance["scc"] = time.time() - stage_start
        
        # Stage 5: Compute cheap metrics
        logger.info("Computing cheap metrics...")
        stage_start = time.time()
        cheap_result = compute_cheap_metrics(G)
        node_metrics = cheap_result["node_metrics"]
        graph_stats = cheap_result["graph_stats"]
        performance["cheap_metrics"] = time.time() - stage_start
        
        # Stage 6: Compute reachability
        logger.info("Computing reachability...")
        stage_start = time.time()
        reach_mode = "disabled_by_user" if args.no_reachability else "auto"
        reach_result = compute_reachability(
            G,
            mode=reach_mode,
            max_memory_mb=args.max_reachability_memory,
            targeted_k=args.targeted_reachability_k
        )
        reachability_mode = reach_result["reachability_mode"]
        
        # Add reachability to node metrics
        ancestors = reach_result.get("ancestors", {}) or {}
        descendants = reach_result.get("descendants", {}) or {}
        for node_id in G.nodes():
            anc_set = ancestors.get(node_id)
            desc_set = descendants.get(node_id)
            if anc_set is not None and desc_set is not None:
                node_metrics[node_id]["blastRadius"] = len(desc_set)
                node_metrics[node_id]["ancestorCount"] = len(anc_set)
            else:
                node_metrics[node_id]["blastRadius"] = None
                node_metrics[node_id]["ancestorCount"] = None
        performance["reachability"] = time.time() - stage_start
        
        # Stage 7: Compute betweenness (if enabled)
        stage_start = time.time()
        if args.no_betweenness:
            logger.info("Betweenness disabled by user")
            betweenness_status = "disabled_by_user"
            betweenness_scores = None
        else:
            enable_exact = args.expensive_metrics
            betweenness_result = compute_betweenness(
                G,
                enable_exact=enable_exact,
                timeout_seconds=args.metric_timeout_seconds,
                sample_ratio=args.betweenness_samples / G.number_of_nodes() if G.number_of_nodes() > 0 else 0.01
            )
            betweenness_status = betweenness_result["status"]
            betweenness_scores = betweenness_result.get("node_scores")
            
            if betweenness_scores:
                for node_id, score in betweenness_scores.items():
                    node_metrics[node_id]["betweenness"] = score
        performance["betweenness"] = time.time() - stage_start
        
        # Stage 8: Compute articulation points
        stage_start = time.time()
        articulation_result = compute_articulation_points(
            G,
            timeout_seconds=args.metric_timeout_seconds
        )
        articulation_status = articulation_result["status"]
        articulation_points = articulation_result.get("articulation_points") or set()
        
        # Mark articulation points in node metrics
        for node_id in G.nodes():
            node_metrics[node_id]["isArticulation"] = node_id in articulation_points
        performance["articulation"] = time.time() - stage_start
        
        # Stage 9: Compute critical path
        logger.info("Computing critical path...")
        stage_start = time.time()
        cp_result = compute_critical_path(G, is_cycle)
        global_critical_path_length = cp_result["global_critical_path_length"]
        critical_edges = cp_result["critical_edges"]
        
        # Add critical path metrics to nodes
        for node_id, cp_metrics in cp_result["node_metrics"].items():
            node_metrics[node_id].update(cp_metrics)
        performance["critical_path"] = time.time() - stage_start
        
        # Stage 10: Aggregate combo metrics (placeholder for now)
        # TODO: Implement combo detection and aggregation
        combo_aggregates = {}
        combos = []
        
        # Stage 11: Compute styles
        logger.info("Computing visual styles...")
        stage_start = time.time()
        critical_nodes = {nid for nid, m in node_metrics.items() if m.get("isCritical", False)}
        edge_data = {(e[0], e[1]) for e in G.edges()}
        style_result = compute_styles(
            node_metrics,
            edge_data,
            critical_nodes,
            critical_edges,
            heatmap_active=False
        )
        
        # Merge styles into node/edge data
        for node_id, styles in style_result["node_styles"].items():
            node_metrics[node_id].update(styles)
        performance["styling"] = time.time() - stage_start
        
        # Stage 12: Compute layout if requested
        layout_precomputed = False
        layout_nodes = None
        if args.precompute_layout:
            logger.info("Computing layout with Graphviz...")
            stage_start = time.time()
            if not check_graphviz_available():
                logger.error("Graphviz not found. Install graphviz to use --precompute-layout.")
                return 1
            
            node_list = [{"id": n, "name": node_metrics[n].get("name", n)} for n in G.nodes()]
            edge_list = [{"source": e[0], "target": e[1], "depType": G.edges[e]["depType"]} for e in G.edges()]
            
            try:
                layout_nodes = compute_layout(node_list, edge_list)
                layout_precomputed = True
            except LayoutError as e:
                logger.error(f"Layout computation failed: {e}")
                return 1
            performance["layout"] = time.time() - stage_start
        
        # Stage 13: Assemble and write output
        logger.info("Assembling output...")
        stage_start = time.time()
        
        # Convert node_metrics to list format
        node_list_output = []
        for node in G.nodes():
            node_data = {
                "id": node,
                "kind": G.nodes[node].get("kind", "unknown"),
                "name": G.nodes[node].get("name", node),
                **node_metrics.get(node, {})
            }
            node_list_output.append(node_data)
        
        # Convert edges to output format
        edge_list_output = []
        for u, v in G.edges():
            edge_data = {
                "source": u,
                "target": v,
                "depType": G.edges[u, v].get("depType", "build")
            }
            # Add edge styling
            edge_key = (u, v)
            if edge_key in style_result["edge_styles"]:
                edge_data.update(style_result["edge_styles"][edge_key])
            edge_list_output.append(edge_data)
        
        output = assemble_output(
            nodes=node_list_output,
            edges=edge_list_output,
            node_metrics={},  # Already merged into nodes
            graph_stats=graph_stats,
            combo_aggregates=combo_aggregates if combo_aggregates else None,
            combos=combos if combos else None,
            performance=performance if args.performance_report else None,
            reachability_mode=reachability_mode,
            betweenness_status=betweenness_status,
            articulation_status=articulation_status,
            global_critical_path_length=global_critical_path_length,
            layout_precomputed=layout_precomputed,
            layout_nodes=layout_nodes
        )
        
        # Write output atomically
        write_output_atomic(output, args.output, validate=True)
        
        performance["total"] = time.time() - start_total
        logger.info(f"Extraction completed successfully in {performance['total']:.2f}s")
        logger.info(f"Output written to: {args.output}")
        
        return 0
        
    except Exception as e:
        logger.error(f"Unexpected error during extraction: {e}", exc_info=True)
        return 1


def main():
    """Main entry point for the CLI."""
    args, exit_code, error_msg = parse_arguments()
    
    if exit_code != 0:
        print(f"Error: {error_msg}", file=sys.stderr)
        sys.exit(exit_code)
    
    # Run the extraction pipeline
    result = run_extraction(args)
    sys.exit(result)


# Import logger after module-level imports to avoid circular dependency
def get_logger(name: str):
    from .logging_config import get_logger
    return get_logger(name)


if __name__ == "__main__":
    main()
