import secrets
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..deps import Deps, PathId
from ..runs.orchestrator import now
from ..schemas import Run as RunModel
from ..schemas import RunCreate, RunResults, RunStatus
from .catalog import load_catalog

router = APIRouter(tags=["runs"])


def usable_offerings(service: dict[str, Any], offerings: dict[str, dict[str, Any]]) -> list[str]:
    """Offerings a run on this service may target: allowed by the service and not unavailable."""
    allowed = service.get("allowed_offering_ids") or list(offerings)
    return [o for o in allowed if o in offerings and offerings[o]["status"] != "unavailable"]


@router.post("/runs", response_model=list[RunModel], status_code=201)
async def create_runs(body: RunCreate, deps: Deps):
    """Start a benchmark. Fixed routing creates one run per offering (a batch, run one after another)."""
    service = await deps.db.get("services", body.service_id)
    if not service:
        raise HTTPException(404, "Unknown service")
    cat = await load_catalog(deps.db)
    usable = usable_offerings(service, cat["offerings"])

    if body.load_profile_id:
        preset = await deps.db.get("load_profiles", body.load_profile_id)
        if not preset:
            raise HTTPException(422, f"Unknown load profile {body.load_profile_id!r}")
        load = {k: preset[k] for k in ("concurrency", "ramp_up_s", "duration_s", "think_time_s")}
        load |= {"profile_id": preset["id"], "name": preset["name"]}
    elif body.load:
        load = {**body.load.model_dump(), "profile_id": "custom", "name": "Custom"}
    else:
        raise HTTPException(422, "Give load_profile_id or load")

    if body.routing.mode == "fixed":
        ids = list(dict.fromkeys(body.routing.offering_ids))
        if not ids:
            raise HTTPException(422, "Pick at least one model")
        bad = [o for o in ids if o not in usable]
        if bad:
            raise HTTPException(422, f"Not available for this service: {', '.join(bad)}")
        routings = [{"mode": "fixed", "offering_id": o, "pool": None} for o in ids]
    else:
        pool = list(dict.fromkeys(body.routing.pool or usable))
        bad = [o for o in pool if o not in usable]
        if bad:
            raise HTTPException(422, f"Not available for this service: {', '.join(bad)}")
        if len(pool) < 2:
            raise HTTPException(422, "Auto routing needs at least two models in the pool")
        routings = [{"mode": "auto", "offering_id": None, "pool": pool}]

    batch_id = f"b_{secrets.token_hex(4)}"
    created = []
    for routing in routings:
        run = {
            "id": f"r_{secrets.token_hex(5)}",
            "batch_id": batch_id,
            "service_id": service["id"],
            "label": body.label,
            "routing": routing,
            "load": load,
            "status": "queued",
            "progress": 0,
            "created_at": now(),
            "updated_at": now(),
            "cancel_requested": False,
            "blazemeter": {},
            "splunk": {},
            "headline": None,
        }
        created.append(await deps.db.create("runs", run))
    for run in created:
        deps.orchestrator.enqueue(service["id"], run["id"])
    return created


@router.get("/runs", response_model=list[RunModel])
async def list_runs(
    deps: Deps,
    service_id: str | None = None,
    batch_id: str | None = None,
    status: list[RunStatus] | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    """Newest first."""
    flt: dict[str, Any] = {}
    for key, value in (("service_id", service_id), ("batch_id", batch_id)):
        if value:
            flt[key] = value
    if status:
        flt["status"] = {"$in": status}
    return await deps.db.query("runs", flt, sort=[("created_at", -1), ("id", -1)], limit=limit)


async def _run(deps: Deps, run_id: str) -> dict[str, Any]:
    run = await deps.db.get("runs", run_id)
    if not run:
        raise HTTPException(404, "Unknown run")
    return run


@router.get("/runs/{run_id}", response_model=RunModel)
async def get_run(run_id: PathId, deps: Deps):
    return await _run(deps, run_id)


@router.post("/runs/{run_id}/cancel", response_model=RunModel)
async def cancel_run(run_id: PathId, deps: Deps):
    """Queued runs are cancelled at once; running ones stop and keep their partial results."""
    return await deps.orchestrator.cancel(await _run(deps, run_id))


@router.get("/runs/{run_id}/results", response_model=RunResults)
async def run_results(run_id: PathId, deps: Deps):
    run = await _run(deps, run_id)
    res = await deps.db.get("run_results", run_id)
    if not res:
        raise HTTPException(409 if run["status"] not in ("completed", "cancelled") else 404, f"No results yet (run is {run['status']})")
    return res
