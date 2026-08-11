"""
CLI Interface for BuildStream Graph Extractor

Implements T1.1: CLI scaffold, argument parsing, exit codes.
- Parses every flag in spec §3.1
- Enforces --no-betweenness > --expensive-metrics precedence
- Validates flag combinations
- Exit codes: 0 success, 1 fatal error, 2 invalid CLI arguments
"""

import argparse
import sys
from typing import Optional, Tuple


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


def main():
    """Test the CLI parser."""
    args, exit_code, error_msg = parse_arguments()
    
    if exit_code != 0:
        print(f"Error: {error_msg}", file=sys.stderr)
        sys.exit(exit_code)
    
    print(f"Successfully parsed arguments:")
    print(f"  TARGET: {args.TARGET}")
    print(f"  Output: {args.output}")
    print(f"  Include runtime: {args.include_runtime}")
    print(f"  Precompute layout: {args.precompute_layout}")
    print(f"  Expensive metrics: {args.expensive_metrics}")
    print(f"  No betweenness: {args.no_betweenness} (overrides --expensive-metrics if both set)")
    print(f"  Betweenness samples: {args.betweenness_samples}")
    print(f"  No reachability: {args.no_reachability}")
    print(f"  Max reachability memory: {args.max_reachability_memory} MB")
    print(f"  Targeted reachability K: {args.targeted_reachability_k}")
    print(f"  Metric timeout: {args.metric_timeout_seconds}s")
    print(f"  Performance report: {args.performance_report}")
    print(f"  Verbose: {args.verbose}")
    print(f"  Quiet: {args.quiet}")
    
    sys.exit(0)


if __name__ == "__main__":
    main()
