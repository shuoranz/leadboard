"""Regenerates fake_data/seed/runs.json and run_results.json: a few weeks of historical runs, so a
fresh checkout has a populated leaderboard.

It replays the same latency model the live fakes use (benchmark_fakes.common.latency) through an
offline virtual-user simulation, then aggregates with the real code path (build_results). Output is
deterministic.

    .venv/bin/python scripts/generate_seed_runs.py
"""

import heapq
import json
import random
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from app_benchmark.runs.aggregate import build_results, headline  # noqa: E402
from benchmark_fakes.blazemeter.app import Master, _report  # noqa: E402
from benchmark_fakes.common.latency import pick_offering, simulate_request  # noqa: E402

DATA = ROOT / "fake_data"
END = datetime(2026, 10, 5, 18, 0, tzinfo=UTC)


def load(name):
    return json.loads((DATA / name).read_text())


offerings = {o["id"]: o for o in load("seed/offerings.json")}
services = load("seed/services.json")
profiles = {p["id"]: p for p in load("seed/load_profiles.json")}
latency = load("profiles/offering_profiles.json")
traffic = load("profiles/service_profiles.json")["services"]


def usable(service):
    allowed = service["allowed_offering_ids"] or list(offerings)
    return [o for o in allowed if offerings[o]["status"] != "unavailable"]


def iso(dt):
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def simulate(service, profile, routing, rng, run_id, started):
    """Virtual users in nominal time: returns BlazeMeter samples and Splunk rows."""
    conc, ramp, dur, think = profile["concurrency"], profile["ramp_up_s"], profile["duration_s"], profile["think_time_s"]
    heap = [(ramp * i / conc, i) for i in range(conc)]
    heapq.heapify(heap)
    samples, rows = [], []
    while heap:
        t, vu = heapq.heappop(heap)
        if t >= dur:
            continue
        active = min(conc, int(t / ramp * conc) + 1) if ramp else conc
        oid = pick_offering(routing["pool"], rng) if routing["mode"] == "auto" else routing["offering_id"]
        ev = simulate_request(latency["offerings"][oid], traffic[service["id"]], latency["defaults"], active, rng)
        rt = ev["e2e_ms"] + rng.uniform(25, 70) + rng.expovariate(1 / 15)
        ok = ev["status"] == "ok"
        samples.append((round(t, 3), round(rt, 1), ok, ev["http_status"] if not ok or ev["http_status"] != 200 else 200))
        o = offerings[oid]
        row = {
            "run_id": run_id,
            "service_id": service["id"],
            "routing": routing["mode"],
            "offering_id": oid,
            "provider": o["provider_id"],
            "llm": o["llm_id"],
            "concurrency": active,
            **ev,
        }
        rows.append({k: "" if v is None else str(v) for k, v in row.items()})
        heapq.heappush(heap, (t + rt / 1000 + think * rng.uniform(0.7, 1.3), vu))
    m = Master(
        id=0,
        test_id=0,
        name="",
        created=0,
        concurrency=conc,
        ramp_up=ramp,
        hold_for=dur - ramp,
        think_time=think,
        target_url="",
        headers={},
        started=int(started.timestamp()),
        ended=int((started + timedelta(seconds=dur)).timestamp()),
    )
    m.samples = samples
    return _report(m), rows


def plan():
    """(service, profile, routing, days_ago) for every historical run."""
    out = []
    for s in services:
        pool = usable(s)
        for i, oid in enumerate(pool):
            out.append((s, "baseline", {"mode": "fixed", "offering_id": oid}, 3 + i * 0.1))
            out.append((s, "smoke", {"mode": "fixed", "offering_id": oid}, 9 + i * 0.1))
        out.append((s, "baseline", {"mode": "auto", "pool": pool}, 2.5))
        out.append((s, "smoke", {"mode": "auto", "pool": pool}, 8.5))
    flagship = next(s for s in services if s["id"] == "summarize-profile")
    for i, oid in enumerate(
        [
            "aurora-api--aurora-4",
            "stratus--aurora-4",
            "cloudhaven--gale-3",
            "northwind-api--gale-3",
            "swiftserve--forge-70b",
            "aurora-api--aurora-4-flash",
        ]
    ):
        out.append((flagship, "stress", {"mode": "fixed", "offering_id": oid}, 1 + i * 0.1))
        out.append((flagship, "baseline", {"mode": "fixed", "offering_id": oid}, 16 + i * 0.1))  # older: history
    out.append((flagship, "stress", {"mode": "auto", "pool": usable(flagship)}, 0.8))
    return out


def main():
    rng = random.Random(20261005)
    runs, results = [], []
    for n, (service, pid, routing, days_ago) in enumerate(plan()):
        profile = profiles[pid]
        run_id = f"r_seed{n:04d}"
        started = END - timedelta(days=days_ago, seconds=profile["duration_s"])
        ended = started + timedelta(seconds=profile["duration_s"] + 20)
        run = {
            "id": run_id,
            "batch_id": f"b_seed{n:04d}",
            "service_id": service["id"],
            "label": "Nightly benchmark" if pid != "stress" else "Peak-load check",
            "routing": {"offering_id": None, "pool": None, **routing},
            "load": {
                **{k: profile[k] for k in ("concurrency", "ramp_up_s", "duration_s", "think_time_s")},
                "profile_id": pid,
                "name": profile["name"],
            },
            "status": "completed",
            "progress": 100,
            "created_at": iso(started - timedelta(seconds=30)),
            "started_at": iso(started),
            "ended_at": iso(ended),
            "updated_at": iso(ended),
            "error": None,
            "cancel_requested": False,
        }
        report, rows = simulate(service, profile, run["routing"], rng, run_id, started)
        res = build_results(
            run=run,
            bm_summary={
                **{k: v for k, v in report["summary"].items()},
                "maxUsers": report["summary"]["max_users"],
                "hits_avg": report["summary"]["hits_avg"],
                "errorsByCode": report["summary"]["errors_by_code"],
            },
            bm_timeline=report["timeline"],
            events=rows,
            offerings=offerings,
            stall_threshold_ms=2000,
        )
        master = 10_000_000 + n * 7
        search = f"search index=llm_api run_id={run_id}"
        run |= {
            "blazemeter": {"test_id": master - 1, "master_id": master, "report_url": None, "status": "ENDED"},
            "splunk": {"sid": f"seed_{run_id}", "search": search, "search_url": None, "events": len(rows)},
            "headline": headline(res),
        }
        runs.append(run)
        results.append({"id": run_id, **res})
    runs.sort(key=lambda r: r["created_at"])
    (DATA / "seed" / "runs.json").write_text(json.dumps(runs, indent=1) + "\n")
    (DATA / "seed" / "run_results.json").write_text(json.dumps(results, separators=(",", ":")) + "\n")
    print(f"{len(runs)} runs, {sum(r['headline']['requests'] for r in runs)} simulated requests")


if __name__ == "__main__":
    main()
