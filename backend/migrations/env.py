"""Alembic environment (async).

Uses the app's own settings and `Database`, so the Cloud Run Job that applies migrations
reaches Cloud SQL through the same Connector path as the API. Logging is the project's JSON
logging (alembic's `fileConfig` would replace it).
"""

import asyncio

from alembic import context
from sqlalchemy.engine import Connection

from app.core.config import get_settings
from app.core.db import Base, Database
from app.core.logging import configure_logging
from app.modules.currencies import models as currencies_models  # noqa: F401
from app.modules.spaces import models as spaces_models  # noqa: F401
from app.modules.users import models as users_models  # noqa: F401

# Importing a module's models registers its tables on Base.metadata, which autogenerate
# compares against the database. Add one import per module here when it gets models.
target_metadata = Base.metadata

config = context.config
settings = get_settings()

# Only when run from the CLI; programmatic callers (tests) keep their own logging.
if config.cmd_opts is not None:
    configure_logging(settings.LOG_LEVEL)


def run_migrations_offline() -> None:
    """Emit SQL instead of running it (`alembic upgrade head --sql`). Needs DATABASE_URL."""
    if settings.DATABASE_URL is None:
        raise RuntimeError(
            "Offline mode needs DATABASE_URL (it does not use the Cloud SQL Connector)"
        )
    context.configure(
        url=settings.DATABASE_URL.get_secret_value(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    # NullPool: this process is short-lived and must not keep connections around.
    db = await Database.create(settings, null_pool=True)
    try:
        async with db.engine.connect() as connection:
            await connection.run_sync(do_run_migrations)
    finally:
        await db.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
