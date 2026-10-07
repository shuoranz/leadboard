"""Runs the whole local stack: the API, the four fakes, and (optionally) the Vite dev server.

    .venv/bin/python scripts/dev.py            # backend + fakes + vite on :5176
    .venv/bin/python scripts/dev.py --no-web   # backend + fakes only

Ctrl-C stops everything. TIME_SCALE (default 0.1) compresses load tests: a 5-minute test takes 30 s.
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable

SERVICES = [
    ("db", "benchmark_fakes.db.app:app", 8101),
    ("blazemeter", "benchmark_fakes.blazemeter.app:app", 8102),
    ("splunk", "benchmark_fakes.splunk.app:app", 8103),
    ("target", "benchmark_fakes.target_service.app:app", 8104),
    ("api", "app_benchmark.main:app", 8000),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-web", action="store_true", help="don't start the Vite dev server")
    ap.add_argument("--reload", action="store_true", help="restart Python services on code changes")
    args = ap.parse_args()

    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    env.setdefault("TIME_SCALE", "0.1")
    procs: list[tuple[str, subprocess.Popen]] = []
    for name, target, port in SERVICES:
        cmd = [PY, "-m", "uvicorn", target, "--port", str(port), "--log-level", "warning"]
        if args.reload:
            cmd += ["--reload", "--reload-dir", str(ROOT / "src")]
        procs.append((name, subprocess.Popen(cmd, cwd=ROOT, env=env)))
        print(f"  {name:<11} http://127.0.0.1:{port}")
        if name == "db":
            time.sleep(0.8)  # seeded first, so the API's resume() finds it
    if not args.no_web:
        web_env = {**env, "VITE_API_PROXY": "http://127.0.0.1:8000"}
        procs.append(("web", subprocess.Popen(["npm", "run", "dev"], cwd=ROOT / "frontend", env=web_env)))
        print("  web         http://localhost:5176  (proxies /api to :8000)")

    def stop(*_):
        for _, p in procs:
            if p.poll() is None:
                p.send_signal(signal.SIGINT)
        for _, p in procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    while True:
        for name, p in procs:
            if p.poll() is not None:
                print(f"{name} exited with {p.returncode}; stopping the stack", file=sys.stderr)
                stop()
        time.sleep(0.5)


if __name__ == "__main__":
    main()
