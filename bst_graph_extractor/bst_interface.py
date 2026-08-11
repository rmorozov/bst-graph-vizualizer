"""
bst_interface.py — subprocess boundary for `bst show`

This is the ONLY place where subprocess errors from bst-show are caught.
All failure modes (binary not found, non-zero exit, empty/garbled stdout)
are handled here and converted into ERROR logs + exit 1.

Exit codes:
  0 — success
  1 — fatal error (including bst interface failures)
  2 — invalid args (handled in cli.py)
"""

import subprocess
import sys
import logging

from .logging_config import get_logger

logger = get_logger("bst_interface")


class BstInterfaceError(Exception):
    """Raised when bst show invocation fails."""
    pass


def run_bst_show(target: str) -> str:
    """
    Run `bst show <target>` and return stdout as string.
    
    Raises:
        BstInterfaceError: on any failure (binary not found, non-zero exit, etc.)
    """
    cmd = ["bst", "show", target]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout for bst show itself
        )
    except FileNotFoundError:
        logger.error(f"Binary 'bst' not found. Is BuildStream installed and in PATH?")
        raise BstInterfaceError("bst binary not found")
    except subprocess.TimeoutExpired:
        logger.error(f"bst show timed out after 300s for target: {target}")
        raise BstInterfaceError("bst show timed out")
    except Exception as e:
        logger.error(f"Unexpected error running bst show: {e}")
        raise BstInterfaceError(f"bst show failed: {e}")
    
    if result.returncode != 0:
        stderr_tail = result.stderr[-500:] if len(result.stderr) > 500 else result.stderr
        logger.error(f"bst show exited with code {result.returncode}. stderr: {stderr_tail}")
        raise BstInterfaceError(f"bst show exited with code {result.returncode}")
    
    # Distinguish empty graph (legitimate) from empty/garbled output (error)
    if result.stdout == "":
        logger.error("bst show returned empty stdout (no elements found or garbled output)")
        raise BstInterfaceError("bst show returned empty stdout")
    
    return result.stdout
