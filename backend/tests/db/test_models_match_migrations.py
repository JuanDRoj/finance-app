"""Guards that the ORM models and the migrations describe the same schema.

Alembic's `compare_metadata` covers tables, columns (type, nullability, server default),
unique constraints, foreign keys (columns and target) and index names/columns/uniqueness.
It does NOT compare CHECK constraints, the WHERE of a partial index or `ON DELETE`. The
extra tests here cover those, generically over `Base.metadata` (new tables are checked
automatically), by constraint/index name against the migrated database:

- CHECK: the model's expression is created on a temporary table in the same database and
  both definitions are read with `pg_get_constraintdef`, so PostgreSQL's own rewriting
  (`= ANY (ARRAY[...])`, `::text` casts) cancels out and no text normalization is needed.
- Partial/other indexes: `pg_get_indexdef` of the migrated index against the same index
  created on a temporary table (the part from `USING`, which holds method, columns and WHERE).
- FK `ON DELETE`: `pg_constraint.confdeltype` against the model's `ondelete`.

Not covered: `ON UPDATE`, `DEFERRABLE`, exclusion constraints, expression indexes with
non-Postgres dialect options other than `postgresql_where`.
"""

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import CheckConstraint, Connection, ForeignKeyConstraint, Index, Table, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.db import Base
from app.modules.currencies import models as currencies_models  # noqa: F401
from app.modules.spaces import models as spaces_models  # noqa: F401
from app.modules.users import models as users_models  # noqa: F401

BACKEND_DIR = Path(__file__).resolve().parents[2]
DIALECT = postgresql.dialect()  # type: ignore[no-untyped-call]
ON_DELETE_CODES = {
    None: "a",
    "NO ACTION": "a",
    "RESTRICT": "r",
    "CASCADE": "c",
    "SET NULL": "n",
    "SET DEFAULT": "d",
}


def _tables() -> list[Table]:
    return list(Base.metadata.sorted_tables)


def _quote(name: str) -> str:
    return DIALECT.identifier_preparer.quote(name)


def _sqltext(check: CheckConstraint) -> str:
    return str(check.sqltext.compile(dialect=DIALECT, compile_kwargs={"literal_binds": True}))


def _where(index: Index) -> str | None:
    where = index.dialect_options["postgresql"]["where"]
    if where is None:
        return None
    return str(where.compile(dialect=DIALECT, compile_kwargs={"literal_binds": True}))


def _check_defs_in_db(connection: Connection) -> dict[tuple[str, str], str]:
    rows = connection.execute(
        text(
            "SELECT c.relname, k.conname, pg_get_constraintdef(k.oid) FROM pg_constraint k "
            "JOIN pg_class c ON c.oid = k.conrelid "
            "WHERE k.contype = 'c' AND c.relnamespace = 'public'::regnamespace"
        )
    )
    return {(r[0], r[1]): r[2] for r in rows}


def _fk_actions_in_db(connection: Connection) -> dict[tuple[str, str], str]:
    rows = connection.execute(
        text(
            "SELECT c.relname, k.conname, k.confdeltype::text FROM pg_constraint k "
            "JOIN pg_class c ON c.oid = k.conrelid "
            "WHERE k.contype = 'f' AND c.relnamespace = 'public'::regnamespace"
        )
    )
    return {(r[0], r[1]): r[2] for r in rows}


def _index_defs_in_db(connection: Connection) -> dict[tuple[str, str], str]:
    """(table, index) -> definition from USING on, for non-constraint indexes."""
    rows = connection.execute(
        text(
            "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' "
            "AND indexname NOT IN (SELECT conname FROM pg_constraint)"
        )
    )
    return {(r[0], r[1]): r[2] for r in rows}


def _after_using(definition: str) -> str:
    return definition[definition.index(" USING ") :]


def _probe_check_def(connection: Connection, table: Table, check: CheckConstraint) -> str:
    """How PostgreSQL renders the model's CHECK, using a throwaway table (rolled back)."""
    probe = "_probe_check"
    connection.execute(
        text(f"CREATE TEMP TABLE {probe} (LIKE {_quote(table.name)}) ON COMMIT DROP")
    )
    connection.execute(text(f"ALTER TABLE {probe} ADD CONSTRAINT probe CHECK ({_sqltext(check)})"))
    row = connection.execute(
        text(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid = CAST(:t AS regclass) AND conname = 'probe'"
        ),
        {"t": probe},
    ).scalar_one()
    connection.execute(text(f"DROP TABLE {probe}"))
    return str(row)


def _probe_index_def(connection: Connection, table: Table, index: Index) -> str:
    probe = "_probe_index"
    columns = ", ".join(_quote(c.name) for c in index.columns)
    unique = "UNIQUE " if index.unique else ""
    where = _where(index)
    suffix = f" WHERE {where}" if where else ""
    connection.execute(
        text(f"CREATE TEMP TABLE {probe} (LIKE {_quote(table.name)}) ON COMMIT DROP")
    )
    connection.execute(text(f"CREATE {unique}INDEX probe_ix ON {probe} ({columns}){suffix}"))
    row = connection.execute(
        text("SELECT indexdef FROM pg_indexes WHERE indexname = 'probe_ix'")
    ).scalar_one()
    connection.execute(text(f"DROP TABLE {probe}"))
    return str(row)


def _alembic_diff(connection: Connection) -> list[object]:
    context = MigrationContext.configure(
        connection, opts={"compare_type": True, "compare_server_default": True}
    )
    return list(compare_metadata(context, Base.metadata))


def _in_rolled_back_transaction(connection: Connection, fn: Callable[[Connection], Any]) -> Any:
    transaction = connection.begin()
    try:
        return fn(connection)
    finally:
        transaction.rollback()


@pytest.fixture
async def migrated_url(scratch_database_url: str) -> str:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    await asyncio.to_thread(command.upgrade, config, "head")
    return scratch_database_url


async def _run(url: str, fn: Callable[[Connection], Any]) -> Any:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as conn:
            return await conn.run_sync(lambda c: _in_rolled_back_transaction(c, fn))
    finally:
        await engine.dispose()


async def test_models_match_the_migrated_schema(migrated_url: str) -> None:
    assert await _run(migrated_url, _alembic_diff) == []


async def test_check_constraints_match_the_models(migrated_url: str) -> None:
    def collect(connection: Connection) -> tuple[dict[Any, str], dict[Any, str]]:
        expected = {
            (t.name, c.name): _probe_check_def(connection, t, c)
            for t in _tables()
            for c in t.constraints
            if isinstance(c, CheckConstraint)
        }
        return expected, _check_defs_in_db(connection)

    expected, actual = await _run(migrated_url, collect)

    assert actual == expected


async def test_foreign_key_on_delete_matches_the_models(migrated_url: str) -> None:
    def collect(connection: Connection) -> dict[Any, str]:
        return _fk_actions_in_db(connection)

    expected = {
        (t.name, fk.name): ON_DELETE_CODES[fk.ondelete.upper() if fk.ondelete else None]
        for t in _tables()
        for fk in t.constraints
        if isinstance(fk, ForeignKeyConstraint)
    }

    assert await _run(migrated_url, collect) == expected


async def test_indexes_including_partial_where_match_the_models(migrated_url: str) -> None:
    def collect(connection: Connection) -> tuple[dict[Any, str], dict[Any, str]]:
        expected = {
            (t.name, i.name): _after_using(_probe_index_def(connection, t, i))
            for t in _tables()
            for i in t.indexes
        }
        actual = {k: _after_using(v) for k, v in _index_defs_in_db(connection).items()}
        return expected, actual

    expected, actual = await _run(migrated_url, collect)

    assert actual == expected
