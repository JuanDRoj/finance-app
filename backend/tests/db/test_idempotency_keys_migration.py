"""Migration 0007: `idempotency_keys`, the keys that make `POST .../transactions` idempotent.

A key is `(space_id, user_id, key)`: the primary key. It stores the sha256 of the body and, once the
request has created it, the movement. `transaction_id` is NULL only while the request that claimed
the key is still running (nobody else sees that row: it is not committed). The user must belong to
the space (a composite foreign key to `space_members`) and the movement must be in the same space
(a composite foreign key to `transactions`, like the entries); both die with their parent.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

BACKEND_DIR = Path(__file__).resolve().parents[2]
HASH = b"\x01" * 32


def _config() -> Config:
    return Config(str(BACKEND_DIR / "alembic.ini"))


@pytest.fixture
async def engine(scratch_database_url: str) -> AsyncIterator[AsyncEngine]:
    await asyncio.to_thread(command.upgrade, _config(), "head")
    eng = create_async_engine(scratch_database_url)
    try:
        yield eng
    finally:
        await eng.dispose()


async def _exec(engine: AsyncEngine, sql: str, **params: object) -> None:
    async with engine.begin() as conn:
        await conn.execute(text(sql), params)


async def _rows(engine: AsyncEngine, sql: str, **params: object) -> list[tuple[object, ...]]:
    async with engine.connect() as conn:
        return [tuple(r) for r in (await conn.execute(text(sql), params)).all()]


class World:
    """A user who is a member of a space that has one transaction."""

    def __init__(self, user_id: uuid.UUID, space_id: uuid.UUID, transaction_id: uuid.UUID) -> None:
        self.user_id = user_id
        self.space_id = space_id
        self.transaction_id = transaction_id


async def _world(engine: AsyncEngine, uid: str = "uid-1") -> World:
    user_id, space_id, transaction_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO users (id, firebase_uid, email) VALUES (:id, :uid, 'a@example.com')",
        id=user_id,
        uid=uid,
    )
    await _exec(
        engine,
        "INSERT INTO spaces (id, name, type, currency, timezone, created_by) "
        "VALUES (:id, 'Mi espacio', 'personal', 'UYU', 'America/Montevideo', :user_id)",
        id=space_id,
        user_id=user_id,
    )
    await _exec(
        engine,
        "INSERT INTO space_members (user_id, space_id, role) VALUES (:user_id, :space_id, 'owner')",
        user_id=user_id,
        space_id=space_id,
    )
    await _exec(
        engine,
        "INSERT INTO transactions (id, space_id, type, status, date, created_by) "
        "VALUES (:id, :space_id, 'adjustment', 'confirmed', '2026-10-20', :user_id)",
        id=transaction_id,
        space_id=space_id,
        user_id=user_id,
    )
    return World(user_id, space_id, transaction_id)


async def _key(
    engine: AsyncEngine,
    world: World,
    *,
    key: uuid.UUID | None = None,
    transaction_id: uuid.UUID | None = None,
    space_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    request_hash: bytes = HASH,
) -> uuid.UUID:
    key = key or uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO idempotency_keys (space_id, user_id, key, request_hash, transaction_id) "
        "VALUES (:space_id, :user_id, :key, :hash, :transaction_id)",
        space_id=space_id or world.space_id,
        user_id=user_id or world.user_id,
        key=key,
        hash=request_hash,
        transaction_id=transaction_id,
    )
    return key


# structure ----------------------------------------------------------------------------------


async def test_migration_creates_the_table_with_the_expected_columns(engine: AsyncEngine) -> None:
    rows = await _rows(
        engine,
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
        "WHERE table_name = 'idempotency_keys'",
    )

    assert {c: (d, n) for c, d, n in rows} == {
        "space_id": ("uuid", "NO"),
        "user_id": ("uuid", "NO"),
        "key": ("uuid", "NO"),
        "request_hash": ("bytea", "NO"),
        "transaction_id": ("uuid", "YES"),
        "created_at": ("timestamp with time zone", "NO"),
    }


async def test_the_expected_constraints_exist_and_there_is_no_other_index(
    engine: AsyncEngine,
) -> None:
    constraints = {
        r[0]
        for r in await _rows(
            engine,
            "SELECT conname FROM pg_constraint WHERE conrelid = 'idempotency_keys'::regclass",
        )
    }
    indexes = {
        r[0]
        for r in await _rows(
            engine, "SELECT indexname FROM pg_indexes WHERE tablename = 'idempotency_keys'"
        )
    }

    assert constraints == {
        "pk_idempotency_keys",
        "ck_idempotency_keys_request_hash_length",
        "fk_idempotency_keys_user_id_space_id_space_members",
        "fk_idempotency_keys_transaction_id_space_id_transactions",
    }
    assert indexes == {"pk_idempotency_keys"}  # the primary key serves every lookup


async def test_created_at_defaults_to_now(engine: AsyncEngine) -> None:
    world = await _world(engine)
    await _key(engine, world, transaction_id=world.transaction_id)

    [(created_at, recent)] = await _rows(
        engine,
        "SELECT created_at, created_at > now() - interval '1 minute' FROM idempotency_keys",
    )

    assert created_at is not None
    assert recent is True


# the primary key ----------------------------------------------------------------------------


async def test_the_same_key_twice_for_the_same_user_and_space_is_rejected(
    engine: AsyncEngine,
) -> None:
    world = await _world(engine)
    key = await _key(engine, world, transaction_id=world.transaction_id)

    with pytest.raises(IntegrityError, match="pk_idempotency_keys"):
        await _key(engine, world, key=key)


async def test_the_same_key_of_another_member_of_the_space_is_another_row(
    engine: AsyncEngine,
) -> None:
    world = await _world(engine)
    other = uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO users (id, firebase_uid, email) VALUES (:id, 'uid-2', 'b@example.com')",
        id=other,
    )
    await _exec(
        engine,
        "INSERT INTO space_members (user_id, space_id, role) "
        "VALUES (:user_id, :space_id, 'member')",
        user_id=other,
        space_id=world.space_id,
    )
    key = await _key(engine, world)

    await _key(engine, world, key=key, user_id=other)

    assert await _rows(engine, "SELECT count(*) FROM idempotency_keys") == [(2,)]


# the hash and the transaction -----------------------------------------------------------------


@pytest.mark.parametrize("size", [0, 31, 33, 64])
async def test_the_hash_must_be_exactly_32_bytes(engine: AsyncEngine, size: int) -> None:
    world = await _world(engine)

    with pytest.raises(IntegrityError, match="ck_idempotency_keys_request_hash_length"):
        await _key(engine, world, request_hash=b"\x01" * size)


async def test_a_key_may_exist_before_its_transaction(engine: AsyncEngine) -> None:
    world = await _world(engine)

    await _key(engine, world, transaction_id=None)

    assert await _rows(engine, "SELECT transaction_id FROM idempotency_keys") == [(None,)]


async def test_the_transaction_must_exist(engine: AsyncEngine) -> None:
    world = await _world(engine)

    with pytest.raises(
        IntegrityError, match="fk_idempotency_keys_transaction_id_space_id_transactions"
    ):
        await _key(engine, world, transaction_id=uuid.uuid4())


async def test_the_transaction_must_be_in_the_same_space_as_the_key(engine: AsyncEngine) -> None:
    mine = await _world(engine, "uid-1")
    theirs = await _world(engine, "uid-2")

    with pytest.raises(
        IntegrityError, match="fk_idempotency_keys_transaction_id_space_id_transactions"
    ):
        await _key(engine, mine, transaction_id=theirs.transaction_id)


async def test_the_key_dies_with_its_transaction(engine: AsyncEngine) -> None:
    world = await _world(engine)
    await _key(engine, world, transaction_id=world.transaction_id)

    await _exec(engine, "DELETE FROM transactions WHERE id = :id", id=world.transaction_id)

    assert await _rows(engine, "SELECT count(*) FROM idempotency_keys") == [(0,)]


# the member -----------------------------------------------------------------------------------


async def test_the_user_must_be_a_member_of_the_space(engine: AsyncEngine) -> None:
    mine = await _world(engine, "uid-1")
    stranger = await _world(engine, "uid-2")  # a member of their own space, not of mine

    with pytest.raises(IntegrityError, match="fk_idempotency_keys_user_id_space_id_space_members"):
        await _key(engine, mine, user_id=stranger.user_id)


async def test_the_keys_of_a_user_die_when_they_leave_the_space(engine: AsyncEngine) -> None:
    world = await _world(engine)
    await _key(engine, world)

    await _exec(
        engine,
        "DELETE FROM space_members WHERE user_id = :user_id AND space_id = :space_id",
        user_id=world.user_id,
        space_id=world.space_id,
    )

    assert await _rows(engine, "SELECT count(*) FROM idempotency_keys") == [(0,)]


# downgrade ----------------------------------------------------------------------------------


async def test_downgrade_drops_the_table_and_keeps_the_transactions_and_upgrade_recreates_it(
    engine: AsyncEngine,
) -> None:
    config = _config()
    table = "SELECT table_name FROM information_schema.tables WHERE table_name = 'idempotency_keys'"
    world = await _world(engine)
    await _key(engine, world, transaction_id=world.transaction_id)
    assert await _rows(engine, table) == [("idempotency_keys",)]

    await asyncio.to_thread(command.downgrade, config, "0006")

    assert await _rows(engine, table) == []
    assert await _rows(engine, "SELECT count(*) FROM transactions") == [(1,)]
    assert await _rows(engine, "SELECT count(*) FROM space_members") == [(1,)]

    await asyncio.to_thread(command.upgrade, config, "head")
    assert await _rows(engine, table) == [("idempotency_keys",)]
    assert await _rows(engine, "SELECT count(*) FROM idempotency_keys") == [(0,)]
