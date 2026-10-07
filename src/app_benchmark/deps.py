"""Per-app singletons (clients + orchestrator), reachable from routes via ``Deps`` ."""

from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Depends, Request

from .clients.blazemeter import BlazeMeterClient
from .clients.db import DbClient
from .clients.splunk import SplunkClient
from .runs.orchestrator import Orchestrator
from .settings import Settings


@dataclass
class Container:
    settings: Settings
    db: DbClient
    blazemeter: BlazeMeterClient
    splunk: SplunkClient
    orchestrator: Orchestrator

    @classmethod
    def build(cls, settings: Settings, transports: dict[str, httpx.AsyncBaseTransport] | None = None) -> "Container":
        t = transports or {}
        db = DbClient(settings.db_url, settings.db_api_key, t.get("db"))
        bm = BlazeMeterClient(settings.blazemeter_url, settings.blazemeter_key_id, settings.blazemeter_key_secret, t.get("blazemeter"))
        splunk = SplunkClient(settings.splunk_url, settings.splunk_token, t.get("splunk"))
        return cls(settings, db, bm, splunk, Orchestrator(settings, db, bm, splunk))

    async def aclose(self) -> None:
        await self.orchestrator.shutdown()
        for c in (self.db, self.blazemeter, self.splunk):
            await c.aclose()


def _container(request: Request) -> Container:
    return request.app.state.container


Deps = Annotated[Container, Depends(_container)]
