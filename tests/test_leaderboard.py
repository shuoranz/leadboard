from app_benchmark.runs.leaderboard import build_leaderboard, latest_run_ids

CATALOG = {
    "providers": {"p": {"id": "p", "name": "Prov P"}, "q": {"id": "q", "name": "Prov Q"}},
    "llms": {"a": {"id": "a", "name": "Model A", "organization": "Org", "open_weights": True, "context_window": 1000}},
    "offerings": {
        "p--a": {
            "id": "p--a",
            "provider_id": "p",
            "llm_id": "a",
            "status": "available",
            "regions": ["us"],
            "prices": {"input_per_million": 1, "output_per_million": 2},
            "capabilities": {"streaming": True},
        },
        "q--a": {
            "id": "q--a",
            "provider_id": "q",
            "llm_id": "a",
            "status": "degraded",
            "regions": ["eu"],
            "prices": {"input_per_million": 1, "output_per_million": 2},
            "capabilities": {},
        },
    },
}
PROFILES = [
    {"id": "smoke", "name": "Smoke", "concurrency": 5, "ramp_up_s": 10, "duration_s": 60, "think_time_s": 1},
    {"id": "baseline", "name": "Baseline", "concurrency": 20, "ramp_up_s": 30, "duration_s": 300, "think_time_s": 2},
]


def run(rid, offering, profile="baseline", ended="2026-10-01T00:00:00Z", status="completed"):
    load = (
        next(p for p in PROFILES if p["id"] == profile)
        if profile != "custom"
        else {"concurrency": 3, "ramp_up_s": 0, "duration_s": 30, "think_time_s": 1}
    )
    routing = {"mode": "auto", "pool": ["p--a", "q--a"]} if offering == "auto" else {"mode": "fixed", "offering_id": offering}
    return {
        "id": rid,
        "status": status,
        "routing": routing,
        "ended_at": ended,
        "started_at": ended,
        "load": {**load, "profile_id": profile},
        "headline": {"e2e_p95_ms": 1},
    }


def result(p95):
    return {
        "perf": {"e2e_ms": {"p95": p95}},
        "cost": {"per_request": 0.001},
        "splunk": {"by_offering": [{"offering_id": "p--a", "share": 0.5}, {"offering_id": "q--a", "share": 0.5}]},
    }


def board(runs, results, profile=None):
    return build_leaderboard(
        service={"id": "s"},
        profiles=PROFILES,
        runs=runs,
        results=results,
        catalog=CATALOG,
        profile=profile,
        conditions_extra={"client_region": "us"},
    )


def test_latest_run_per_offering_wins_and_rows_sort_by_p95():
    runs = [run("old", "p--a", ended="2026-09-01T00:00:00Z"), run("new", "p--a", ended="2026-10-02T00:00:00Z"), run("q", "q--a")]
    b = board(runs, {"old": result(100), "new": result(900), "q": result(500)})
    assert [r["run_id"] for r in b["rows"]] == ["q", "new"]
    p_row = b["rows"][1]
    assert p_row["provider"] == "Prov P" and p_row["model_id"] == "a" and p_row["organization"] == "Org"
    assert [h["run_id"] for h in p_row["recent_runs"]] == ["new", "old"]
    assert p_row["capabilities"]["context_window"] == 1000


def test_profile_tabs_default_to_latest_run_and_custom_appears_only_when_used():
    runs = [run("a", "p--a", "smoke", ended="2026-10-05T00:00:00Z"), run("b", "q--a", "baseline")]
    b = board(runs, {"a": result(1), "b": result(2)})
    assert b["profile"] == "smoke"
    assert {t["id"]: t["runs"] for t in b["profiles"]} == {"smoke": 1, "baseline": 1}
    assert [r["id"] for r in b["rows"]] == ["p--a"]
    b2 = board([*runs, run("c", "p--a", "custom")], {"a": result(1), "b": result(2), "c": result(3)}, profile="custom")
    assert b2["profiles"][-1]["id"] == "custom" and b2["rows"][0]["run_id"] == "c"


def test_auto_runs_add_one_row_with_routing_mix_and_failed_runs_are_ignored():
    runs = [run("au", "auto"), run("bad", "p--a", status="failed")]
    b = board(runs, {"au": result(10), "bad": result(1)})
    assert [r["id"] for r in b["rows"]] == ["auto"]
    assert b["rows"][0]["routing_mix"][0] == {"offering_id": "p--a", "share": 0.5}
    assert b["conditions"]["concurrency"] == [20]


def test_only_the_latest_runs_results_are_needed():
    runs = [
        run("old", "p--a", ended="2026-09-01T00:00:00Z"),
        run("new", "p--a", ended="2026-10-02T00:00:00Z"),
        run("q", "q--a"),
        run("sm", "p--a", "smoke", ended="2026-08-01T00:00:00Z"),
    ]
    assert latest_run_ids(runs=runs, profiles=PROFILES, profile=None) == ["new", "q"]
    assert latest_run_ids(runs=runs, profiles=PROFILES, profile="smoke") == ["sm"]
    every = {"old": result(100), "new": result(900), "q": result(500), "sm": result(1)}
    assert board(runs, {k: every[k] for k in ("new", "q")}) == board(runs, every)  # history comes from the run docs
