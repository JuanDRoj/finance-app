"""Migration 0008: the `unaccent` extension, which the search of the movements list uses.

The search ignores accents (`unaccent(description) ILIKE unaccent(pattern)`), so the database
needs the extension. It is a contrib module that ships with PostgreSQL (and Cloud SQL).
"""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _config() -> Config:
    return Config(str(BACKEND_DIR / "alembic.ini"))


@pytest.fixture
async def engine(scratch_database_url: str) -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine(scratch_database_url)
    try:
        yield eng
    finally:
        await eng.dispose()


async def _has_extension(engine: AsyncEngine) -> bool:
    async with engine.connect() as conn:
        found = await conn.scalar(
            text("SELECT count(*) FROM pg_extension WHERE extname='unaccent'")
        )
    return bool(found == 1)


async def test_upgrade_installs_unaccent_and_downgrade_removes_it(engine: AsyncEngine) -> None:
    await asyncio.to_thread(command.upgrade, _config(), "0007")
    assert not await _has_extension(engine)

    await asyncio.to_thread(command.upgrade, _config(), "0008")
    assert await _has_extension(engine)
    async with engine.connect() as conn:
        assert await conn.scalar(text("SELECT unaccent('Año Café ÁÉÍÓÚ')")) == "Ano Cafe AEIOU"

    await asyncio.to_thread(command.downgrade, _config(), "0007")
    assert not await _has_extension(engine)


async def test_upgrade_is_harmless_when_the_extension_already_exists(engine: AsyncEngine) -> None:
    await asyncio.to_thread(command.upgrade, _config(), "0007")
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION unaccent"))

    await asyncio.to_thread(command.upgrade, _config(), "head")

    assert await _has_extension(engine)
