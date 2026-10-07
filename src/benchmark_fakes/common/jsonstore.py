"""Small helpers for JSON files on disk: atomic writes and JSON-lines appends."""

import json
import os
import threading
from pathlib import Path
from typing import Any

_locks: dict[Path, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock(path: Path) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(path.resolve(), threading.Lock())


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def write_json(path: Path, data: Any) -> None:
    """Write via a temp file + rename, so a crash never leaves half a file behind."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock(path):
        tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps(data, indent=2, default=str) + "\n")
        os.replace(tmp, path)


def append_jsonl(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock(path), path.open("a") as f:
        for row in rows:
            f.write(json.dumps(row, separators=(",", ":"), default=str) + "\n")


def read_jsonl(path: Path) -> list[dict]:
    try:
        with path.open() as f:
            return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        return []
