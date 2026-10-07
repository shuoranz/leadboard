"""Fake BlazeMeter: the slice of the v4 REST API this project uses, plus a load engine.

    POST /api/v4/tests                                   create a test
    POST /api/v4/tests/{test_id}/start                   -> master (one execution)
    GET  /api/v4/masters/{master_id}/status              CREATED -> INIT_SCRIPT -> RUNNING -> ENDED
    POST /api/v4/masters/{master_id}/stop
    GET  /api/v4/masters/{master_id}/reports/default/summary
    GET  /api/v4/masters/{master_id}/reports/timeline/kpis
    GET  /app/masters/{master_id}                        a bare HTML report (for "view in BlazeMeter" links)

Test body (subset of the real shape):

    {"name": "...", "projectId": "...",
     "configuration": {"type": "http", "targetUrl": "http://.../invoke", "headers": {...}},
     "overrideExecutions": [{"concurrency": 20, "rampUp": "30s", "holdFor": "4m30s", "thinkTime": 2}]}

The engine runs virtual users in *nominal* time: real time = nominal x TIME_SCALE. Each VU calls
the target, waits out the response time it reports (scaled), thinks, and repeats. Responses are
rendered from the JSON templates in fake_data/blazemeter/; tests and finished masters persist in
fake_data/blazemeter/state/.
"""

import asyncio
import html
import math
import os
import random
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from ..common import http
from ..common.jsonstore import read_json, write_json
from ..common.paths import data_dir, time_scale
from ..common.templates import render

app = FastAPI(title="Fake BlazeMeter", version="4.0")

DURATION = re.compile(r"(\d+(?:\.\d+)?)\s*(h|m|s)?")


def parse_duration(value: Any) -> float:
    """Seconds from 90, "90", "90s", "5m" or "1m30s"."""
    if isinstance(value, int | float):
        return float(value)
    total = 0.0
    for num, unit in DURATION.findall(str(value)):
        total += float(num) * {"h": 3600, "m": 60, "s": 1, "": 1}[unit]
    return total


def _public_url() -> str:
    return os.environ.get("BLAZEMETER_PUBLIC_URL", "http://127.0.0.1:8102")


def _state_path(name: str):
    return data_dir() / "blazemeter" / "state" / f"{name}.json"


def _rid() -> str:
    return uuid.uuid4().hex[:12]


def _error(status: int, code: int, message: str) -> JSONResponse:
    return JSONResponse(render("blazemeter", "error", code=code, message=message, request_id=_rid()), status_code=status)


@dataclass
class Master:
    id: int
    test_id: int
    name: str
    created: int
    concurrency: int
    ramp_up: float
    hold_for: float
    think_time: float
    target_url: str
    headers: dict[str, str]
    status: str = "CREATED"
    started: int | None = None
    ended: int | None = None
    aborted: bool = False
    samples: list[tuple[float, float, bool, int]] = field(default_factory=list)  # (t, rt_ms, ok, code)
    active: int = 0
    t0: float = 0.0
    stop: bool = False
    report: dict[str, Any] | None = None

    @property
    def total(self) -> float:
        return self.ramp_up + self.hold_for

    def nominal_now(self) -> float:
        return 0.0 if not self.t0 else (time.monotonic() - self.t0) / max(time_scale(), 1e-6)

    def progress(self) -> int:
        if self.status == "ENDED":
            return 100
        return min(99, int(self.nominal_now() / self.total * 100)) if self.total else 0

    def to_state(self) -> dict[str, Any]:
        keep = (
            "id",
            "test_id",
            "name",
            "created",
            "concurrency",
            "ramp_up",
            "hold_for",
            "think_time",
            "target_url",
            "status",
            "started",
            "ended",
            "aborted",
            "report",
        )
        return {k: getattr(self, k) for k in keep}


_tests: dict[int, dict[str, Any]] = {}
_masters: dict[int, Master] = {}
_tasks: dict[int, asyncio.Task] = {}
_loaded = False


def _load_state() -> None:
    """Restore tests and finished masters. A master that was mid-run when the process died ended then."""
    global _loaded
    if _loaded:
        return
    _loaded = True
    for t in read_json(_state_path("tests"), []):
        _tests[t["id"]] = t
    for m in read_json(_state_path("masters"), []):
        master = Master(**{k: v for k, v in m.items() if k in Master.__dataclass_fields__}, headers={})
        if master.status != "ENDED":
            master.status, master.aborted = "ENDED", True
            master.ended = master.ended or int(time.time())
            master.report = master.report or _report(master)
        _masters[master.id] = master


def _save_state() -> None:
    write_json(_state_path("tests"), list(_tests.values()))
    write_json(_state_path("masters"), [m.to_state() for m in _masters.values()])


def _next_id(existing) -> int:
    return max([*existing, 10_000_000]) + random.randint(1, 97)


def _pct(sorted_values: list[float], p: float) -> float | None:
    if not sorted_values:
        return None
    k = (len(sorted_values) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return round(sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (k - lo), 1)


def _report(m: Master) -> dict[str, Any]:
    """Aggregate + timeline, computed once when the master ends."""
    samples = m.samples
    rts = sorted(s[1] for s in samples)
    failed = sum(1 for s in samples if not s[2])
    duration = max((s[0] for s in samples), default=0.0) or m.total
    codes: dict[str, int] = {}
    for s in samples:
        if not s[2]:
            codes[str(s[3])] = codes.get(str(s[3]), 0) + 1
    summary = {
        "hits": len(samples),
        "failed": failed,
        "avg": round(sum(rts) / len(rts), 1) if rts else None,
        "min": rts[0] if rts else None,
        "max": rts[-1] if rts else None,
        "tp50": _pct(rts, 0.5),
        "tp90": _pct(rts, 0.9),
        "tp95": _pct(rts, 0.95),
        "tp99": _pct(rts, 0.99),
        "hits_avg": round(len(samples) / duration, 3) if duration else None,
        "failed_avg": round(failed / duration, 4) if duration else None,
        "max_users": m.concurrency,
        "duration": round(duration, 1),
        "first": m.started,
        "last": m.ended,
        "errors_by_code": codes,
    }
    interval = max(5, round(m.total / 60 / 5) * 5) if m.total else 5
    buckets: dict[int, list[tuple]] = {}
    for s in samples:
        buckets.setdefault(int(s[0] // interval), []).append(s)
    points = []
    for b in range(int(math.ceil(duration / interval)) or 0):
        rows = buckets.get(b, [])
        brts = sorted(r[1] for r in rows)
        t_mid = (b + 0.5) * interval
        points.append(
            {
                "ts": round(b * interval),
                "na": min(m.concurrency, math.ceil(m.concurrency * min(1.0, t_mid / m.ramp_up))) if m.ramp_up else m.concurrency,
                "n": len(rows),
                "ec": sum(1 for r in rows if not r[2]),
                "t": round(sum(brts) / len(brts), 1) if brts else None,
                "t90": _pct(brts, 0.9),
            }
        )
    return {"summary": summary, "timeline": {"interval": interval, "points": points}}


async def _vu(m: Master, client: httpx.AsyncClient, path: str, rng: random.Random) -> None:
    scale = max(time_scale(), 1e-6)
    while not m.stop and m.nominal_now() < m.total:
        sent_at = m.nominal_now()
        headers = {**m.headers, "X-Sim-Concurrency": str(m.active)}
        try:
            res = await client.post(path, json={"input": {"member_id": rng.randint(1, 10**8)}}, headers=headers)
            data = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
            server_ms = float((data.get("timing") or {}).get("e2e_ms") or 0.0)
            ok = res.is_success and "error" not in data
            code = res.status_code
        except Exception:
            server_ms, ok, code = 0.0, False, 599
        # Client view = server time + network round trip + TLS/gateway jitter.
        rt = server_ms + rng.uniform(25, 70) + rng.expovariate(1 / 15)
        m.samples.append((round(sent_at, 3), round(rt, 1), ok, code))
        think = m.think_time * rng.uniform(0.7, 1.3)
        await asyncio.sleep((rt / 1000 + think) * scale)


async def _run(m: Master) -> None:
    url = httpx.URL(m.target_url)
    base = f"{url.scheme}://{url.netloc.decode()}"
    client = http.client(base)
    rng = random.Random(m.id)
    m.status = "INIT_SCRIPT"
    await asyncio.sleep(2 * max(time_scale(), 1e-6))  # engines spinning up
    m.status, m.started, m.t0 = "RUNNING", int(time.time()), time.monotonic()
    vus: list[asyncio.Task] = []
    try:
        while not m.stop and m.nominal_now() < m.total:
            t = m.nominal_now()
            target = m.concurrency if not m.ramp_up else min(m.concurrency, math.ceil(m.concurrency * t / m.ramp_up))
            while len(vus) < target:
                vus.append(asyncio.create_task(_vu(m, client, url.raw_path.decode(), random.Random(rng.random()))))
            m.active = len(vus)
            await asyncio.sleep(max(time_scale(), 1e-6))  # re-check the ramp every nominal second
        await asyncio.gather(*vus, return_exceptions=True)
    finally:
        for v in vus:
            v.cancel()
        m.active = 0
        m.ended = int(time.time())
        m.report = _report(m)
        m.status = "ENDED"
        _save_state()


def _auth_ok(request: Request) -> bool:
    return bool(request.headers.get("authorization") or request.headers.get("x-api-key"))


@app.middleware("http")
async def require_auth(request: Request, call_next):
    if request.url.path.startswith("/api/") and not _auth_ok(request):
        return _error(401, 401, "Missing credentials (use Basic auth with an API key id/secret)")
    _load_state()
    return await call_next(request)


@app.post("/api/v4/tests", status_code=201)
async def create_test(request: Request):
    body = await request.json()
    cfg = body.get("configuration") or {}
    execs = body.get("overrideExecutions") or []
    if not cfg.get("targetUrl") or not execs:
        return _error(400, 400, "configuration.targetUrl and overrideExecutions are required")
    ex = execs[0]
    if int(ex.get("concurrency") or 0) < 1 or parse_duration(ex.get("holdFor", 0)) + parse_duration(ex.get("rampUp", 0)) <= 0:
        return _error(400, 400, "overrideExecutions[0] needs concurrency >= 1 and a positive duration")
    test_id = _next_id(_tests)
    test = {
        "id": test_id,
        "name": body.get("name") or f"test-{test_id}",
        "projectId": body.get("projectId"),
        "created": int(time.time()),
        "configuration": cfg,
        "overrideExecutions": execs,
    }
    _tests[test_id] = test
    _save_state()
    return render(
        "blazemeter",
        "create_test",
        request_id=_rid(),
        test_id=test_id,
        name=test["name"],
        project_id=test["projectId"],
        created=test["created"],
        configuration=cfg,
        executions=execs,
    )


@app.post("/api/v4/tests/{test_id}/start", status_code=201)
async def start_test(test_id: int):
    test = _tests.get(test_id)
    if not test:
        return _error(404, 404, f"Test {test_id} not found")
    ex, cfg = test["overrideExecutions"][0], test["configuration"]
    master = Master(
        id=_next_id(_masters),
        test_id=test_id,
        name=test["name"],
        created=int(time.time()),
        concurrency=int(ex["concurrency"]),
        ramp_up=parse_duration(ex.get("rampUp", 0)),
        hold_for=parse_duration(ex.get("holdFor", 0)),
        think_time=float(ex.get("thinkTime", 1.0)),
        target_url=cfg["targetUrl"],
        headers={str(k): str(v) for k, v in (cfg.get("headers") or {}).items()},
    )
    _masters[master.id] = master
    task = asyncio.get_running_loop().create_task(_run(master))
    _tasks[master.id] = task
    task.add_done_callback(lambda _, mid=master.id: _tasks.pop(mid, None))
    _save_state()
    return render(
        "blazemeter",
        "start_test",
        request_id=_rid(),
        master_id=master.id,
        test_id=test_id,
        name=master.name,
        created=master.created,
        report_url=f"{_public_url()}/app/masters/{master.id}",
    )


def _master(master_id: int) -> Master | JSONResponse:
    m = _masters.get(master_id)
    return m if m else _error(404, 404, f"Master {master_id} not found")


@app.get("/api/v4/masters/{master_id}/status")
def master_status(master_id: int):
    m = _master(master_id)
    if isinstance(m, JSONResponse):
        return m
    return render(
        "blazemeter",
        "master_status",
        request_id=_rid(),
        master_id=m.id,
        test_id=m.test_id,
        status=m.status,
        progress=m.progress(),
        created=m.created,
        started=m.started,
        ended=m.ended,
        hits=len(m.samples) if m.report is None else m.report["summary"]["hits"],
        concurrency=m.active,
        report_url=f"{_public_url()}/app/masters/{m.id}",
    )


@app.post("/api/v4/masters/{master_id}/stop")
def stop_master(master_id: int):
    m = _master(master_id)
    if isinstance(m, JSONResponse):
        return m
    if m.status != "ENDED":
        m.stop, m.aborted = True, True
    return render("blazemeter", "stop", request_id=_rid(), master_id=m.id, status=m.status)


def _ended(master_id: int) -> Master | JSONResponse:
    m = _master(master_id)
    if isinstance(m, JSONResponse):
        return m
    if m.status != "ENDED" or m.report is None:
        return _error(409, 409, f"Master {master_id} has not ended (status {m.status})")
    return m


@app.get("/api/v4/masters/{master_id}/reports/default/summary")
def summary(master_id: int):
    m = _ended(master_id)
    if isinstance(m, JSONResponse):
        return m
    return render("blazemeter", "summary", request_id=_rid(), **m.report["summary"])


@app.get("/api/v4/masters/{master_id}/reports/timeline/kpis")
def timeline(master_id: int):
    m = _ended(master_id)
    if isinstance(m, JSONResponse):
        return m
    t = m.report["timeline"]
    return render("blazemeter", "timeline_kpis", request_id=_rid(), interval=t["interval"], points=t["points"])


@app.get("/app/masters/{master_id}", response_class=HTMLResponse)
def report_page(master_id: int):
    _load_state()
    m = _masters.get(master_id)
    if not m:
        return HTMLResponse("<h1>Not found</h1>", status_code=404)
    rows = ""
    if m.report:
        rows = "".join(f"<tr><th>{html.escape(str(k))}</th><td>{html.escape(str(v))}</td></tr>" for k, v in m.report["summary"].items())
    return f"""<!doctype html><meta charset="utf-8"><title>{html.escape(m.name)} | Fake BlazeMeter</title>
<style>body{{font:14px system-ui;margin:24px;background:#0f1115;color:#e5e7eb}}
th{{text-align:left;color:#9ca3af;padding:4px 16px 4px 0}}</style>
<h2>Fake BlazeMeter · {html.escape(m.name)}</h2>
<p>Master {m.id} · status {m.status} · progress {m.progress()}%{" · aborted" if m.aborted else ""}</p>
<table>{rows}</table>"""


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "running": sum(1 for m in _masters.values() if m.status != "ENDED")}
