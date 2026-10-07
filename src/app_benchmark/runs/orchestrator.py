"""Drives runs: queued -> starting -> running -> collecting -> completed | failed | cancelled.

One worker per service runs its queue one at a time, so two tests never load the same service at
once. Every state change is written to the DB service, which is the only source of truth: after a
restart, ``resume()`` re-queues anything unfinished and keeps polling BlazeMeter masters that
were already running.

A cancel is honoured at whichever step the run is in: before the BlazeMeter test exists (it is
never started), while it runs (it is stopped and keeps partial results), but not once the test
has ended (its results are being collected and are kept). A run that fails while its test is
still generating load stops that test first, so the next queued run never overlaps it.
"""

import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

from ..clients.blazemeter import BlazeMeterClient, BlazeMeterError
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
        #: run id -> BlazeMeter master still generating load for it.
        self._live: dict[str, int] = {}

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
        if run["status"] in TERMINAL_STATUSES or run["status"] == "collecting":
            return run  # finished, or the test already ended and its results are on the way
        self._cancel.add(run["id"])
        if run["status"] == "queued":
            return await self._patch(run["id"], status="cancelled", cancel_requested=True, ended_at=now(), progress=0)
        # Recorded first, so a cancel survives a failed stop call or a restart: _start and _wait
        # see the flag and (re)send the stop themselves. Stopping here only saves a poll interval.
        patched = await self._patch(run["id"], cancel_requested=True)
        master = (run.get("blazemeter") or {}).get("master_id")
        if master:
            try:
                await self.bm.stop(master)
            except BlazeMeterError as e:
                log.warning("run %s: stop failed, the worker will retry: %s", run["id"], e)
        return patched

    async def shutdown(self) -> None:
        for w in self._workers.values():
            w.cancel()
        await asyncio.gather(*self._workers.values(), return_exceptions=True)

    # ---- lifecycle --------------------------------------------------------------------------

    async def _patch(self, run_id: str, **fields: Any) -> dict[str, Any]:
        return await self.db.patch("runs", run_id, {**fields, "updated_at": now()})

    def _cancel_wanted(self, run: dict[str, Any]) -> bool:
        return run["id"] in self._cancel or bool(run.get("cancel_requested"))

    async def _execute(self, run_id: str) -> None:
        try:
            run = await self.db.get("runs", run_id)
            if not run or run["status"] in TERMINAL_STATUSES:
                return
            if self._cancel_wanted(run) and not (run.get("blazemeter") or {}).get("master_id"):
                await self._patch(run_id, status="cancelled", ended_at=now())  # no load was ever generated
                return
            try:
                if not (run.get("blazemeter") or {}).get("master_id"):
                    run = await self._start(run)
                    if run is None:
                        return
                if run["status"] in ("starting", "running"):
                    run = await self._wait(run)
                await self._collect(run)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.exception("run %s failed", run_id)
                await self._stop_load(run_id)
                await self._patch(run_id, status="failed", error=str(e)[:500], ended_at=now())
        finally:
            self._cancel.discard(run_id)
            self._live.pop(run_id, None)

    async def _stop_load(self, run_id: str) -> None:
        """Stop a test that is still generating load for a run that won't use it."""
        master = self._live.pop(run_id, None)
        if master is None:
            return
        try:
            await self.bm.stop(master)
        except Exception:
            log.exception("could not stop BlazeMeter master %s of run %s", master, run_id)

    async def _start(self, run: dict[str, Any]) -> dict[str, Any] | None:
        run = await self._patch(run["id"], status="starting", started_at=now(), progress=1)
        if self._cancel_wanted(run):
            await self._patch(run["id"], status="cancelled", ended_at=now())
            return None
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
        self._live[run["id"]] = master["id"]
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
        """Poll the test until it ends: stop it on cancel, ride out brief BlazeMeter errors, give up past the deadline."""
        master = run["blazemeter"]["master_id"]
        self._live[run["id"]] = master
        deadline = time.monotonic() + run["load"]["duration_s"] + self.s.wait_grace_s
        last, failures, stop_failures, stop_sent = -1, 0, 0, False
        while True:
            if not stop_sent and self._cancel_wanted(run):
                try:
                    await self.bm.stop(master)
                    stop_sent = True
                except BlazeMeterError as e:
                    stop_failures += 1
                    if stop_failures > self.s.poll_retries:
                        raise
                    log.warning("run %s: stop %d failed: %s", run["id"], stop_failures, e)
            try:
                st = await self.bm.status(master)
                failures = 0
            except BlazeMeterError as e:
                failures += 1
                if failures > self.s.poll_retries:
                    raise
                log.warning("run %s: status poll %d failed: %s", run["id"], failures, e)
                await asyncio.sleep(self.s.poll_interval_s)
                continue
            if st["status"] == "ENDED":
                self._live.pop(run["id"], None)
                # Decided now, once: a cancel that lands after this is too late to change the outcome.
                stopped_early = stop_sent or self._cancel_wanted(run)
                return await self._patch(
                    run["id"],
                    status="collecting",
                    progress=92,
                    stopped_early=stopped_early,
                    blazemeter={**run["blazemeter"], "status": "ENDED"},
                )
            if time.monotonic() > deadline:
                raise RuntimeError(f"BlazeMeter test {master} is still {st['status']} {self.s.wait_grace_s:.0f}s past its planned duration")
            progress = max(2, min(90, round(int(st.get("progress") or 0) * 0.9)))
            if progress != last:
                last = progress
                run = await self._patch(run["id"], progress=progress, blazemeter={**run["blazemeter"], "status": st["status"]})
            await asyncio.sleep(self.s.poll_interval_s)

    async def _search_logs(self, search: str, expected: int) -> tuple[str, list[dict[str, Any]]]:
        """Splunk indexes with a lag: settle first, and search again while too few requests have shown up."""
        sid, events = "", []
        for attempt in range(1, max(1, self.s.splunk_attempts) + 1):
            await asyncio.sleep(self.s.splunk_settle_s)
            sid, events = await self.splunk.search(search, self.s.splunk_poll_interval_s, self.s.splunk_timeout_s)
            if len(events) >= expected * self.s.splunk_min_coverage:
                break
            log.info("%s: %d of %d requests indexed (attempt %d)", search, len(events), expected, attempt)
        return sid, events

    async def _collect(self, run: dict[str, Any]) -> None:
        master = run["blazemeter"]["master_id"]
        summary = await self.bm.summary(master)
        timeline = await self.bm.timeline(master)
        if "stopped_early" in run:
            cancelled = bool(run["stopped_early"])
        else:  # a run that was already collecting before stopped_early was recorded
            cancelled = self._cancel_wanted(await self.db.get("runs", run["id"]) or run)
        hits = int(summary.get("hits") or 0)
        if not hits:
            # Nothing to rank, e.g. the BlazeMeter engine died before sending load.
            if cancelled:
                await self._patch(run["id"], status="cancelled", progress=100, ended_at=now())
                return
            raise RuntimeError("BlazeMeter recorded no requests: the test ended before generating any load")

        search = f"search index={self.s.splunk_index} run_id={run['id']}"
        search_url = f"{self.s.splunk_web_url}/en-US/app/search/search?q={quote(search)}"
        sid, events = await self._search_logs(search, hits)

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
        await self._patch(
            run["id"],
            status="cancelled" if cancelled else "completed",
            progress=100,
            ended_at=now(),
            splunk={"sid": sid, "search": search, "search_url": search_url, "events": len(events)},
            headline=headline(results),
        )
