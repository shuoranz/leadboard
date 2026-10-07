"""Refreshes the frontend's fixtures from the real API (backed by the fakes, run in-process):

* frontend/mock/fixtures/leaderboards.json — every service × load profile (plus each service's default),
  for the Vite mock
  (which reads runs, results and the catalog straight from fake_data/seed/).
* frontend/src/test/contract/*.json — one real response per endpoint, which Vitest parses with
  the zod schemas, so the two sides of the contract can't drift apart unnoticed.

It also runs one short fixed batch and one auto run, so the contract samples include a live run.

    .venv/bin/python scripts/snapshot_fixtures.py
"""

import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
tmp = Path(tempfile.mkdtemp()) / "fake_data"
shutil.copytree(ROOT / "fake_data", tmp, ignore=shutil.ignore_patterns("db", "state", "events"))
os.environ.update(FAKE_DATA_DIR=str(tmp), TIME_SCALE="0.003", HEC_FLUSH_S="0", SPLUNK_JOB_DELAY_S="0.01")

import httpx  # noqa: E402

from app_benchmark.main import create_app  # noqa: E402
from app_benchmark.settings import Settings  # noqa: E402
from benchmark_fakes.blazemeter.app import app as bm  # noqa: E402
from benchmark_fakes.common import http  # noqa: E402
from benchmark_fakes.db.app import app as db  # noqa: E402
from benchmark_fakes.splunk.app import app as splunk  # noqa: E402
from benchmark_fakes.target_service.app import app as target  # noqa: E402

MOCK = ROOT / "frontend" / "mock" / "fixtures"
CONTRACT = ROOT / "frontend" / "src" / "test" / "contract"


def asgi(app):
    return httpx.ASGITransport(app=app)


def dump(path: Path, data, compact=False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text((json.dumps(data, separators=(",", ":")) if compact else json.dumps(data, indent=2)) + "\n")


async def main() -> None:
    http.override("http://127.0.0.1:8103", asgi(splunk))
    http.override("http://127.0.0.1:8104", asgi(target))
    app = create_app(
        Settings(poll_interval_s=0.01, splunk_poll_interval_s=0.01, serve_static=False, _env_file=None),
        transports={"db": asgi(db), "blazemeter": asgi(bm), "splunk": asgi(splunk)},
    )
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=asgi(app), base_url="http://api") as api:

        async def get(path, **params):
            res = await api.get(f"/api{path}", params=params)
            res.raise_for_status()
            return res.json()

        services = await get("/services")
        profiles = await get("/load-profiles")
        boards = {}
        for s in services:
            # Bare service id = the backend's default profile choice.
            boards[s["id"]] = await get(f"/services/{s['id']}/leaderboard")
            for prof in profiles:
                boards[f"{s['id']}:{prof['id']}"] = await get(f"/services/{s['id']}/leaderboard", profile=prof["id"])
        dump(MOCK / "leaderboards.json", boards, compact=True)

        # A live batch + auto run, so the samples include fresh runs straight from the orchestrator.
        load = {"concurrency": 3, "ramp_up_s": 5, "duration_s": 30, "think_time_s": 1}
        fixed = (
            await api.post(
                "/api/runs",
                json={"service_id": "summarize-profile", "load": load, "routing": {"mode": "fixed", "offering_ids": ["stratus--aurora-4"]}},
            )
        ).json()
        auto = (await api.post("/api/runs", json={"service_id": "summarize-profile", "load": load, "routing": {"mode": "auto"}})).json()
        await asyncio.wait_for(app.state.container.orchestrator.idle(), 60)

        dump(CONTRACT / "services.json", services)
        dump(CONTRACT / "catalog.json", await get("/catalog"))
        dump(CONTRACT / "load_profiles.json", profiles)
        dump(CONTRACT / "runs.json", await get("/runs", service_id="summarize-profile", limit=5))
        dump(CONTRACT / "run.json", await get(f"/runs/{fixed[0]['id']}"))
        dump(CONTRACT / "results_fixed.json", await get(f"/runs/{fixed[0]['id']}/results"))
        dump(CONTRACT / "results_auto.json", await get(f"/runs/{auto[0]['id']}/results"))
        dump(CONTRACT / "leaderboard.json", boards["summarize-profile:baseline"])
    print(f"{len(boards)} leaderboards -> {MOCK.relative_to(ROOT)}; contract samples -> {CONTRACT.relative_to(ROOT)}")


asyncio.run(main())
