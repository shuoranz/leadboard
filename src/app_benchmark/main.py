"""The benchmark API (``/api``) and the built frontend (``/``).

uvicorn app_benchmark.main:app --port 8000
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import catalog, leaderboard, runs, services
from .clients.blazemeter import BlazeMeterError
from .clients.db import DbError
from .clients.splunk import SplunkError
from .deps import Container
from .settings import Settings

STATIC = Path(__file__).parent / "static"


def create_app(settings: Settings | None = None, transports: dict[str, httpx.AsyncBaseTransport] | None = None) -> FastAPI:
    settings = settings or Settings()
    container = Container.build(settings, transports)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            resumed = await container.orchestrator.resume()
            if resumed:
                logging.getLogger(__name__).info("resumed %d unfinished runs", resumed)
        except DbError as e:
            logging.getLogger(__name__).warning("could not resume runs: %s", e)
        yield
        await container.aclose()

    app = FastAPI(title="LLM service benchmark", version="0.2.0", lifespan=lifespan)
    app.state.container = container

    @app.exception_handler(DbError)
    @app.exception_handler(BlazeMeterError)
    @app.exception_handler(SplunkError)
    async def upstream_error(_: Request, exc: Exception):
        return JSONResponse({"detail": str(exc)}, status_code=502)

    for r in (services.router, catalog.router, runs.router, leaderboard.router):
        app.include_router(r, prefix="/api")

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    # After the /api routes, so they take precedence.
    if settings.serve_static and (STATIC / "index.html").exists():
        app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
    return app


app = create_app()
