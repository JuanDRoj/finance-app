import subprocess
import sys
from collections.abc import Callable
from typing import Any

import asyncpg
import pytest
from sqlalchemy import text
from sqlalchemy.engine import URL

from app.core import db as db_module
from app.core.config import Settings
from app.core.db import Database

INSTANCE = "my-project:southamerica-east1:finance-db"
CONNECTOR_ENV = {
    "INSTANCE_CONNECTION_NAME": INSTANCE,
    "DB_USER": "app-user",
    "DB_PASSWORD": "app-password",
    "DB_NAME": "app-db",
}


class FakeConnector:
    """Stands in for the Cloud SQL Connector: records the calls, serves the test database."""

    def __init__(self, target: URL) -> None:
        self._target = target
        self.connect_calls: list[tuple[str, str, dict[str, Any]]] = []
        self.close_calls = 0

    async def connect_async(
        self, instance_connection_string: str, driver: str, **kwargs: Any
    ) -> Any:
        self.connect_calls.append((instance_connection_string, driver, kwargs))
        return await asyncpg.connect(
            host=self._target.host,
            port=self._target.port,
            user=self._target.username,
            password=self._target.password,
            database=self._target.database,
        )

    async def close_async(self) -> None:
        self.close_calls += 1


class FakeFactory:
    def __init__(self, connector: FakeConnector) -> None:
        self.connector = connector
        self.ip_types: list[str] = []

    async def __call__(self, ip_type: str) -> FakeConnector:
        self.ip_types.append(ip_type)
        return self.connector


@pytest.fixture
def fake_connector(test_database_url: URL) -> FakeConnector:
    return FakeConnector(test_database_url)


async def test_connector_is_used_when_instance_connection_name_is_set(
    settings_factory: Callable[..., Settings], fake_connector: FakeConnector
) -> None:
    factory = FakeFactory(fake_connector)
    settings = settings_factory(
        database_url="postgresql+asyncpg://ignored:x@nowhere/none", **CONNECTOR_ENV
    )
    db = await Database.create(settings, connector_factory=factory)
    try:
        assert factory.ip_types == ["PUBLIC"]
        assert fake_connector.connect_calls == []  # nothing is opened until the first query
        async with db.sessionmaker() as session:
            assert (await session.execute(text("SELECT 1"))).scalar_one() == 1
    finally:
        await db.dispose()

    (instance, driver, kwargs), *rest = fake_connector.connect_calls
    assert rest == []
    assert (instance, driver) == (INSTANCE, "asyncpg")
    assert kwargs == {"user": "app-user", "password": "app-password", "db": "app-db"}


async def test_connector_ip_type_comes_from_settings(
    settings_factory: Callable[..., Settings], fake_connector: FakeConnector
) -> None:
    factory = FakeFactory(fake_connector)
    settings = settings_factory(**CONNECTOR_ENV, DB_IP_TYPE="PRIVATE")
    db = await Database.create(settings, connector_factory=factory)
    await db.dispose()
    assert factory.ip_types == ["PRIVATE"]


async def test_dispose_closes_the_connector_once(
    settings_factory: Callable[..., Settings], fake_connector: FakeConnector
) -> None:
    db = await Database.create(
        settings_factory(**CONNECTOR_ENV), connector_factory=FakeFactory(fake_connector)
    )
    await db.dispose()
    await db.dispose()
    assert fake_connector.close_calls == 1


async def test_connector_is_not_created_without_instance_connection_name(
    settings_factory: Callable[..., Settings], fake_connector: FakeConnector
) -> None:
    factory = FakeFactory(fake_connector)
    db = await Database.create(settings_factory(), connector_factory=factory)
    try:
        async with db.sessionmaker() as session:
            assert (await session.execute(text("SELECT 1"))).scalar_one() == 1
    finally:
        await db.dispose()
    assert factory.ip_types == []
    assert fake_connector.connect_calls == []


async def test_default_connector_factory_uses_lazy_refresh_and_requested_ip_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    sentinel = object()

    async def fake_create_async_connector(**kwargs: Any) -> object:
        captured.update(kwargs)
        return sentinel

    import google.cloud.sql.connector as connector_package

    monkeypatch.setattr(connector_package, "create_async_connector", fake_create_async_connector)
    connector = await db_module.create_cloud_sql_connector("PSC")
    assert connector is sentinel
    assert captured == {"ip_type": "PSC", "refresh_strategy": "lazy"}


def test_connector_package_is_not_imported_when_the_app_loads() -> None:
    # The import is lazy so local runs and the direct-URL path do not pay for grpc/aiohttp.
    code = "import sys, app.main; sys.exit('google.cloud.sql.connector' in sys.modules)"
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", code], capture_output=True, text=True, timeout=60, check=False
    )
    assert result.returncode == 0, result.stderr
