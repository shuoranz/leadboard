from fastapi import APIRouter, HTTPException

from ..deps import Deps, PathId
from ..schemas import Service

router = APIRouter(tags=["services"])


@router.get("/services", response_model=list[Service])
async def services(deps: Deps):
    """Every benchmarkable service, in catalog order (the first is the default landing page)."""
    return await deps.db.all("services")


@router.get("/services/{service_id}", response_model=Service)
async def service(service_id: PathId, deps: Deps):
    s = await deps.db.get("services", service_id)
    if not s:
        raise HTTPException(404, "Unknown service")
    return s
