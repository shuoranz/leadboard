"""Untrusted input and upstream failures: ids can't reshape upstream URLs, and upstream details
(internal paths, response bodies) stay in the logs."""

import httpx
import pytest

from app_benchmark.clients.blazemeter import BlazeMeterClient
from app_benchmark.clients.db import DbClient
from app_benchmark.main import create_app
from app_benchmark.settings import Settings


def recording(response: httpx.Response):
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.raw_path.decode())
        return response

    return seen, httpx.MockTransport(handle)


async def test_ids_are_escaped_in_db_urls():
    seen, transport = recording(httpx.Response(404, json={}))
    db = DbClient("http://db", "k", transport)
    for doc_id in ["x?admin=1", "a/b", "%2E%2E%2Fadmin", "a#b"]:
        assert await db.get("runs", doc_id) is None
    assert seen == [
        "/collections/runs/docs/x%3Fadmin%3D1",
        "/collections/runs/docs/a%2Fb",
        "/collections/runs/docs/%252E%252E%252Fadmin",
        "/collections/runs/docs/a%23b",
    ]
    for doc_id in ["", ".", ".."]:
        with pytest.raises(ValueError):
            await db.get("runs", doc_id)
    await db.aclose()


async def test_blazemeter_ids_must_be_numbers():
    _, transport = recording(httpx.Response(200, json={"result": {}}))
    bm = BlazeMeterClient("http://bm", "id", "secret", transport)
    with pytest.raises(ValueError):
        await bm.status("1/stop")
    await bm.aclose()


@pytest.mark.parametrize("path", ["/api/runs/r_seed0001%3Fjunk", "/api/runs/%2E%2E", "/api/services/ticket-triage%3Fx/leaderboard"])
async def test_malformed_ids_in_the_path_are_rejected(system, path):
    assert (await system.client.get(path)).status_code == 422


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"service_id": "ticket-triage?x"}, ["service_id"]),
        ({"routing": {"mode": "fixed", "offering_ids": ["../x"]}}, ["routing", "offering_ids", 0]),
        ({"load_profile_id": "smoke/../x"}, ["load_profile_id"]),
        ({"routing": {"mode": "auto", "pool": [f"o{i}" for i in range(101)]}}, ["routing", "pool"]),
    ],
)
async def test_malformed_ids_and_oversized_pools_in_a_new_run_are_rejected(system, change, field):
    body = {"service_id": "ticket-triage", "routing": {"mode": "auto"}, "load_profile_id": "smoke", **change}
    res = await system.client.post("/api/runs", json=body)
    assert res.status_code == 422 and res.json()["detail"][0]["loc"] == ["body", *field], res.text


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
