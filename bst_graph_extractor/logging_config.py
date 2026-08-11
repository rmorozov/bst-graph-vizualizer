"""
Logging Configuration for BuildStream Graph Extractor

Implements the logging convention from T0.3:
- Format: `LEVEL [stage] message` for Python stderr
- Stage/module names match those used in JS ring buffer for cross-tool diagnosability
"""

import logging
import sys
from typing import Optional


# Fixed set of stage/module names used across both tools
# These must match the names referenced in spec §3.5/§4.11 and perf/logger.js
STAGE_NAMES = {
    "cli": "cli",
    "bst_interface": "bst_interface",
    "parser": "parser",
    "graph_builder": "graph_builder",
    "scc": "scc",
    "reachability": "reachability",
    "betweenness": "betweenness",
    "articulation": "articulation",
    "critical_path": "critical_path",
    "combo_aggregator": "combo_aggregator",
    "layout": "layout",
    "styler": "styler",
    "serializer": "serializer",
    "metrics": "metrics",
    "timeout_guard": "timeout_guard",
}


class LoggingConfig:
    """
    Configures logging for the extractor with -v/-q wiring.
    
    Log format: LEVEL [stage] message
    -v: adds INFO stage-timing lines
    -q: suppresses everything except ERROR
    Default: WARNING and above
    """
    
    def __init__(self, verbose: bool = False, quiet: bool = False):
        self.verbose = verbose
        self.quiet = quiet
        self._configure()
    
    def _configure(self):
        """Configure root logger with appropriate level and formatter."""
        # Determine log level based on flags
        if self.quiet:
            level = logging.ERROR
        elif self.verbose:
            level = logging.INFO
        else:
            level = logging.WARNING
        
        # Configure root logger
        root_logger = logging.getLogger()
        root_logger.setLevel(level)
        
        # Remove any existing handlers
        root_logger.handlers.clear()
        
        # Create console handler
        handler = logging.StreamHandler(sys.stderr)
        handler.setLevel(level)
        
        # Set formatter: LEVEL [stage] message
        formatter = logging.Formatter('%(levelname)s [%(name)s] %(message)s')
        handler.setFormatter(formatter)
        
        root_logger.addHandler(handler)
    
    def get_logger(self, stage: str) -> logging.Logger:
        """
        Get a logger for a specific stage/module.
        
        Args:
            stage: One of the predefined stage names from STAGE_NAMES
            
        Returns:
            Configured logger instance
        """
        if stage not in STAGE_NAMES:
            raise ValueError(f"Unknown stage: {stage}. Valid: {list(STAGE_NAMES.keys())}")
        
        return logging.getLogger(stage)


def setup_logging(verbose: bool = False, quiet: bool = False) -> LoggingConfig:
    """
    Initialize logging configuration.
    
    Args:
        verbose: Enable INFO-level output (-v flag)
        quiet: Suppress all but ERROR output (-q flag)
        
    Returns:
        LoggingConfig instance for retrieving stage-specific loggers
    """
    config = LoggingConfig(verbose=verbose, quiet=quiet)
    return config


def stage_start(logger: logging.Logger, stage: str, start_time: float = 0.0):
    """Log an INFO-level stage-start message with optional timing."""
    if start_time > 0:
        logger.info(f"Starting {stage}...")
    else:
        logger.info(f"Starting {stage}")


def stage_complete(logger: logging.Logger, stage: str, duration_ms: float):
    """Log an INFO-level stage-complete message with timing."""
    logger.info(f"Completed {stage} in {duration_ms:.2f}ms")


def stage_warning(logger: logging.Logger, message: str):
    """Log a WARNING-level message for metric degradation or fallback."""
    logger.warning(message)


def stage_error(logger: logging.Logger, message: str):
    """Log an ERROR-level message for fatal errors."""
    logger.error(message)
