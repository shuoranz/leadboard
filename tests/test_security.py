"""Upstream failures: their details (internal paths, response bodies) stay in the logs."""

import httpx
import pytest

from app_benchmark.main import create_app
from app_benchmark.settings import Settings


@pytest.mark.parametrize(
    ("db_response", "detail"),
    [
        (httpx.Response(500, text="Traceback: /srv/db/secret.py line 3"), "DB service returned HTTP 500"),
        (httpx.ConnectError("connect to 10.0.0.7:5432 refused"), "DB service is unreachable"),
    ],
)
async def test_upstream_failures_reach_clients_without_their_details(db_response, detail, caplog):
    def handle(request):
        if isinstance(db_response, Exception):
            raise db_response
        return db_response

    app = create_app(Settings(serve_static=False, _env_file=None), transports={"db": httpx.MockTransport(handle)})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api") as api:
        res = await api.get("/api/services")
    assert res.status_code == 502 and res.json() == {"detail": detail}
    assert "/collections/services/docs" in caplog.text  # the details are logged
    await app.state.container.aclose()
