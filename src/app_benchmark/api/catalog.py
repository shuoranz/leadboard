from typing import Any

from fastapi import APIRouter

from ..clients.db import DbClient
from ..deps import Deps
from ..schemas import Catalog, LoadProfile

router = APIRouter(tags=["catalog"])


async def load_catalog(db: DbClient) -> dict[str, dict[str, dict[str, Any]]]:
    """Catalog collections keyed by id."""
    return {c: {d["id"]: d for d in await db.all(c)} for c in ("providers", "llms", "offerings")}


@router.get("/catalog", response_model=Catalog)
async def catalog(deps: Deps):
    """The two-layer catalog: providers, LLMs, and offerings (one LLM served by one provider)."""
    cat = await load_catalog(deps.db)
    return {k: list(v.values()) for k, v in cat.items()}


@router.get("/load-profiles", response_model=list[LoadProfile])
async def load_profiles(deps: Deps):
    return await deps.db.all("load_profiles")
