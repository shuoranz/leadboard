"""Client for the BlazeMeter v4 REST API (tests, masters, reports)."""

from typing import Any

import httpx


class BlazeMeterError(RuntimeError):
    pass


class BlazeMeterClient:
    def __init__(self, base_url: str, key_id: str, key_secret: str, transport: httpx.AsyncBaseTransport | None = None):
        self._http = httpx.AsyncClient(base_url=base_url, transport=transport, auth=(key_id, key_secret), timeout=30.0)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _call(self, method: str, path: str, **kw) -> Any:
        try:
            res = await self._http.request(method, f"/api/v4{path}", **kw)
            body = res.json()
        except (httpx.HTTPError, ValueError) as e:
            raise BlazeMeterError(f"BlazeMeter {method} {path} failed: {e}") from e
        if res.is_error or body.get("error"):
            err = body.get("error") or {}
            raise BlazeMeterError(f"BlazeMeter {method} {path} -> {res.status_code}: {err.get('message', res.text[:200])}")
        return body["result"]

    async def create_test(
        self,
        name: str,
        project_id: str,
        target_url: str,
        headers: dict[str, str],
        concurrency: int,
        ramp_up_s: int,
        hold_for_s: int,
        think_time_s: float,
    ) -> dict[str, Any]:
        return await self._call(
            "POST",
            "/tests",
            json={
                "name": name,
                "projectId": project_id,
                "configuration": {"type": "http", "targetUrl": target_url, "method": "POST", "headers": headers},
                "overrideExecutions": [
                    {
                        "concurrency": concurrency,
                        "rampUp": f"{ramp_up_s}s",
                        "holdFor": f"{hold_for_s}s",
                        "thinkTime": think_time_s,
                    }
                ],
            },
        )

    async def start(self, test_id: int) -> dict[str, Any]:
        return await self._call("POST", f"/tests/{test_id}/start")

    async def status(self, master_id: int) -> dict[str, Any]:
        return await self._call("GET", f"/masters/{master_id}/status")

    async def stop(self, master_id: int) -> Any:
        return await self._call("POST", f"/masters/{master_id}/stop")

    async def summary(self, master_id: int) -> dict[str, Any]:
        return (await self._call("GET", f"/masters/{master_id}/reports/default/summary"))["summary"][0]

    async def timeline(self, master_id: int) -> dict[str, Any]:
        return await self._call("GET", f"/masters/{master_id}/reports/timeline/kpis")
