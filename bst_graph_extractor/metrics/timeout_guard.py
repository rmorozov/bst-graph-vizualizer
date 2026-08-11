"""
metrics/timeout_guard.py — shared timeout wrapper for expensive metrics

Provides a wall-clock timeout decorator/guard for betweenness and articulation
computations. When timeout is exceeded, the computation is aborted and returns
a "disabled_timeout" status.
"""

import time
import signal
from typing import Callable, Any, Optional, Tuple
from functools import wraps

from ..logging_config import get_logger

logger = get_logger("timeout_guard")


class TimeoutError(Exception):
    """Raised when a computation exceeds its time budget."""
    pass


def timeout_handler(signum, frame):
    """Signal handler for timeout."""
    raise TimeoutError("Computation timed out")


def with_timeout(timeout_seconds: float):
    """
    Decorator that applies a wall-clock timeout to a function.
    
    Args:
        timeout_seconds: Maximum execution time in seconds
        
    Returns:
        Decorated function that raises TimeoutError on timeout
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            # Set up signal handler (Unix only)
            old_handler = signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(int(timeout_seconds))
            
            try:
                result = func(*args, **kwargs)
            finally:
                # Restore old handler and cancel alarm
                signal.alarm(0)
                signal.signal(signal.SIGALRM, old_handler)
            
            return result
        return wrapper
    return decorator


def run_with_timeout(
    func: Callable,
    args: tuple = (),
    kwargs: dict = None,
    timeout_seconds: float = 60.0,
    fallback_value: Any = None
) -> Tuple[bool, Any]:
    """
    Run a function with a timeout, returning success flag and result/fallback.
    
    Args:
        func: Function to run
        args: Positional arguments for func
        kwargs: Keyword arguments for func
        timeout_seconds: Maximum execution time
        fallback_value: Value to return on timeout
        
    Returns:
        Tuple of (success: bool, result_or_fallback)
        - success=True: computation completed, result is valid
        - success=False: timeout occurred, fallback_value returned
    """
    if kwargs is None:
        kwargs = {}
    
    old_handler = signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(int(timeout_seconds))
    
    try:
        result = func(*args, **kwargs)
        success = True
    except TimeoutError:
        logger.warning(f"Computation timed out after {timeout_seconds}s")
        result = fallback_value
        success = False
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)
    
    return success, result
