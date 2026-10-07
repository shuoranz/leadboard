"""Where the fakes read and write their JSON files.

Everything lives under one directory (``FAKE_DATA_DIR``, default ``<repo>/fake_data``) so a test
can point all four fakes at a throwaway copy.
"""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def data_dir() -> Path:
    return Path(os.environ.get("FAKE_DATA_DIR", REPO_ROOT / "fake_data")).resolve()


def time_scale() -> float:
    """Real seconds per nominal second of load test. 0.1 runs a 5-minute test in 30 s."""
    return float(os.environ.get("TIME_SCALE", "0.1"))
