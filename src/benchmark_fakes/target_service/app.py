"""The black-box LLM API services under test (e.g. "Summarize Profile API").

    POST /svc/{service_id}/invoke

BlazeMeter calls this like any client would. Routing headers choose the model:

    X-Run-Id          correlation id, copied into every log event
    X-Routing         "fixed" (default) or "auto"
    X-Offering-Id     fixed routing: the provider--llm offering to call
    X-Model-Pool      auto routing: comma-separated offering ids (default: every usable offering)
    X-Sim-Concurrency simulation hint: active virtual users, which drives load degradation

The service answers immediately with simulated timings (the load engine waits them out in
scaled time) and ships one log event per request to Splunk HEC, batched. Its behaviour comes
entirely from fake_data/profiles/*.json and the seed catalog.
"""

import asyncio
import contextlib
import json
import os
import random
import time
import uuid
from typing import Any

from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse

from ..common import http
from ..common.jsonstore import read_json
from ..common.latency import pick_offering, simulate_request
from ..common.paths import data_dir

app = FastAPI(title="Fake target services", version="1.0")

#: One RNG per run id, most recently used last; old runs are dropped.
_rngs: dict[str, random.Random] = {}
MAX_RUN_RNGS = 64
_config_cache: tuple[tuple, dict[str, Any]] | None = None
_buffer: list[dict[str, Any]] = []
_last_flush = 0.0
_flusher: asyncio.Task | None = None


def _hec_url() -> str:
    return os.environ.get("SPLUNK_HEC_URL", "http://127.0.0.1:8103")


def _flush_interval() -> float:
    return float(os.environ.get("HEC_FLUSH_S", "0.25"))


def _config() -> dict[str, Any]:
    """The JSON the service runs on, re-read only when a file changes (so edits still apply live)."""
    global _config_cache
    d = data_dir()
    files = {
        "offerings": d / "seed" / "offerings.json",
        "services": d / "seed" / "services.json",
        "profiles": d / "profiles" / "offering_profiles.json",
        "traffic": d / "profiles" / "service_profiles.json",
    }
    stamp = tuple((str(f), f.stat().st_mtime_ns if f.exists() else None) for f in files.values())
    if _config_cache is None or _config_cache[0] != stamp:
        cfg = {
            "offerings": {o["id"]: o for o in read_json(files["offerings"], [])},
            "services": {s["id"]: s for s in read_json(files["services"], [])},
            "profiles": read_json(files["profiles"], {}),
            "traffic": read_json(files["traffic"], {}).get("services", {}),
        }
        _config_cache = (stamp, cfg)
    return _config_cache[1]


def _rng(run_id: str) -> random.Random:
    """A run's RNG (seeded by its id, so runs are reproducible), keeping only the latest few runs'."""
    rng = _rngs.pop(run_id, None) or random.Random(run_id)
    _rngs[run_id] = rng
    while len(_rngs) > MAX_RUN_RNGS:
        del _rngs[next(iter(_rngs))]
    return rng


def _pool(cfg: dict, service: dict) -> list[str]:
    allowed = service.get("allowed_offering_ids") or list(cfg["offerings"])
    return [o for o in allowed if cfg["offerings"].get(o, {}).get("status") != "unavailable"]


async def flush() -> None:
    global _last_flush
    if not _buffer:
        return
    batch = _buffer[:]
    _buffer.clear()
    _last_flush = time.monotonic()
    body = "\n".join(json.dumps(e, separators=(",", ":")) for e in batch)
    # Logging must never break the service. Real services drop logs too.
    with contextlib.suppress(Exception):
        await http.client(_hec_url()).post("/services/collector/event", content=body, headers={"Authorization": "Splunk fake-hec-token"})


async def _flush_loop() -> None:
    while True:
        await asyncio.sleep(max(0.05, _flush_interval()))
        await flush()


def _ensure_flusher() -> None:
    global _flusher
    if _flusher is None or _flusher.done() or _flusher.get_loop() is not asyncio.get_running_loop():
        _flusher = asyncio.get_running_loop().create_task(_flush_loop())


@app.post("/svc/{service_id}/invoke")
async def invoke(
    service_id: str,
    x_run_id: str | None = Header(None),
    x_routing: str = Header("fixed"),
    x_offering_id: str | None = Header(None),
    x_model_pool: str | None = Header(None),
    x_sim_concurrency: int = Header(1),
):
    cfg = _config()
    service = cfg["services"].get(service_id)
    if not service:
        return JSONResponse({"error": f"unknown service {service_id}"}, status_code=404)
    run_id = x_run_id or "adhoc"
    rng = _rng(run_id)

    if x_routing == "auto":
        pool = [p for p in (x_model_pool or "").split(",") if p] or _pool(cfg, service)
        pool = [p for p in pool if p in cfg["offerings"]]
        if not pool:
            return JSONResponse({"error": "auto routing pool is empty"}, status_code=400)
        offering_id = pick_offering(pool, rng)
    else:
        offering_id = x_offering_id or ""
        if offering_id not in cfg["offerings"]:
            return JSONResponse({"error": f"unknown offering {offering_id!r}"}, status_code=400)

    offering = cfg["offerings"][offering_id]
    traffic = cfg["traffic"].get(service_id) or next(iter(cfg["traffic"].values()))
    defaults = cfg["profiles"]["defaults"]
    sim = simulate_request(cfg["profiles"]["offerings"][offering_id], traffic, defaults, max(1, x_sim_concurrency), rng)
    if offering["status"] == "unavailable":
        sim.update(
            status="error",
            error_type="server_error",
            http_status=503,
            ttft_ms=None,
            itl_ms=None,
            max_itl_gap_ms=None,
            decode_tps=None,
            output_tokens=0,
            finish_reason="error",
            e2e_ms=40.0,
        )

    request_id = uuid.uuid4().hex[:16]
    event = {
        "run_id": run_id,
        "request_id": request_id,
        "service_id": service_id,
        "routing": "auto" if x_routing == "auto" else "fixed",
        "offering_id": offering_id,
        "provider": offering["provider_id"],
        "llm": offering["llm_id"],
        "concurrency": x_sim_concurrency,
        **sim,
    }
    _buffer.append(
        {
            "time": round(time.time(), 3),
            "host": f"{service_id}-pod-{rng.randint(1, 4)}",
            "source": f"{service_id}:{service['endpoint_path']}",
            "sourcetype": "llm_api:request",
            "index": "llm_api",
            "event": event,
        }
    )
    _ensure_flusher()
    if _flush_interval() <= 0 or time.monotonic() - _last_flush > _flush_interval() or len(_buffer) >= 200:
        await flush()

    body: dict[str, Any] = {
        "request_id": request_id,
        "model": {"provider": offering["provider_id"], "llm": offering["llm_id"], "offering_id": offering_id},
        "usage": {"input_tokens": sim["input_tokens"], "output_tokens": sim["output_tokens"]},
        "timing": {"ttft_ms": sim["ttft_ms"], "e2e_ms": sim["e2e_ms"]},
    }
    if sim["status"] == "ok":
        body["output"] = f"Simulated {service['name']} response from {offering['llm_id']} via {offering['provider_id']}."
        body["finish_reason"] = sim["finish_reason"]
    else:
        body["error"] = {"type": sim["error_type"]}
    return JSONResponse(body, status_code=sim["http_status"])


@app.post("/admin/flush")
async def admin_flush() -> dict:
    n = len(_buffer)
    await flush()
    return {"flushed": n}


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "buffered": len(_buffer)}
