from fastapi import APIRouter, HTTPException

from ..deps import Deps, PathId
from ..runs.leaderboard import build_leaderboard, latest_run_ids
from ..schemas import Leaderboard
from .catalog import load_catalog

router = APIRouter(tags=["leaderboard"])


@router.get("/services/{service_id}/leaderboard", response_model=Leaderboard)
async def leaderboard(service_id: PathId, deps: Deps, profile: str | None = None):
    """Offerings ranked on their latest completed run under one load profile (default: the latest run's)."""
    db = deps.db
    service = await db.get("services", service_id)
    if not service:
        raise HTTPException(404, "Unknown service")
    runs = await db.query("runs", {"service_id": service_id, "status": "completed"})
    profiles = await db.all("load_profiles")
    # Load results only for the runs shown. A completed run should always have them; if one
    # doesn't, drop it and pick again, so its row falls back to the offering's previous run.
    results: dict[str, dict] = {}
    while wanted := [i for i in latest_run_ids(runs=runs, profiles=profiles, profile=profile) if i not in results]:
        found = {r["id"]: r for r in await db.query("run_results", {"id": {"$in": wanted}})}
        results |= found
        missing = set(wanted) - found.keys()
        runs = [r for r in runs if r["id"] not in missing]
    s = deps.settings
    return build_leaderboard(
        service=service,
        profiles=profiles,
        runs=runs,
        results=results,
        catalog=await load_catalog(db),
        profile=profile,
        conditions_extra={
            "client_region": s.client_region,
            "streaming": True,
            "stall_threshold_ms": s.stall_threshold_ms,
            "timeout_ms": s.timeout_ms,
            "notes": "Client-side latency and volume from BlazeMeter; TTFT, tokens and error causes from the "
            "service's own Splunk logs. Each row is that offering's latest completed run.",
        },
    )
