import asyncio
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _config() -> Config:
    return Config(str(BACKEND_DIR / "alembic.ini"))


SEED = {
    "UYU": 2,
    "COP": 2,
    "USD": 2,
    "ARS": 2,
    "BRL": 2,
    "EUR": 2,
    "CLP": 0,
    "PYG": 0,
}


async def _upgrade(config: Config) -> None:
    # alembic's env.py calls asyncio.run(), which cannot run inside the test's event loop.
    await asyncio.to_thread(command.upgrade, config, "head")


async def _exec(url: str, sql: str, **params: object) -> None:
    engine = create_async_engine(url)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(sql), params)
    finally:
        await engine.dispose()


async def _rows(url: str, sql: str) -> list[tuple[object, ...]]:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as conn:
            return [tuple(r) for r in (await conn.execute(text(sql))).all()]
    finally:
        await engine.dispose()


async def test_migration_seeds_exactly_the_supported_currencies(scratch_database_url: str) -> None:
    await _upgrade(_config())

    rows = await _rows(scratch_database_url, "SELECT code, exponent FROM currencies")

    assert dict(rows) == SEED  # type: ignore[arg-type]
    assert len(rows) == len(SEED)


@pytest.mark.parametrize("exponent", [-1, 5])
async def test_exponent_outside_0_to_4_is_rejected(
    scratch_database_url: str, exponent: int
) -> None:
    await _upgrade(_config())

    with pytest.raises(IntegrityError, match="ck_currencies_exponent_range"):
        await _exec(
            scratch_database_url,
            "INSERT INTO currencies VALUES ('XAA', :exponent)",
            exponent=exponent,
        )


@pytest.mark.parametrize("code", ["usd", "US", "US1"])
async def test_malformed_code_is_rejected(scratch_database_url: str, code: str) -> None:
    await _upgrade(_config())

    with pytest.raises(IntegrityError, match="ck_currencies_code_format"):
        await _exec(scratch_database_url, "INSERT INTO currencies VALUES (:code, 2)", code=code)


async def test_duplicate_code_is_rejected(scratch_database_url: str) -> None:
    await _upgrade(_config())

    with pytest.raises(IntegrityError, match="pk_currencies"):
        await _exec(scratch_database_url, "INSERT INTO currencies VALUES ('UYU', 2)")


async def test_adding_a_currency_is_just_inserting_a_row(scratch_database_url: str) -> None:
    await _upgrade(_config())

    await _exec(scratch_database_url, "INSERT INTO currencies VALUES ('PEN', 2)")

    rows = await _rows(scratch_database_url, "SELECT exponent FROM currencies WHERE code = 'PEN'")
    assert rows == [(2,)]


async def test_a_foreign_key_to_currencies_accepts_supported_and_rejects_unknown_codes(
    scratch_database_url: str,
) -> None:
    await _upgrade(_config())
    await _exec(
        scratch_database_url,
        "CREATE TABLE fk_probe (id int PRIMARY KEY, currency char(3) NOT NULL "
        "REFERENCES currencies (code))",
    )

    await _exec(scratch_database_url, "INSERT INTO fk_probe VALUES (1, 'UYU')")
    with pytest.raises(IntegrityError, match="foreign key"):
        await _exec(scratch_database_url, "INSERT INTO fk_probe VALUES (2, 'XXX')")


async def test_downgrade_drops_the_table_and_upgrade_recreates_it(
    scratch_database_url: str,
) -> None:
    config = _config()
    await _upgrade(config)
    await asyncio.to_thread(command.downgrade, config, "base")

    tables = await _rows(
        scratch_database_url,
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'currencies'",
    )
    assert tables == []

    await _upgrade(config)
    assert len(await _rows(scratch_database_url, "SELECT 1 FROM currencies")) == len(SEED)
