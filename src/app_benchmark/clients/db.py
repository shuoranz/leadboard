"""Client for the DB service (a document store over HTTP). The app never touches files."""

from typing import Any

import httpx


class DbError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class DbClient:
    def __init__(self, base_url: str, api_key: str, transport: httpx.AsyncBaseTransport | None = None):
        self._http = httpx.AsyncClient(base_url=base_url, transport=transport, headers={"X-Api-Key": api_key}, timeout=10.0)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _call(self, method: str, path: str, **kw) -> Any:
        try:
            res = await self._http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise DbError(f"DB service unreachable: {e}") from e
        if res.status_code == 204:
            return None
        if res.is_error:
            raise DbError(f"DB {method} {path} -> {res.status_code}: {res.text[:200]}", res.status_code)
        return res.json()

    async def query(
        self,
        collection: str,
        filter: dict[str, Any] | None = None,
        sort: list[tuple[str, int]] | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        body = {"filter": filter or {}, "sort": sort or [], "limit": limit, "offset": offset}
        return (await self._call("POST", f"/collections/{collection}/query", json=body))["items"]

    async def all(self, collection: str) -> list[dict[str, Any]]:
        return (await self._call("GET", f"/collections/{collection}/docs"))["items"]

    async def get(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        try:
            return await self._call("GET", f"/collections/{collection}/docs/{doc_id}")
        except DbError as e:
            if e.status == 404:
                return None
            raise

    async def create(self, collection: str, doc: dict[str, Any]) -> dict[str, Any]:
        return await self._call("POST", f"/collections/{collection}/docs", json=doc)

    async def put(self, collection: str, doc_id: str, doc: dict[str, Any]) -> dict[str, Any]:
        return await self._call("PUT", f"/collections/{collection}/docs/{doc_id}", json=doc)

    async def patch(self, collection: str, doc_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        return await self._call("PATCH", f"/collections/{collection}/docs/{doc_id}", json=patch)
