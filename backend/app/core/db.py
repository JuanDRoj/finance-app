"""Async database access: declarative base, engine/pool, Cloud SQL Connector, request session.

Transactions: `get_session` is the unit of work of a request. It commits when the endpoint
finishes and rolls back when it raises, both before the response is sent (the dependency
uses `scope="function"`; with the default scope FastAPI would run this code after the
response, and the client could see a success that is not yet committed). Services never call
`commit()` or `rollback()`.
"""

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated, Any, Protocol, Self

from fastapi import Depends, Request
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import Settings

logger = logging.getLogger(__name__)

# Predictable constraint names (Alembic can drop/alter them). The `_N_` variants join every
# column, so multi-column UNIQUE/INDEX/FK get distinct names. `ck` needs an explicit name on
# each CheckConstraint, which keeps the business-rule checks easy to find.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class CloudSqlConnector(Protocol):
    """The part of `google.cloud.sql.connector.Connector` that this module uses."""

    async def connect_async(
        self, instance_connection_string: str, driver: str, **kwargs: Any
    ) -> Any: ...

    async def close_async(self) -> None: ...


ConnectorFactory = Callable[[str], Awaitable[CloudSqlConnector]]


async def create_cloud_sql_connector(ip_type: str) -> CloudSqlConnector:
    # Imported here so local runs and the direct-URL path do not load grpc/aiohttp/cryptography.
    from google.cloud.sql.connector import create_async_connector

    # "lazy": no background refresh task, which Cloud Run would throttle between requests.
    return await create_async_connector(ip_type=ip_type, refresh_strategy="lazy")


class Database:
    """Owns the engine, the session factory and (optionally) the Cloud SQL connector."""

    def __init__(self, engine: AsyncEngine, connector: CloudSqlConnector | None = None) -> None:
        self.engine = engine
        self.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
        self._connector = connector
        self._closed = False

    @classmethod
    async def create(
        cls,
        settings: Settings,
        *,
        null_pool: bool = False,
        connector_factory: ConnectorFactory = create_cloud_sql_connector,
    ) -> Self:
        """Build the engine. It opens no connection until the first query.

        `null_pool=True` is for short-lived processes (migrations) that must not keep
        connections around. Async because the Connector has to be created in the running loop.
        """
        # hide_parameters: SQL errors must not carry parameter values (emails...) into the logs.
        pool_options: dict[str, Any] = {"pool_pre_ping": True, "hide_parameters": True}
        if null_pool:
            pool_options["poolclass"] = NullPool
        else:
            pool_options.update(
                pool_size=settings.DB_POOL_SIZE,
                max_overflow=settings.DB_MAX_OVERFLOW,
                pool_timeout=settings.DB_POOL_TIMEOUT,
            )

        connector: CloudSqlConnector | None = None
        if settings.INSTANCE_CONNECTION_NAME is not None:
            connector = await connector_factory(settings.DB_IP_TYPE)
            try:
                engine = _connector_engine(settings, connector, pool_options)
            except BaseException:
                await connector.close_async()
                raise
        else:
            if settings.DATABASE_URL is None:
                raise RuntimeError("DATABASE_URL is not set")
            engine = create_async_engine(settings.DATABASE_URL.get_secret_value(), **pool_options)

        logger.info(
            "db_engine_created",
            extra={
                "db_mode": "cloud_sql_connector" if connector else "direct_url",
                "pool": "null" if null_pool else "queue",
                "pool_size": None if null_pool else settings.DB_POOL_SIZE,
                "max_overflow": None if null_pool else settings.DB_MAX_OVERFLOW,
            },
        )
        return cls(engine, connector)

    @property
    def closed(self) -> bool:
        return self._closed

    async def dispose(self) -> None:
        """Close the pool and the connector. Safe to call more than once."""
        if self._closed:
            return
        self._closed = True
        try:
            await self.engine.dispose()
        finally:
            if self._connector is not None:
                await self._connector.close_async()


def _connector_engine(
    settings: Settings, connector: CloudSqlConnector, pool_options: dict[str, Any]
) -> AsyncEngine:
    instance = settings.INSTANCE_CONNECTION_NAME
    user, name, password = settings.DB_USER, settings.DB_NAME, settings.DB_PASSWORD
    if instance is None or user is None or name is None or password is None:
        raise RuntimeError("Cloud SQL connector settings are incomplete")
    secret = password.get_secret_value()

    async def connect() -> Any:
        return await connector.connect_async(
            instance, "asyncpg", user=user, password=secret, db=name
        )

    # The URL carries no host or credentials: `connect` supplies the connection itself.
    return create_async_engine("postgresql+asyncpg://", async_creator=connect, **pool_options)


def get_database(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if not isinstance(db, Database):
        raise RuntimeError("Database is not initialised (the app lifespan did not run)")
    return db


def get_sessionmaker(
    db: Annotated[Database, Depends(get_database)],
) -> async_sessionmaker[AsyncSession]:
    """The session factory of the running app. Tests override this one (see conftest)."""
    return db.sessionmaker


async def get_session(
    sessionmaker: Annotated[async_sessionmaker[AsyncSession], Depends(get_sessionmaker)],
) -> AsyncIterator[AsyncSession]:
    """One session and one transaction per request: commit on success, rollback on error.

    Only `Exception` is caught: on cancellation, closing the session (the `async with`) already
    rolls back, and awaiting inside a cancelled task is best avoided.
    """
    async with sessionmaker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# A `yield` dependency with the default scope cannot depend on a `function`-scoped one, so any
# dependency with `yield` that takes `DbSession` must also be declared with scope="function".
DbSession = Annotated[AsyncSession, Depends(get_session, scope="function")]
