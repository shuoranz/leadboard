"""Drives runs: queued -> starting -> running -> collecting -> completed | failed | cancelled.

One worker per service runs its queue one at a time, so two tests never load the same service at
once. Every state change is written to the DB service, which is the only source of truth: after a
restart, ``resume()`` re-queues anything unfinished and keeps polling BlazeMeter masters that
were already running.
"""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

from ..clients.blazemeter import BlazeMeterClient
from ..clients.db import DbClient
from ..clients.splunk import SplunkClient
from ..schemas import ACTIVE_STATUSES, TERMINAL_STATUSES
from ..settings import Settings
from .aggregate import build_results, headline

log = logging.getLogger(__name__)


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class Orchestrator:
    def __init__(self, settings: Settings, db: DbClient, blazemeter: BlazeMeterClient, splunk: SplunkClient):
        self.s, self.db, self.bm, self.splunk = settings, db, blazemeter, splunk
        self._queues: dict[str, asyncio.Queue[str]] = {}
        self._workers: dict[str, asyncio.Task] = {}
        self._cancel: set[str] = set()

    # ---- queueing ---------------------------------------------------------------------------

    def enqueue(self, service_id: str, run_id: str) -> None:
        self._queues.setdefault(service_id, asyncio.Queue()).put_nowait(run_id)
        worker = self._workers.get(service_id)
        if worker is None or worker.done():
            self._workers[service_id] = asyncio.get_running_loop().create_task(self._worker(service_id))

    async def _worker(self, service_id: str) -> None:
        queue = self._queues[service_id]
        while not queue.empty():
            run_id = queue.get_nowait()
            try:
                await self._execute(run_id)
            except Exception:  # _execute records failures; this guards the worker itself
                log.exception("run %s crashed", run_id)

    async def resume(self) -> int:
        active = await self.db.query("runs", {"status": {"$in": list(ACTIVE_STATUSES)}}, sort=[("created_at", 1)])
        for run in active:
            self.enqueue(run["service_id"], run["id"])
        return len(active)

    async def idle(self) -> None:
        """Wait until every queue is drained (tests)."""
        while any(not w.done() for w in self._workers.values()):
            await asyncio.gather(*self._workers.values(), return_exceptions=True)

    async def cancel(self, run: dict[str, Any]) -> dict[str, Any]:
        if run["status"] in TERMINAL_STATUSES:
            return run
        if run["status"] == "queued":
            return await self._patch(run["id"], status="cancelled", cancel_requested=True, ended_at=now(), progress=0)
        self._cancel.add(run["id"])
        master = (run.get("blazemeter") or {}).get("master_id")
        if master:
            await self.bm.stop(master)
        return await self._patch(run["id"], cancel_requested=True)

    async def shutdown(self) -> None:
        for w in self._workers.values():
            w.cancel()
        await asyncio.gather(*self._workers.values(), return_exceptions=True)

    # ---- lifecycle --------------------------------------------------------------------------

    async def _patch(self, run_id: str, **fields: Any) -> dict[str, Any]:
        return await self.db.patch("runs", run_id, {**fields, "updated_at": now()})

    async def _execute(self, run_id: str) -> None:
        run = await self.db.get("runs", run_id)
        if not run or run["status"] in TERMINAL_STATUSES:
            return
        if run.get("cancel_requested") and run["status"] == "queued":
            await self._patch(run_id, status="cancelled", ended_at=now())
            return
        try:
            if run["status"] in ("queued", "starting") and not (run.get("blazemeter") or {}).get("master_id"):
                run = await self._start(run)
            if run["status"] in ("starting", "running"):
                run = await self._wait(run)
            await self._collect(run)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("run %s failed", run_id)
            await self._patch(run_id, status="failed", error=str(e)[:500], ended_at=now())
        finally:
            self._cancel.discard(run_id)

    async def _start(self, run: dict[str, Any]) -> dict[str, Any]:
        await self._patch(run["id"], status="starting", started_at=now(), progress=1)
        service = await self.db.get("services", run["service_id"])
        if not service:
            raise RuntimeError(f"Service {run['service_id']} no longer exists")
        routing = run["routing"]
        headers = {"X-Run-Id": run["id"], "X-Routing": routing["mode"]}
        if routing["mode"] == "fixed":
            headers["X-Offering-Id"] = routing["offering_id"]
        elif routing.get("pool"):
            headers["X-Model-Pool"] = ",".join(routing["pool"])
        load = run["load"]
        target = self.s.target_url_template.format(service_id=service["id"], endpoint_path=service["endpoint_path"])
        test = await self.bm.create_test(
            name=f"{service['name']} · {routing.get('offering_id') or 'auto'} · {load['name']} · {run['id']}",
            project_id=self.s.blazemeter_project_id,
            target_url=target,
            headers=headers,
            concurrency=load["concurrency"],
            ramp_up_s=load["ramp_up_s"],
            hold_for_s=load["duration_s"] - load["ramp_up_s"],
            think_time_s=load["think_time_s"],
        )
        master = await self.bm.start(test["id"])
        return await self._patch(
            run["id"],
            status="running",
            blazemeter={
                "test_id": test["id"],
                "master_id": master["id"],
                "report_url": master.get("publicTokenUrl"),
                "status": master.get("status"),
            },
        )

    async def _wait(self, run: dict[str, Any]) -> dict[str, Any]:
        master = run["blazemeter"]["master_id"]
        last = -1
        while True:
            st = await self.bm.status(master)
            if st["status"] == "ENDED":
                return await self._patch(run["id"], status="collecting", progress=92, blazemeter={**run["blazemeter"], "status": "ENDED"})
            progress = max(2, min(90, round(int(st.get("progress") or 0) * 0.9)))
            if progress != last:
                last = progress
                await self._patch(run["id"], progress=progress, blazemeter={**run["blazemeter"], "status": st["status"]})
            await asyncio.sleep(self.s.poll_interval_s)

    async def _collect(self, run: dict[str, Any]) -> None:
        master = run["blazemeter"]["master_id"]
        summary = await self.bm.summary(master)
        timeline = await self.bm.timeline(master)

        search = f"search index={self.s.splunk_index} run_id={run['id']}"
        search_url = f"{self.s.splunk_web_url}/en-US/app/search/search?q={quote(search)}"
        sid, events = await self.splunk.search(search, self.s.splunk_poll_interval_s, self.s.splunk_timeout_s)

        offerings = {o["id"]: o for o in await self.db.all("offerings")}
        results = build_results(
            run=run,
            bm_summary=summary,
            bm_timeline=timeline,
            events=events,
            offerings=offerings,
            stall_threshold_ms=self.s.stall_threshold_ms,
        )
        await self.db.put("run_results", run["id"], {"id": run["id"], **results})
        fresh = await self.db.get("runs", run["id"]) or run
        cancelled = fresh.get("cancel_requested") or run["id"] in self._cancel
        await self._patch(
            run["id"],
            status="cancelled" if cancelled else "completed",
            progress=100,
            ended_at=now(),
            splunk={"sid": sid, "search": search, "search_url": search_url, "events": len(events)},
            headline=headline(results),
        )
