"""Outbound HTTP for fakes that call other fakes (BlazeMeter -> target, target -> Splunk).

Tests register an in-process transport per base URL with ``override``, so the whole system
can run inside one event loop without opening ports.
"""

import asyncio

import httpx

_overrides: dict[str, httpx.AsyncBaseTransport] = {}
_clients: dict[tuple[str, int], httpx.AsyncClient] = {}


def override(base_url: str, transport: httpx.AsyncBaseTransport | None) -> None:
    base_url = base_url.rstrip("/")
    if transport is None:
        _overrides.pop(base_url, None)
    else:
        _overrides[base_url] = transport
    for key in [k for k in _clients if k[0] == base_url]:
        _clients.pop(key)


def client(base_url: str) -> httpx.AsyncClient:
    """One client per (base URL, event loop): httpx pools can't be shared across loops."""
    base_url = base_url.rstrip("/")
    key = (base_url, id(asyncio.get_running_loop()))
    if key not in _clients:
        _clients[key] = httpx.AsyncClient(base_url=base_url, transport=_overrides.get(base_url), timeout=httpx.Timeout(30.0, connect=5.0))
    return _clients[key]
