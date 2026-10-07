"""Contract tests for each fake service on its own."""

import asyncio
import json
import os

from benchmark_fakes.splunk.app import parse_search


async def test_db_crud_query_and_persistence(fake_clients, fake_data):
    db = fake_clients.db
    assert "offerings" in (await db.get("/collections")).json()
    created = (await db.post("/collections/scratch/docs", json={"status": "queued", "n": 2})).json()
    rid = created["id"]
    await db.post("/collections/scratch/docs", json={"id": "x1", "status": "done", "n": 1})
    assert (await db.post("/collections/scratch/docs", json={"id": "x1"})).status_code == 409
    patched = (await db.patch(f"/collections/scratch/docs/{rid}", json={"status": "running"})).json()
    assert patched == {"id": rid, "status": "running", "n": 2}
    q = (await db.post("/collections/scratch/query", json={"filter": {"status": {"$in": ["running"]}}})).json()
    assert [d["id"] for d in q["items"]] == [rid]
    by_n = (await db.post("/collections/scratch/query", json={"sort": [["n", 1]]})).json()["items"]
    assert [d["id"] for d in by_n] == ["x1", rid]
    on_disk = json.loads((fake_data / "db" / "scratch.json").read_text())
    assert {d["id"] for d in on_disk} == {rid, "x1"}
    assert (await db.delete(f"/collections/scratch/docs/{rid}")).status_code == 204
    assert (await db.get(f"/collections/scratch/docs/{rid}")).status_code == 404
    assert (await db.get("/collections/Bad-Name/docs")).status_code == 400


async def test_splunk_ingest_and_search_return_strings(fake_clients):
    sp = fake_clients.splunk
    body = "\n".join(
        json.dumps({"time": 1.5, "index": "llm_api", "event": {"run_id": "r9", "ttft_ms": 12.5, "status": s}}) for s in ("ok", "error")
    )
    assert (await sp.post("/services/collector/event", content=body)).status_code == 401
    ack = await sp.post("/services/collector/event", content=body, headers={"Authorization": "Splunk t"})
    assert ack.json()["text"] == "Success"
    sid = (await sp.post("/services/search/jobs", data={"search": "search index=llm_api run_id=r9 status=ok"})).json()["sid"]
    await asyncio.sleep(0.03)
    content = (await sp.get(f"/services/search/jobs/{sid}")).json()["entry"][0]["content"]
    assert content["dispatchState"] == "DONE" and content["resultCount"] == 1
    row = (await sp.get(f"/services/search/jobs/{sid}/results", params={"count": 0})).json()["results"][0]
    assert row["ttft_ms"] == "12.5" and row["index"] == "llm_api"


def test_search_parser():
    assert parse_search('search index=llm_api run_id="r 1" | stats count') == {"index": "llm_api", "run_id": "r 1"}


async def test_blazemeter_requires_auth_and_validates(fake_clients):
    bm = fake_clients.bm
    assert (await bm.post("/api/v4/tests", json={}, auth=None)).status_code == 401
    res = await bm.post("/api/v4/tests", json={"configuration": {}})
    assert res.status_code == 400 and res.json()["error"]["message"]
    assert (await bm.get("/api/v4/masters/1/status")).json()["error"]["code"] == 404


async def test_target_service_routes_and_rejects_unknown(fake_clients):
    t = fake_clients.target
    fixed = await t.post("/svc/summarize-profile/invoke", headers={"X-Offering-Id": "stratus--aurora-4", "X-Run-Id": "t1"})
    assert fixed.json()["model"]["provider"] == "stratus"
    assert (await t.post("/svc/summarize-profile/invoke", headers={"X-Offering-Id": "nope"})).status_code == 400
    assert (await t.post("/svc/nope/invoke")).status_code == 404
    down = await t.post("/svc/summarize-profile/invoke", headers={"X-Offering-Id": "cloudhaven--helix-2"})
    assert down.status_code == 503
    seen = set()
    for _ in range(40):
        r = await t.post("/svc/headline-rewrite/invoke", headers={"X-Routing": "auto", "X-Run-Id": "t2"})
        seen.add(r.json()["model"]["offering_id"])
    assert len(seen) > 2  # random per request, within the service's allowed offerings
    assert "stratus--aurora-4" not in seen


async def test_db_sorts_numbers_as_numbers(fake_clients):
    db = fake_clients.db
    for doc_id, n in (("a", 10), ("b", 9), ("c", None), ("d", "x"), ("e", 2.5)):
        await db.post("/collections/numbers/docs", json={"id": doc_id, "n": n})
    asc = (await db.post("/collections/numbers/query", json={"sort": [["n", 1]]})).json()["items"]
    assert [d["id"] for d in asc] == ["c", "e", "b", "a", "d"]
    desc = (await db.post("/collections/numbers/query", json={"sort": [["n", -1]]})).json()["items"]
    assert [d["id"] for d in desc] == ["d", "a", "b", "e", "c"]


def test_target_service_rereads_config_only_when_a_file_changes(fake_data):
    from benchmark_fakes.target_service import app as target_mod

    first = target_mod._config()
    assert target_mod._config() is first
    profiles = fake_data / "profiles" / "offering_profiles.json"
    data = json.loads(profiles.read_text())
    data["offerings"]["stratus--aurora-4"]["ttft_base_ms"] = 1
    profiles.write_text(json.dumps(data))
    os.utime(profiles, ns=(profiles.stat().st_atime_ns, profiles.stat().st_mtime_ns + 1_000_000))
    assert target_mod._config()["profiles"]["offerings"]["stratus--aurora-4"]["ttft_base_ms"] == 1


def test_target_service_keeps_only_recent_run_rngs(fake_data):
    from benchmark_fakes.target_service import app as target_mod

    first = target_mod._rng("r0")
    assert target_mod._rng("r0") is first  # one reproducible stream per run
    for i in range(1, target_mod.MAX_RUN_RNGS + 10):
        target_mod._rng(f"r{i}")
    assert len(target_mod._rngs) == target_mod.MAX_RUN_RNGS and "r0" not in target_mod._rngs


async def test_splunk_search_jobs_expire_after_their_last_access(fake_clients, monkeypatch):
    sp = fake_clients.splunk
    monkeypatch.setenv("SPLUNK_JOB_TTL_S", "0.1")
    sid = (await sp.post("/services/search/jobs", data={"search": "search run_id=r1"})).json()["sid"]
    for _ in range(3):  # paging through results keeps the job alive past its TTL from creation
        await asyncio.sleep(0.06)
        assert (await sp.get(f"/services/search/jobs/{sid}")).status_code == 200
    await asyncio.sleep(0.15)
    assert (await sp.get(f"/services/search/jobs/{sid}")).status_code == 404
