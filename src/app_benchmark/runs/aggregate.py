"""Turns a run's raw data into its results. Pure functions, unit-tested.

Two sources, two vantage points:

* **BlazeMeter** (client side): hits, failures and response-time percentiles as the load
  generator saw them, plus a timeline. Includes the network.
* **Splunk** (server side): one event per request logged by the service itself, with the model
  that served it, TTFT, tokens, and the error cause. Auto-routed runs are split per model here.

Splunk returns every value as a string; ``_num`` parses them. Time-based Splunk rates use the
run's nominal duration from BlazeMeter, since the fake load runs time-compressed.
"""

import math
from collections import Counter, defaultdict
from statistics import median
from typing import Any

ERROR_TYPES = ("rate_limited", "server_error", "timeout", "dropped_stream", "refused")
INPUT_BUCKETS = (1_000, 2_000, 4_000, 8_000, 16_000, math.inf)
MIN_BUCKET_EVENTS = 5


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def percentile(values: list[float], p: float) -> float | None:
    """Linear interpolation between closest ranks (numpy's default)."""
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return round(s[lo] + (s[hi] - s[lo]) * (k - lo), 1)


def pcts(values: list[float]) -> dict[str, float | None] | None:
    if not values:
        return None
    return {"p50": percentile(values, 0.5), "p95": percentile(values, 0.95), "p99": percentile(values, 0.99)}


def _col(events: list[dict], key: str) -> list[float]:
    return [v for e in events if (v := _num(e.get(key))) is not None]


def ttft_by_input(events: list[dict]) -> list[dict[str, float]]:
    buckets: dict[float, list[dict]] = defaultdict(list)
    for e in events:
        n, t = _num(e.get("input_tokens")), _num(e.get("ttft_ms"))
        if n is not None and t is not None:
            buckets[next(b for b in INPUT_BUCKETS if n < b)].append({"n": n, "t": t})
    return [
        {"input_tokens": round(median(x["n"] for x in rows)), "p50_ms": round(median(x["t"] for x in rows), 1)}
        for b, rows in sorted(buckets.items())
        if len(rows) >= MIN_BUCKET_EVENTS
    ]


def server_perf(events: list[dict], duration_s: float | None, stall_threshold_ms: float) -> dict[str, Any]:
    """Server-side metrics over a set of Splunk events (one run, or one offering within a run)."""
    n = len(events)
    ok = [e for e in events if e.get("status") == "ok"]
    causes = Counter(e.get("error_type") or "other" for e in events if e.get("status") != "ok")
    gaps = _col(events, "max_itl_gap_ms")
    out_tokens = sum(_col(events, "output_tokens"))
    prefill = [
        n_in / (t / 1000) for e in events if (n_in := _num(e.get("input_tokens"))) is not None and (t := _num(e.get("ttft_ms"))) and t > 0
    ]
    per_min = out_tokens / (duration_s / 60) if duration_s else None
    return {
        "requests": n,
        "errors": n - len(ok),
        "success_rate": round(len(ok) / n, 4) if n else None,
        "error_breakdown": {k: causes.get(k, 0) for k in ERROR_TYPES} | {"other": causes.get("other", 0)},
        "truncation_rate": round(sum(1 for e in ok if e.get("finish_reason") == "length") / len(ok), 4) if ok else None,
        "ttft_ms": pcts(_col(events, "ttft_ms")),
        "ttft_by_input": ttft_by_input(events),
        "itl_ms": pcts(_col(events, "itl_ms")),
        "stall_rate": round(sum(1 for g in gaps if g > stall_threshold_ms) / len(gaps), 4) if gaps else None,
        "server_e2e_ms": pcts(_col(events, "e2e_ms")),  # all requests, like BlazeMeter's view
        "decode_tps_p50": percentile(_col(events, "decode_tps"), 0.5),
        "prefill_tps": round(median(prefill)) if prefill else None,
        "tokens_per_min": {"avg": round(per_min) if per_min is not None else None, "peak": None},
        "throughput_rps": round(n / duration_s, 3) if duration_s else None,
        "avg_input_tokens": round(sum(_col(events, "input_tokens")) / n) if n else None,
        "avg_output_tokens": round(sum(_col(ok, "output_tokens")) / len(ok)) if ok else None,
    }


#: Rejected before the model processed anything (HTTP 429 / 503 / 400): providers don't bill these.
UNBILLED_ERRORS = ("rate_limited", "server_error", "refused")


def _spend(events: list[dict], prices: dict[str, float | None]) -> float | None:
    """List-price USD for the billable requests; None without input and output prices.

    Timeouts and dropped streams still consumed tokens, so they're billed like successes."""
    ip, cp, op = prices.get("input_per_million"), prices.get("cached_input_per_million"), prices.get("output_per_million")
    if ip is None or op is None:
        return None
    total = 0.0
    for e in events:
        if e.get("status") != "ok" and e.get("error_type") in UNBILLED_ERRORS:
            continue
        n_in, cached, n_out = (_num(e.get(k)) or 0.0 for k in ("input_tokens", "cached_input_tokens", "output_tokens"))
        total += (n_in - cached) * ip + cached * (cp if cp is not None else ip) + n_out * op
    return total / 1e6


def _ok(events: list[dict]) -> int:
    return sum(1 for e in events if e.get("status") == "ok")


def _per_success(spend: float | None, ok: int) -> dict[str, float | None]:
    if spend is None or not ok:
        return {"per_request": None, "per_1k_requests": None}
    per_request = spend / ok
    return {"per_request": round(per_request, 6), "per_1k_requests": round(per_request * 1000, 4)}


def cost(events: list[dict], prices: dict[str, float | None]) -> dict[str, Any]:
    """List-price cost per *successful* request from logged token counts; cached input billed at the cache rate.

    Spend on billed requests that failed is spread over the ones that succeeded, so an
    unreliable offering costs more per useful answer, not less."""
    base = {k: prices.get(k) for k in ("input_per_million", "cached_input_per_million", "output_per_million")}
    return {**base, **_per_success(_spend(events, prices), _ok(events))}


def blazemeter_view(summary: dict[str, Any], timeline: dict[str, Any] | None) -> dict[str, Any]:
    hits = int(summary.get("hits") or 0)
    failed = int(summary.get("failed") or 0)
    return {
        "summary": {
            "hits": hits,
            "failed": failed,
            "error_rate": round(failed / hits, 4) if hits else None,
            "avg_ms": summary.get("avg"),
            "min_ms": summary.get("min"),
            "max_ms": summary.get("max"),
            "p50_ms": summary.get("tp50"),
            "p90_ms": summary.get("tp90"),
            "p95_ms": summary.get("tp95"),
            "p99_ms": summary.get("tp99"),
            "throughput_rps": summary.get("hits_avg"),
            "duration_s": summary.get("duration"),
            "max_users": summary.get("maxUsers"),
            "errors_by_code": summary.get("errorsByCode") or {},
        },
        "interval_s": (timeline or {}).get("interval"),
        "timeline": [
            {"t_s": p["ts"], "users": p["na"], "hits": p["n"], "errors": p["ec"], "avg_ms": p["t"], "p90_ms": p["t90"]}
            for p in (timeline or {}).get("points", [])
        ],
    }


def _diff(a: float | None, b: float | None) -> float | None:
    return None if a is None or b is None else round(max(0.0, a - b), 1)


def build_results(
    *,
    run: dict[str, Any],
    bm_summary: dict[str, Any],
    bm_timeline: dict[str, Any] | None,
    events: list[dict[str, Any]],
    offerings: dict[str, dict[str, Any]],
    stall_threshold_ms: float,
) -> dict[str, Any]:
    """Everything the run detail page and the leaderboard need, merged from both sources."""
    bm = blazemeter_view(bm_summary, bm_timeline)
    duration = bm["summary"]["duration_s"]
    server = server_perf(events, duration, stall_threshold_ms)

    by_offering = []
    groups: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        groups[e.get("offering_id") or "unknown"].append(e)
    for oid, evs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        o = offerings.get(oid, {})
        by_offering.append(
            {
                "offering_id": oid,
                "provider_id": o.get("provider_id"),
                "llm_id": o.get("llm_id"),
                "share": round(len(evs) / len(events), 4),
                "perf": server_perf(evs, duration, stall_threshold_ms),
                "cost": cost(evs, o.get("prices", {})),
            }
        )

    # Peak tokens/min: the busiest timeline interval at the run's mean output size.
    if server["avg_output_tokens"] and bm["timeline"] and bm["interval_s"]:
        busiest = max(p["hits"] - p["errors"] for p in bm["timeline"])
        server["tokens_per_min"]["peak"] = round(busiest * server["avg_output_tokens"] / (bm["interval_s"] / 60))

    s = bm["summary"]
    client_e2e = {"p50": s["p50_ms"], "p95": s["p95_ms"], "p99": s["p99_ms"]} if s["hits"] else None
    srv = server["server_e2e_ms"] or {}
    # The leaderboard row: client-side volume, errors and latency; server-side tokens and TTFT.
    perf = {
        **{k: v for k, v in server.items() if k not in ("server_e2e_ms",)},
        "requests": s["hits"],
        "errors": s["failed"],
        "success_rate": round(1 - s["error_rate"], 4) if s["error_rate"] is not None else None,
        "e2e_ms": client_e2e,
        "server_e2e_ms": server["server_e2e_ms"],
        "client_overhead_ms": {"p50": _diff(s["p50_ms"], srv.get("p50")), "p95": _diff(s["p95_ms"], srv.get("p95"))}
        if client_e2e and srv
        else None,
        "throughput_rps": s["throughput_rps"],
    }

    if run["routing"]["mode"] == "fixed":
        run_cost = by_offering[0]["cost"] if by_offering else cost([], offerings.get(run["routing"]["offering_id"], {}).get("prices", {}))
    else:
        # Mixed traffic: total spend over every model, per successful request.
        priced = [(evs, p) for oid, evs in groups.items() if (p := _spend(evs, offerings.get(oid, {}).get("prices", {}))) is not None]
        run_cost = _per_success(sum(p for _, p in priced), sum(_ok(evs) for evs, _ in priced)) if priced else _per_success(None, 0)

    return {
        "run_id": run["id"],
        "blazemeter": bm,
        "splunk": {"events": len(events), "overall": server, "by_offering": by_offering},
        "perf": perf,
        "cost": run_cost,
    }


def headline(results: dict[str, Any]) -> dict[str, Any]:
    """The few numbers the runs list shows, denormalized onto the run document."""
    p = results["perf"]
    return {
        "requests": p["requests"],
        "error_rate": round(1 - p["success_rate"], 4) if p["success_rate"] is not None else None,
        "e2e_p95_ms": (p["e2e_ms"] or {}).get("p95"),
        "ttft_p50_ms": (p["ttft_ms"] or {}).get("p50"),
        "cost_per_1k": results["cost"].get("per_1k_requests"),
    }
