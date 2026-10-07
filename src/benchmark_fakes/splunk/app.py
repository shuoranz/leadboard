"""Fake Splunk: HTTP Event Collector ingest + the REST search-job API.

    POST /services/collector/event                  HEC ingest (concatenated JSON objects or an array)
    POST /services/search/jobs                      {search, output_mode} (form or JSON) -> {"sid"}
    GET  /services/search/jobs/{sid}                dispatchState QUEUED -> RUNNING -> DONE
    GET  /services/search/jobs/{sid}/results        ?output_mode=json&count=0&offset=0
    GET  /en-US/app/search/search?q=...            a bare HTML results page (for "view in Splunk" links)

Events are stored as JSON lines in fake_data/splunk/events/<run_id>.jsonl. The search language
is a tiny subset: ``search index=llm_api run_id=abc status=error`` — space-separated key=value
filters (quotes allowed); anything after the first ``|`` is ignored. Like real Splunk, result
values come back as strings.
"""

import html
import json
import os
import re
import shlex
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

from ..common.jsonstore import append_jsonl, read_jsonl
from ..common.paths import data_dir
from ..common.templates import render

SAFE = re.compile(r"[^A-Za-z0-9_.-]")
HEC_FIELDS = ("index", "sourcetype", "source", "host")

app = FastAPI(title="Fake Splunk", version="1.0")
_jobs: dict[str, dict[str, Any]] = {}


def _events_dir() -> Path:
    return data_dir() / "splunk" / "events"


def _job_delay() -> float:
    return float(os.environ.get("SPLUNK_JOB_DELAY_S", "0.6"))


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(render("splunk", "error", message=message), status_code=status)


def _parse_hec(body: str) -> list[dict[str, Any]]:
    body = body.strip()
    if body.startswith("["):
        return json.loads(body)
    decoder, i, out = json.JSONDecoder(), 0, []
    while i < len(body):
        obj, i = decoder.raw_decode(body, i)
        out.append(obj)
        while i < len(body) and body[i].isspace():
            i += 1
    return out


@app.post("/services/collector/event")
async def hec(request: Request):
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Splunk ") or len(auth) <= 7:
        return JSONResponse({"text": "Token is required", "code": 2}, status_code=401)
    try:
        records = _parse_hec((await request.body()).decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JSONResponse({"text": "Invalid data format", "code": 6}, status_code=400)
    by_run: dict[str, list[dict]] = {}
    for r in records:
        if not isinstance(r, dict) or not isinstance(r.get("event"), dict):
            return JSONResponse({"text": "Event field is required", "code": 12}, status_code=400)
        r.setdefault("time", time.time())
        run = SAFE.sub("_", str(r["event"].get("run_id") or "_unscoped"))
        by_run.setdefault(run, []).append(r)
    for run, rows in by_run.items():
        append_jsonl(_events_dir() / f"{run}.jsonl", rows)
    return render("splunk", "hec_ack", ack_id=uuid.uuid4().int % 10**6)


def parse_search(search: str) -> dict[str, str]:
    query = search.split("|", 1)[0].strip()
    if query.startswith("search "):
        query = query[len("search ") :]
    filters = {}
    for token in shlex.split(query):
        if "=" not in token:
            raise ValueError(f"Unsupported search term {token!r}; use key=value")
        key, value = token.split("=", 1)
        filters[key] = value
    return filters


def _flatten(record: dict[str, Any]) -> dict[str, str]:
    """A HEC record as a Splunk result row: string values, _time as ISO-8601."""
    row = {k: "" if v is None else str(v) for k, v in record["event"].items()}
    for k in HEC_FIELDS:
        if k in record:
            row[k] = str(record[k])
    row["_time"] = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(float(record["time"]))) + (
        f".{int(float(record['time']) % 1 * 1000):03d}+00:00"
    )
    return row


def search_events(filters: dict[str, str]) -> list[dict[str, str]]:
    run = filters.get("run_id")
    files = [_events_dir() / f"{SAFE.sub('_', run)}.jsonl"] if run else sorted(_events_dir().glob("*.jsonl"))
    rows = []
    for f in files:
        for record in read_jsonl(f):
            row = _flatten(record)
            if all(row.get(k) == v for k, v in filters.items()):
                rows.append(row)
    rows.sort(key=lambda r: r["_time"])
    return rows


@app.post("/services/search/jobs", status_code=201)
async def create_job(request: Request):
    if request.headers.get("content-type", "").startswith("application/json"):
        params = await request.json()
    else:
        params = dict(await request.form())
    search = str(params.get("search", "")).strip()
    if not search:
        return _error(400, "Missing required argument: search")
    try:
        filters = parse_search(search)
    except ValueError as e:
        return _error(400, str(e))
    sid = f"{time.time():.3f}_{uuid.uuid4().hex[:8]}"
    _jobs[sid] = {"sid": sid, "search": search, "filters": filters, "created": time.monotonic(), "rows": None}
    return render("splunk", "search_job", sid=sid)


def _job(sid: str) -> dict[str, Any]:
    job = _jobs.get(sid)
    if not job:
        raise HTTPException(404, f"Unknown sid {sid}")
    elapsed = time.monotonic() - job["created"]
    if elapsed >= _job_delay() and job["rows"] is None:
        job["rows"] = search_events(job["filters"])
    return job


def _state(job: dict, elapsed: float) -> tuple[str, float]:
    if job["rows"] is not None:
        return "DONE", 1.0
    return ("QUEUED", 0.0) if elapsed < _job_delay() / 3 else ("RUNNING", round(elapsed / _job_delay(), 2))


@app.get("/services/search/jobs/{sid}")
def job_status(sid: str):
    job = _job(sid)
    state, progress = _state(job, time.monotonic() - job["created"])
    return render(
        "splunk",
        "job_status",
        sid=sid,
        search=job["search"],
        state=state,
        is_done=state == "DONE",
        progress=progress,
        result_count=len(job["rows"]) if job["rows"] is not None else 0,
    )


@app.get("/services/search/jobs/{sid}/results")
def job_results(sid: str, count: int = 100, offset: int = 0):
    job = _job(sid)
    if job["rows"] is None:
        # Real Splunk answers 204 until the job is done.
        return JSONResponse(None, status_code=204)
    rows = job["rows"][offset : None if count == 0 else offset + count]
    fields = sorted({k for r in rows for k in r})
    return render("splunk", "results", offset=offset, fields=[{"name": f} for f in fields], results=rows)


@app.get("/en-US/app/search/search", response_class=HTMLResponse)
def search_page(q: str = ""):
    try:
        rows = search_events(parse_search(q))
    except ValueError as e:
        rows, q = [], f"{q}  — {e}"
    cols = ["_time", "provider", "llm", "status", "error_type", "ttft_ms", "e2e_ms", "input_tokens", "output_tokens"]
    head = "".join(f"<th>{c}</th>" for c in cols)
    body = "".join("<tr>" + "".join(f"<td>{html.escape(r.get(c, ''))}</td>" for c in cols) + "</tr>" for r in rows[:500])
    return f"""<!doctype html><meta charset="utf-8"><title>Search | Fake Splunk</title>
<style>body{{font:13px ui-monospace,monospace;margin:24px;background:#171a21;color:#e5e7eb}}
table{{border-collapse:collapse}}td,th{{border-bottom:1px solid #333;padding:4px 10px;text-align:left}}
th{{color:#9ca3af}}</style>
<h2>Fake Splunk · search</h2><p>{html.escape(q)}</p><p>{len(rows)} events (first 500 shown)</p>
<table><tr>{head}</tr>{body}</table>"""


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "events_dir": str(_events_dir())}
