"""Builds a service's leaderboard from its completed runs. Pure, unit-tested.

A row is an offering (provider × LLM) ranked on its **latest** completed fixed-routing run under
the selected load profile. Results are only comparable within one load profile, so profiles are
tabs. Auto-routed runs add one "Auto routing" row.

Picking the runs needs only the run documents, so results (the large part) are loaded just for
the runs that end up as rows: ``latest_run_ids`` names them, ``build_leaderboard`` uses them.
"""

from typing import Any

AUTO = "auto"
CUSTOM = "custom"
RECENT = 5


def _key(run: dict[str, Any]) -> str:
    return AUTO if run["routing"]["mode"] == AUTO else run["routing"]["offering_id"]


def _recent(run: dict[str, Any]) -> dict[str, Any]:
    h = run.get("headline") or {}
    return {
        "run_id": run["id"],
        "ended_at": run.get("ended_at"),
        "e2e_p95_ms": h.get("e2e_p95_ms"),
        "ttft_p50_ms": h.get("ttft_p50_ms"),
        "error_rate": h.get("error_rate"),
    }


def _custom_tab(runs: int) -> dict[str, Any]:
    return {
        "id": CUSTOM,
        "name": "Custom",
        "description": "Runs with a custom load; may not be comparable.",
        "concurrency": 0,
        "ramp_up_s": 0,
        "duration_s": 0,
        "think_time_s": 0,
        "runs": runs,
    }


def _select(runs: list[dict[str, Any]], profiles: list[dict[str, Any]], profile: str | None):
    """Completed runs newest first, the profile tabs, the selected profile, and per row its latest run and history."""
    done = sorted((r for r in runs if r["status"] == "completed"), key=lambda r: r.get("ended_at") or "", reverse=True)
    counts: dict[str, int] = {}
    for r in done:
        counts[r["load"]["profile_id"]] = counts.get(r["load"]["profile_id"], 0) + 1
    tabs = [{**p, "runs": counts.get(p["id"], 0)} for p in profiles]
    if counts.get(CUSTOM):
        tabs.append(_custom_tab(counts[CUSTOM]))

    if profile not in {t["id"] for t in tabs}:
        # Default to the profile of the latest run, else the first preset.
        profile = done[0]["load"]["profile_id"] if done else (tabs[0]["id"] if tabs else None)

    latest: dict[str, dict[str, Any]] = {}
    history: dict[str, list[dict[str, Any]]] = {}
    for r in done:
        if r["load"]["profile_id"] == profile:
            k = _key(r)
            latest.setdefault(k, r)
            history.setdefault(k, []).append(r)
    return done, tabs, profile, latest, history


def latest_run_ids(*, runs: list[dict[str, Any]], profiles: list[dict[str, Any]], profile: str | None) -> list[str]:
    """The runs whose results ``build_leaderboard`` reads: one per row."""
    return [r["id"] for r in _select(runs, profiles, profile)[3].values()]


def build_leaderboard(
    *,
    service: dict[str, Any],
    profiles: list[dict[str, Any]],
    runs: list[dict[str, Any]],
    results: dict[str, dict[str, Any]],
    catalog: dict[str, dict[str, dict[str, Any]]],
    profile: str | None,
    conditions_extra: dict[str, Any],
) -> dict[str, Any]:
    """``results`` needs only the runs ``latest_run_ids`` names. Leave out runs whose results are
    missing, so a row falls back to that offering's previous run instead of being dropped."""
    done, tabs, profile, latest, history = _select(runs, profiles, profile)

    providers, llms, offerings = catalog["providers"], catalog["llms"], catalog["offerings"]
    rows = []
    for k, run in latest.items():
        res = results.get(run["id"])
        if res is None:
            continue
        base = {
            "routing": run["routing"]["mode"],
            "run_id": run["id"],
            "run_at": run.get("ended_at"),
            "perf": res["perf"],
            "cost": res["cost"],
            "recent_runs": [_recent(h) for h in history[k][:RECENT]],
        }
        if k == AUTO:
            rows.append(
                {
                    **base,
                    "id": AUTO,
                    "name": "Auto routing",
                    "short_name": "Auto",
                    "provider": "Random per request",
                    "provider_id": AUTO,
                    "model_id": AUTO,
                    "organization": "Auto routing",
                    "open_weights": False,
                    "routing_mix": [{"offering_id": b["offering_id"], "share": b["share"]} for b in res["splunk"]["by_offering"]],
                }
            )
            continue
        o = offerings.get(k)
        if not o:
            continue  # an offering removed from the catalog
        llm, prov = llms.get(o["llm_id"], {}), providers.get(o["provider_id"], {})
        rows.append(
            {
                **base,
                "id": k,
                "name": llm.get("name", o["llm_id"]),
                "provider": prov.get("name", o["provider_id"]),
                "provider_id": o["provider_id"],
                "model_id": o["llm_id"],
                "organization": llm.get("organization", "Unknown"),
                "open_weights": llm.get("open_weights", False),
                "status": o["status"],
                "cost": {**o["prices"], **res["cost"]},
                "capabilities": {
                    **o["capabilities"],
                    "context_window": llm.get("context_window"),
                    "max_output_tokens": llm.get("max_output_tokens"),
                    "regions": o.get("regions"),
                },
            }
        )
    rows.sort(key=lambda row: ((row["perf"].get("e2e_ms") or {}).get("p95") is None, (row["perf"].get("e2e_ms") or {}).get("p95") or 0))

    conditions = None
    if latest:
        used = list(latest.values())
        loads = sorted({r["load"]["concurrency"] for r in used})
        first = used[0]["load"]
        conditions = {
            "started_at": min((r.get("started_at") or "" for r in used), default=None) or None,
            "ended_at": max((r.get("ended_at") or "" for r in used), default=None) or None,
            "concurrency": loads,
            "ramp_up_s": first["ramp_up_s"],
            "duration_s": first["duration_s"],
            "think_time_s": first["think_time_s"],
            "runs": len(used),
            **conditions_extra,
        }
    return {
        "service": service,
        "profiles": tabs,
        "profile": profile,
        "rows": rows,
        "conditions": conditions,
        "updated_at": done[0].get("ended_at") if done else None,
    }
