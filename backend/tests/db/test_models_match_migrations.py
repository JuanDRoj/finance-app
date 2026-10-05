import asyncio
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.db import Base
from app.modules.currencies import models as currencies_models  # noqa: F401
from app.modules.spaces import models as spaces_models  # noqa: F401
from app.modules.users import models as users_models  # noqa: F401

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _diff(connection: Connection) -> list[object]:
    context = MigrationContext.configure(
        connection, opts={"compare_type": True, "compare_server_default": True}
    )
    return list(compare_metadata(context, Base.metadata))


async def test_models_match_the_migrated_schema(scratch_database_url: str) -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    await asyncio.to_thread(command.upgrade, config, "head")

    engine = create_async_engine(scratch_database_url)
    try:
        async with engine.connect() as conn:
            diff = await conn.run_sync(_diff)
    finally:
        await engine.dispose()

    assert diff == []
