"""The whole flow through the public API: start runs, watch them finish, read results and the leaderboard."""

import asyncio


async def wait_done(system, timeout=30):
    await asyncio.wait_for(system.orchestrator.idle(), timeout)


async def test_fixed_batch_and_auto_run_complete_with_both_sources(system):
    api = system.client
    custom = {"concurrency": 4, "ramp_up_s": 5, "duration_s": 40, "think_time_s": 1}
    fixed = await api.post(
        "/api/runs",
        json={
            "service_id": "summarize-profile",
            "routing": {"mode": "fixed", "offering_ids": ["aurora-api--aurora-4", "stratus--aurora-4"]},
            "load": custom,
            "label": "same LLM, two providers",
        },
    )
    assert fixed.status_code == 201, fixed.text
    batch = fixed.json()
    assert len(batch) == 2 and batch[0]["batch_id"] == batch[1]["batch_id"]
    assert {r["status"] for r in batch} == {"queued"}
    auto = await api.post("/api/runs", json={"service_id": "summarize-profile", "routing": {"mode": "auto"}, "load": custom})
    assert auto.status_code == 201, auto.text

    await wait_done(system)
    mine = {r["id"] for r in batch} | {auto.json()[0]["id"]}
    runs = [r for r in (await api.get("/api/runs", params={"service_id": "summarize-profile"})).json() if r["id"] in mine]
    assert len(runs) == 3
    assert {r["status"] for r in runs} == {"completed"}, [(r["status"], r["error"]) for r in runs]
    for r in runs:
        assert r["blazemeter"]["master_id"] and r["splunk"]["sid"] and r["headline"]["requests"] > 0
        res = (await api.get(f"/api/runs/{r['id']}/results")).json()
        assert res["blazemeter"]["summary"]["hits"] == res["splunk"]["events"]  # every request was logged
        assert res["perf"]["ttft_ms"]["p50"] > 0 and res["perf"]["e2e_ms"]["p50"] > 0

    auto_id = auto.json()[0]["id"]
    mix = (await api.get(f"/api/runs/{auto_id}/results")).json()["splunk"]["by_offering"]
    assert len(mix) > 2 and "cloudhaven--helix-2" not in {m["offering_id"] for m in mix}  # unavailable: never routed

    board = (await api.get("/api/services/summarize-profile/leaderboard")).json()
    assert board["profile"] == "custom"
    ids = {row["id"] for row in board["rows"]}
    assert {"aurora-api--aurora-4", "stratus--aurora-4", "auto"} <= ids
    # Raw logs are plain JSON lines on disk, one per request.
    auto_run = next(r for r in runs if r["id"] == auto_id)
    events = (system.data / "splunk" / "events" / f"{auto_id}.jsonl").read_text().splitlines()
    assert len(events) == auto_run["splunk"]["events"]


async def test_validation_errors(system):
    api = system.client
    base = {"service_id": "headline-rewrite", "load_profile_id": "smoke"}
    not_allowed = await api.post("/api/runs", json={**base, "routing": {"mode": "fixed", "offering_ids": ["stratus--aurora-4"]}})
    assert not_allowed.status_code == 422 and "Not available" in not_allowed.json()["detail"]
    empty = await api.post("/api/runs", json={**base, "routing": {"mode": "fixed", "offering_ids": []}})
    assert empty.status_code == 422
    unknown = await api.post("/api/runs", json={**base, "service_id": "nope", "routing": {"mode": "auto"}})
    assert unknown.status_code == 404
    bad_load = await api.post(
        "/api/runs",
        json={"service_id": "headline-rewrite", "routing": {"mode": "auto"}, "load": {"concurrency": 1, "ramp_up_s": 50, "duration_s": 20}},
    )
    assert bad_load.status_code == 422


async def test_cancel_queued_and_running(system):
    api = system.client
    long = {"concurrency": 3, "ramp_up_s": 0, "duration_s": 3000, "think_time_s": 1}
    created = (
        await api.post(
            "/api/runs",
            json={
                "service_id": "ticket-triage",
                "routing": {"mode": "fixed", "offering_ids": ["swiftserve--quanta-8b", "aurora-api--aurora-4-flash"]},
                "load": long,
            },
        )
    ).json()
    first, second = created
    assert (await api.post(f"/api/runs/{second['id']}/cancel")).json()["status"] == "cancelled"
    for _ in range(500):
        if (await api.get(f"/api/runs/{first['id']}")).json()["status"] == "running":
            break
        await asyncio.sleep(0.01)
    await asyncio.sleep(0.2)
    await api.post(f"/api/runs/{first['id']}/cancel")
    await wait_done(system)
    done = (await api.get(f"/api/runs/{first['id']}")).json()
    assert done["status"] == "cancelled" and done["headline"]["requests"] > 0  # partial results kept
    assert (await api.get(f"/api/runs/{first['id']}/results")).status_code == 200


async def test_catalog_and_services(system):
    api = system.client
    cat = (await api.get("/api/catalog")).json()
    assert {p["id"] for p in cat["providers"]} >= {"stratus", "cloudhaven"}
    offered_by = {o["provider_id"] for o in cat["offerings"] if o["llm_id"] == "gale-3"}
    assert offered_by == {"northwind-api", "cloudhaven"}  # one LLM, several providers
    services = (await api.get("/api/services")).json()
    assert services[0]["id"] == "summarize-profile"
    assert all("project_id" not in s for s in services)
    assert (await api.get("/api/services/summarize-profile")).json()["endpoint_path"] == "/v1/profile/summarize"
    assert len((await api.get("/api/load-profiles")).json()) == 3
