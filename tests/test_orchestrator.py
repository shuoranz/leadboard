"""Run lifecycle edge cases: cancelling at each step, BlazeMeter failures, and Splunk indexing lag."""

import asyncio

import httpx
import pytest

from app_benchmark.clients.blazemeter import BlazeMeterError
from app_benchmark.clients.splunk import SplunkClient, SplunkError
from benchmark_fakes.blazemeter import app as bm_mod

LONG = {"concurrency": 3, "ramp_up_s": 0, "duration_s": 3000, "think_time_s": 1}
SHORT = {"concurrency": 2, "ramp_up_s": 0, "duration_s": 20, "think_time_s": 1}


async def start(api, load=LONG, offering="swiftserve--quanta-8b"):
    body = {"service_id": "ticket-triage", "routing": {"mode": "fixed", "offering_ids": [offering]}, "load": load}
    res = await api.post("/api/runs", json=body)
    assert res.status_code == 201, res.text
    return res.json()[0]["id"]


async def get(api, run_id):
    return (await api.get(f"/api/runs/{run_id}")).json()


async def until(api, run_id, status, tries=500):
    for _ in range(tries):
        if (await get(api, run_id))["status"] == status:
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"run {run_id} never reached {status}")


def gate(monkeypatch, obj, name, when=lambda *a, **kw: True):
    """Make obj.name pause (after doing its work) until the returned event is set."""
    original, entered, release = getattr(obj, name), asyncio.Event(), asyncio.Event()

    async def wrapper(*args, **kwargs):
        result = await original(*args, **kwargs)
        if when(*args, **kwargs) and not release.is_set():
            entered.set()
            await release.wait()
        return result

    monkeypatch.setattr(obj, name, wrapper)
    return entered, release


async def test_cancel_while_starting_never_creates_the_test(system, monkeypatch):
    orch, api = system.orchestrator, system.client
    entered, release = gate(monkeypatch, orch.db, "patch", lambda _c, _id, patch: patch.get("status") == "starting")
    tests_before = len(bm_mod._tests)
    run_id = await start(api)
    await asyncio.wait_for(entered.wait(), 5)
    assert (await api.post(f"/api/runs/{run_id}/cancel")).json()["cancel_requested"] is True
    release.set()
    await asyncio.wait_for(orch.idle(), 5)
    assert (await get(api, run_id))["status"] == "cancelled"
    assert len(bm_mod._tests) == tests_before  # BlazeMeter was never asked to create a test


async def test_cancel_while_the_test_is_being_created_stops_it_once_it_exists(system, monkeypatch):
    orch, api = system.orchestrator, system.client
    entered, release = gate(monkeypatch, orch.bm, "create_test")
    run_id = await start(api)
    await asyncio.wait_for(entered.wait(), 5)
    await api.post(f"/api/runs/{run_id}/cancel")
    release.set()
    # The test is 3000 nominal seconds (15 s real); stopping it ends the run long before that.
    await asyncio.wait_for(orch.idle(), 5)
    run = await get(api, run_id)
    assert run["status"] == "cancelled"
    assert bm_mod._masters[run["blazemeter"]["master_id"]].aborted


async def test_cancel_after_the_test_ended_keeps_the_results(system):
    run = {"id": "r_x", "status": "collecting"}
    assert await system.orchestrator.cancel(run) is run
    assert "r_x" not in system.orchestrator._cancel


async def test_failure_while_running_stops_the_load_test(system, monkeypatch):
    orch, api = system.orchestrator, system.client

    async def down(master_id):
        raise BlazeMeterError("BlazeMeter GET status failed: connection reset")

    run_id = await start(api)
    await until(api, run_id, "running")
    monkeypatch.setattr(orch.bm, "status", down)
    await asyncio.wait_for(orch.idle(), 5)
    run = await get(api, run_id)
    assert run["status"] == "failed" and run["error"] == "BlazeMeter is unreachable"  # the details are only logged
    assert bm_mod._masters[run["blazemeter"]["master_id"]].stop  # no orphaned load on the service


async def test_brief_status_errors_are_retried(system, monkeypatch):
    orch, api = system.orchestrator, system.client
    original, calls = orch.bm.status, {"n": 0}

    async def flaky(master_id):
        calls["n"] += 1
        if calls["n"] <= 2:
            raise BlazeMeterError("BlazeMeter GET status failed: 502")
        return await original(master_id)

    monkeypatch.setattr(orch.bm, "status", flaky)
    run_id = await start(api, SHORT)
    await asyncio.wait_for(orch.idle(), 10)
    assert (await get(api, run_id))["status"] == "completed"


async def test_a_test_that_never_ends_fails_past_the_deadline(system, monkeypatch):
    orch, api = system.orchestrator, system.client

    async def stuck(master_id):
        return {"status": "RUNNING", "progress": 50}

    monkeypatch.setattr(orch.bm, "status", stuck)
    monkeypatch.setattr(orch.s, "wait_grace_s", -19.9)  # 20 s nominal duration + grace = 0.1 s
    run_id = await start(api, SHORT)
    await asyncio.wait_for(orch.idle(), 5)
    run = await get(api, run_id)
    assert run["status"] == "failed" and "past its planned duration" in run["error"]
    assert bm_mod._masters[run["blazemeter"]["master_id"]].stop


async def test_a_test_with_no_requests_fails_instead_of_completing(system, monkeypatch):
    orch, api = system.orchestrator, system.client
    original = orch.bm.summary

    async def empty(master_id):
        return {**(await original(master_id)), "hits": 0, "failed": 0}

    monkeypatch.setattr(orch.bm, "summary", empty)
    run_id = await start(api, SHORT)
    await asyncio.wait_for(orch.idle(), 10)
    run = await get(api, run_id)
    assert run["status"] == "failed" and "no requests" in run["error"]
    assert (await api.get(f"/api/runs/{run_id}/results")).status_code == 409
    board = (await api.get("/api/services/ticket-triage/leaderboard", params={"profile": "custom"})).json()
    assert run_id not in {row["run_id"] for row in board["rows"]}


async def test_finished_masters_are_forgotten_by_the_engine(system):
    await start(system.client, SHORT)
    await asyncio.wait_for(system.orchestrator.idle(), 10)
    await asyncio.sleep(0)
    assert not bm_mod._tasks


@pytest.mark.parametrize(("found", "calls", "kept"), [([5, 10], 2, 10), ([5, 6, 7], 3, 7), ([10], 1, 10)])
async def test_log_search_waits_for_splunk_to_catch_up(system, monkeypatch, found, calls, kept):
    orch, seen = system.orchestrator, []

    async def search(q, poll_s, timeout_s):
        n = found[len(seen)]
        seen.append(n)
        return f"sid{len(seen)}", [{}] * n

    monkeypatch.setattr(orch.splunk, "search", search)
    sid, events = await orch._search_logs("search run_id=r", expected=10)
    assert len(seen) == calls and len(events) == kept and sid == f"sid{calls}"


async def test_a_cancel_that_lands_after_the_test_ended_keeps_it_completed(system, monkeypatch):
    orch, api = system.orchestrator, system.client
    entered, release = gate(monkeypatch, orch.bm, "summary")  # collecting has begun
    run_id = await start(api, SHORT)
    await asyncio.wait_for(entered.wait(), 10)
    # The API read the run a moment earlier, while it still said "running".
    stale = {**(await get(api, run_id)), "status": "running"}
    await orch.cancel(stale)
    release.set()
    await asyncio.wait_for(orch.idle(), 10)
    run = await get(api, run_id)
    assert run["status"] == "completed" and run["headline"]["requests"] > 0


async def test_a_failed_stop_is_retried_and_the_cancel_is_not_lost(system, monkeypatch):
    orch, api = system.orchestrator, system.client
    original, calls = orch.bm.stop, {"n": 0}

    async def flaky_stop(master_id):
        calls["n"] += 1
        if calls["n"] <= 2:  # the API's own attempt, then the worker's first
            raise BlazeMeterError("BlazeMeter POST stop failed: 503")
        return await original(master_id)

    monkeypatch.setattr(orch.bm, "stop", flaky_stop)
    run_id = await start(api)
    await until(api, run_id, "running")
    cancelled = await api.post(f"/api/runs/{run_id}/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["cancel_requested"] is True
    await asyncio.wait_for(orch.idle(), 5)  # 3000 nominal s = 15 s real if the stop never got through
    run = await get(api, run_id)
    assert run["status"] == "cancelled" and calls["n"] == 3
    assert bm_mod._masters[run["blazemeter"]["master_id"]].aborted


async def test_collecting_rides_out_a_brief_splunk_outage(system, monkeypatch):
    orch, api = system.orchestrator, system.client
    original, calls = orch.splunk.search, {"n": 0}

    async def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] <= 2:
            raise SplunkError("Splunk search job failed: 503")
        return await original(*args, **kwargs)

    monkeypatch.setattr(orch.splunk, "search", flaky)
    run_id = await start(api, SHORT)
    await asyncio.wait_for(orch.idle(), 10)
    run = await get(api, run_id)
    assert run["status"] == "completed" and run["headline"]["requests"] > 0 and calls["n"] == 3


async def test_collecting_fails_once_the_outage_outlasts_the_retries(system, monkeypatch):
    orch, api = system.orchestrator, system.client
    calls = {"n": 0}

    async def down(*args, **kwargs):
        calls["n"] += 1
        raise SplunkError("Splunk search job failed: connection refused")

    monkeypatch.setattr(orch.splunk, "search", down)
    monkeypatch.setattr(orch.s, "collect_retries", 2)
    run_id = await start(api, SHORT)
    await asyncio.wait_for(orch.idle(), 10)
    run = await get(api, run_id)
    assert run["status"] == "failed" and calls["n"] == 3
    assert run["error"] == "Couldn't collect results after 3 attempts: Splunk is unreachable"


async def test_a_test_with_no_requests_is_not_retried(system, monkeypatch):
    orch, api = system.orchestrator, system.client
    original, calls = orch.bm.summary, {"n": 0}

    async def empty(master_id):
        calls["n"] += 1
        return {**(await original(master_id)), "hits": 0, "failed": 0}

    monkeypatch.setattr(orch.bm, "summary", empty)
    run_id = await start(api, SHORT)
    await asyncio.wait_for(orch.idle(), 10)
    assert (await get(api, run_id))["status"] == "failed" and calls["n"] == 1


async def test_splunk_connection_errors_are_splunk_errors():
    def refuse(request):
        raise httpx.ConnectError("connection refused")

    client = SplunkClient("http://splunk", "t", httpx.MockTransport(refuse))
    with pytest.raises(SplunkError, match="connection refused") as e:
        await client.search("search x", 0, 1)
    assert e.value.public == "Splunk is unreachable"
    await client.aclose()


async def test_an_unexpected_failure_is_not_described_to_users(system, monkeypatch):
    orch, api = system.orchestrator, system.client

    async def broken(master_id):
        raise KeyError("summary")  # e.g. a report in a shape we don't expect

    monkeypatch.setattr(orch.bm, "summary", broken)
    run_id = await start(api, SHORT)
    await asyncio.wait_for(orch.idle(), 10)
    run = await get(api, run_id)
    assert run["status"] == "failed" and run["error"] == "Internal error (details are in the API logs)"
