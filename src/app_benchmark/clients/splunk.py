"""Client for the Splunk REST search API: create a job, wait for it, page through results."""

import asyncio
import time
from typing import Any

import httpx

from .errors import UpstreamError, segment


class SplunkError(UpstreamError):
    system = "Splunk"


class SplunkClient:
    def __init__(self, base_url: str, token: str, transport: httpx.AsyncBaseTransport | None = None):
        self._http = httpx.AsyncClient(base_url=base_url, transport=transport, headers={"Authorization": f"Bearer {token}"}, timeout=30.0)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _call(self, method: str, path: str, what: str, **kw) -> Any:
        try:
            res = await self._http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise SplunkError(f"Splunk {what} failed: {e}") from e
        if res.is_error:
            raise SplunkError(f"Splunk {what} failed: {res.status_code} {res.text[:200]}", status=res.status_code)
        try:
            return res.json()
        except ValueError as e:
            raise SplunkError(f"Splunk {what} failed: not JSON", "Splunk sent an invalid response") from e

    async def create_job(self, search: str) -> str:
        return (await self._call("POST", "/services/search/jobs", "search job", data={"search": search, "output_mode": "json"}))["sid"]

    async def wait(self, sid: str, poll_s: float, timeout_s: float) -> int:
        deadline = time.monotonic() + timeout_s
        while True:
            body = await self._call("GET", f"/services/search/jobs/{segment(sid)}", f"job {sid} status", params={"output_mode": "json"})
            content = body["entry"][0]["content"]
            if content["dispatchState"] == "FAILED":
                raise SplunkError(f"Splunk job {sid} failed", "Splunk search job failed")
            if content["isDone"]:
                return int(content["resultCount"])
            if time.monotonic() > deadline:
                raise SplunkError(f"Splunk job {sid} timed out after {timeout_s:.0f}s", f"Splunk search timed out after {timeout_s:.0f}s")
            await asyncio.sleep(poll_s)

    async def results(self, sid: str, page: int = 5000) -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
        while True:
            params = {"output_mode": "json", "count": page, "offset": len(rows)}
            path = f"/services/search/jobs/{segment(sid)}/results"
            batch = (await self._call("GET", path, f"results for {sid}", params=params))["results"]
            rows.extend(batch)
            if len(batch) < page:
                return rows

    async def search(self, search: str, poll_s: float, timeout_s: float) -> tuple[str, list[dict[str, Any]]]:
        sid = await self.create_job(search)
        await self.wait(sid, poll_s, timeout_s)
        return sid, await self.results(sid)
