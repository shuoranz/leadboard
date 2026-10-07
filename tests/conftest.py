"""Runs the whole system in one event loop: the API plus all four fakes over in-process ASGI
transports, against a throwaway copy of fake_data/ with time compressed ~200x."""

import shutil
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from app_benchmark.main import create_app
from app_benchmark.settings import Settings
from benchmark_fakes.blazemeter import app as bm_mod
from benchmark_fakes.common import http
from benchmark_fakes.db import app as db_mod
from benchmark_fakes.splunk import app as splunk_mod
from benchmark_fakes.target_service import app as target_mod

REPO = Path(__file__).resolve().parents[1]
SPLUNK_HEC = "http://127.0.0.1:8103"
TARGET = "http://127.0.0.1:8104"


def _reset_fakes() -> None:
    db_mod._cache.clear()
    db_mod._seeded = False
    bm_mod._tests.clear()
    bm_mod._masters.clear()
    bm_mod._tasks.clear()
    bm_mod._loaded = False
    splunk_mod._jobs.clear()
    target_mod._rngs.clear()
    target_mod._buffer.clear()


@pytest.fixture
def fake_data(tmp_path, monkeypatch) -> Path:
    dest = tmp_path / "fake_data"
    shutil.copytree(REPO / "fake_data", dest, ignore=shutil.ignore_patterns("db", "state", "events"))
    monkeypatch.setenv("FAKE_DATA_DIR", str(dest))
    monkeypatch.setenv("TIME_SCALE", "0.005")
    monkeypatch.setenv("HEC_FLUSH_S", "0")
    monkeypatch.setenv("SPLUNK_JOB_DELAY_S", "0.02")
    _reset_fakes()
    return dest


def asgi(app) -> httpx.ASGITransport:
    return httpx.ASGITransport(app=app)


@pytest.fixture
def fake_clients(fake_data):
    """Direct clients for each fake."""
    return SimpleNamespace(
        db=httpx.AsyncClient(transport=asgi(db_mod.app), base_url="http://db"),
        bm=httpx.AsyncClient(transport=asgi(bm_mod.app), base_url="http://bm", auth=("id", "secret")),
        splunk=httpx.AsyncClient(transport=asgi(splunk_mod.app), base_url="http://splunk"),
        target=httpx.AsyncClient(transport=asgi(target_mod.app), base_url=TARGET),
    )


@pytest.fixture
async def system(fake_data):
    http.override(SPLUNK_HEC, asgi(splunk_mod.app))
    http.override(TARGET, asgi(target_mod.app))
    settings = Settings(poll_interval_s=0.01, splunk_poll_interval_s=0.01, serve_static=False, _env_file=None)
    app = create_app(
        settings,
        transports={"db": asgi(db_mod.app), "blazemeter": asgi(bm_mod.app), "splunk": asgi(splunk_mod.app)},
    )
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=asgi(app), base_url="http://api") as client:
        yield SimpleNamespace(app=app, client=client, orchestrator=app.state.container.orchestrator, data=fake_data)
    http.override(SPLUNK_HEC, None)
    http.override(TARGET, None)
