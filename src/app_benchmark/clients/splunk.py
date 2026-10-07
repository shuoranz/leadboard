"""Client for the Splunk REST search API: create a job, wait for it, page through results."""

import asyncio
import time
from typing import Any

import httpx


class SplunkError(RuntimeError):
    pass


class SplunkClient:
    def __init__(self, base_url: str, token: str, transport: httpx.AsyncBaseTransport | None = None):
        self._http = httpx.AsyncClient(base_url=base_url, transport=transport, headers={"Authorization": f"Bearer {token}"}, timeout=30.0)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def create_job(self, search: str) -> str:
        res = await self._http.post("/services/search/jobs", data={"search": search, "output_mode": "json"})
        if res.is_error:
            raise SplunkError(f"Splunk search job failed: {res.status_code} {res.text[:200]}")
        return res.json()["sid"]

    async def wait(self, sid: str, poll_s: float, timeout_s: float) -> int:
        deadline = time.monotonic() + timeout_s
        while True:
            res = await self._http.get(f"/services/search/jobs/{sid}", params={"output_mode": "json"})
            if res.is_error:
                raise SplunkError(f"Splunk job {sid} status failed: {res.status_code}")
            content = res.json()["entry"][0]["content"]
            if content["dispatchState"] == "FAILED":
                raise SplunkError(f"Splunk job {sid} failed")
            if content["isDone"]:
                return int(content["resultCount"])
            if time.monotonic() > deadline:
                raise SplunkError(f"Splunk job {sid} timed out after {timeout_s:.0f}s")
            await asyncio.sleep(poll_s)

    async def results(self, sid: str, page: int = 5000) -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
        while True:
            res = await self._http.get(
                f"/services/search/jobs/{sid}/results", params={"output_mode": "json", "count": page, "offset": len(rows)}
            )
            if res.is_error:
                raise SplunkError(f"Splunk results for {sid} failed: {res.status_code}")
            batch = res.json()["results"]
            rows.extend(batch)
            if len(batch) < page:
                return rows

    async def search(self, search: str, poll_s: float, timeout_s: float) -> tuple[str, list[dict[str, Any]]]:
        sid = await self.create_job(search)
        await self.wait(sid, poll_s, timeout_s)
        return sid, await self.results(sid)
