"""Fake "database as a service": a tiny document store over HTTP.

Each collection is a JSON file, ``fake_data/db/<collection>.json``, holding a list of documents
with an ``id``. On first boot (or ``POST /admin/reset``) collections are copied from
``fake_data/seed/``. Clients never touch the files — they call this API.

    GET    /collections                         -> ["projects", ...]
    GET    /collections/{c}/docs?limit&offset   -> {"items": [...], "total": n}
    POST   /collections/{c}/docs                -> 201 doc (id generated when absent)
    GET    /collections/{c}/docs/{id}           -> doc | 404
    PUT    /collections/{c}/docs/{id}           -> doc (replace / upsert)
    PATCH  /collections/{c}/docs/{id}           -> doc (shallow merge)
    DELETE /collections/{c}/docs/{id}           -> 204
    POST   /collections/{c}/query               -> {"items": [...], "total": n}
           body: {"filter": {"field": value | {"$in": [...]} | {"$ne": v}}, "sort": [["field", -1]], "limit": n, "offset": n}
"""

import re
import shutil
import threading
import uuid
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

from ..common.jsonstore import read_json, write_json
from ..common.paths import data_dir

NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_lock = threading.Lock()
_cache: dict[str, list[dict[str, Any]]] = {}
_seeded = False


def _db_dir():
    return data_dir() / "db"


def seed(force: bool = False) -> list[str]:
    """Copy seed/<c>.json into db/ for every collection that doesn't exist yet (all, when forced)."""
    global _seeded
    seeded = []
    db = _db_dir()
    db.mkdir(parents=True, exist_ok=True)
    for src in sorted((data_dir() / "seed").glob("*.json")):
        dest = db / src.name
        if force or not dest.exists():
            shutil.copyfile(src, dest)
            seeded.append(src.stem)
    _cache.clear()
    _seeded = True
    return seeded


def _load(collection: str) -> list[dict[str, Any]]:
    if not _seeded:
        seed()  # lazily, so in-process test transports (no lifespan) work too
    if not NAME.match(collection):
        raise HTTPException(400, f"Bad collection name {collection!r}")
    if collection not in _cache:
        _cache[collection] = read_json(_db_dir() / f"{collection}.json", default=[])
    return _cache[collection]


def _save(collection: str) -> None:
    write_json(_db_dir() / f"{collection}.json", _cache[collection])


def _find(docs: list[dict], doc_id: str) -> int:
    return next((i for i, d in enumerate(docs) if d.get("id") == doc_id), -1)


def _matches(doc: dict, flt: dict[str, Any]) -> bool:
    for key, cond in flt.items():
        value = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and value not in cond["$in"]:
                return False
            if "$ne" in cond and value == cond["$ne"]:
                return False
        elif value != cond:
            return False
    return True


def _sort_key(field: str):
    """None sorts first ascending; numbers compare as numbers, then everything else as strings."""

    def key(d: dict) -> tuple:
        v = d.get(field)
        if v is None:
            return (0, 0, "")
        if isinstance(v, int | float) and not isinstance(v, bool):
            return (1, 0, v)
        return (1, 1, str(v))

    return key


class Query(BaseModel):
    filter: dict[str, Any] = Field(default_factory=dict)
    sort: list[tuple[str, int]] = Field(default_factory=list)
    limit: int | None = None
    offset: int = 0


def _page(items: list[dict], limit: int | None, offset: int) -> dict:
    end = None if limit is None else offset + limit
    return {"items": items[offset:end], "total": len(items)}


app = FastAPI(title="Fake DB service", version="1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "data_dir": str(_db_dir())}


@app.post("/admin/reset")
def reset() -> dict:
    with _lock:
        return {"seeded": seed(force=True)}


@app.get("/collections")
def collections() -> list[str]:
    _load("services")
    return sorted(p.stem for p in _db_dir().glob("*.json"))


@app.get("/collections/{collection}/docs")
def list_docs(collection: str, limit: int | None = None, offset: int = 0) -> dict:
    with _lock:
        return _page(list(_load(collection)), limit, offset)


@app.post("/collections/{collection}/query")
def query(collection: str, q: Query) -> dict:
    with _lock:
        items = [d for d in _load(collection) if _matches(d, q.filter)]
    for field, direction in reversed(q.sort):
        items.sort(key=_sort_key(field), reverse=direction < 0)
    return _page(items, q.limit, q.offset)


@app.post("/collections/{collection}/docs", status_code=201)
def create_doc(collection: str, doc: dict[str, Any] = Body(...)) -> dict:
    with _lock:
        docs = _load(collection)
        doc = {**doc, "id": doc.get("id") or uuid.uuid4().hex[:12]}
        if _find(docs, doc["id"]) >= 0:
            raise HTTPException(409, f"{collection}/{doc['id']} already exists")
        docs.append(doc)
        _save(collection)
        return doc


@app.get("/collections/{collection}/docs/{doc_id}")
def get_doc(collection: str, doc_id: str) -> dict:
    with _lock:
        docs = _load(collection)
        i = _find(docs, doc_id)
        if i < 0:
            raise HTTPException(404, f"{collection}/{doc_id} not found")
        return docs[i]


@app.put("/collections/{collection}/docs/{doc_id}")
def put_doc(collection: str, doc_id: str, doc: dict[str, Any] = Body(...)) -> dict:
    with _lock:
        docs = _load(collection)
        doc = {**doc, "id": doc_id}
        i = _find(docs, doc_id)
        if i < 0:
            docs.append(doc)
        else:
            docs[i] = doc
        _save(collection)
        return doc


@app.patch("/collections/{collection}/docs/{doc_id}")
def patch_doc(collection: str, doc_id: str, patch: dict[str, Any] = Body(...)) -> dict:
    with _lock:
        docs = _load(collection)
        i = _find(docs, doc_id)
        if i < 0:
            raise HTTPException(404, f"{collection}/{doc_id} not found")
        docs[i] = {**docs[i], **patch, "id": doc_id}
        _save(collection)
        return docs[i]


@app.delete("/collections/{collection}/docs/{doc_id}", status_code=204)
def delete_doc(collection: str, doc_id: str) -> Response:
    with _lock:
        docs = _load(collection)
        i = _find(docs, doc_id)
        if i < 0:
            raise HTTPException(404, f"{collection}/{doc_id} not found")
        docs.pop(i)
        _save(collection)
    return Response(status_code=204)
