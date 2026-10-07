from fastapi import APIRouter, HTTPException

from ..deps import Deps
from ..runs.leaderboard import build_leaderboard
from ..schemas import Leaderboard
from .catalog import load_catalog

router = APIRouter(tags=["leaderboard"])


@router.get("/services/{service_id}/leaderboard", response_model=Leaderboard)
async def leaderboard(service_id: str, deps: Deps, profile: str | None = None):
    """Offerings ranked on their latest completed run under one load profile (default: the latest run's)."""
    db = deps.db
    service = await db.get("services", service_id)
    if not service:
        raise HTTPException(404, "Unknown service")
    runs = await db.query("runs", {"service_id": service_id, "status": "completed"})
    ids = [r["id"] for r in runs]
    results = {r["id"]: r for r in await db.query("run_results", {"id": {"$in": ids}})} if ids else {}
    s = deps.settings
    return build_leaderboard(
        service=service,
        profiles=await db.all("load_profiles"),
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
