"""Archiving an account while a movement is written on it (or while it is archived twice).

An account can only be archived with a zero balance, and the balance lives in another module
(`transactions`). Two orders can go wrong without a lock:

- the router reads the balance (0), a movement is confirmed, the account is archived: an archived
  account with a balance;
- a movement checks that the account is active, the account is archived, the movement is written.

The fix is the order of the locks: `accounts.service.archive_account` reads the account `FOR NO KEY
UPDATE` and only then asks for the balance (`balance_of`), and `create_transaction` reads its
accounts `FOR SHARE`. The two conflict, so one waits for the other: whoever goes second sees what
the first one committed (READ COMMITTED), and the account is never archived with a balance.

As in `test_category_archive_concurrency.py`, the overlap is forced instead of hoped for, on two
real connections (one engine per actor on a scratch database), with `tests/overlap.py`:

1. The first operation writes but does not commit.
2. The second one starts and has to wait for the first one's row lock.
3. A third connection watches `pg_stat_activity` until it sees a backend waiting on a lock; only
   then does the first operation commit. If the second never blocked, the test fails.

Two archives of the same account at the same time (a double tap) are the other race: without the
lock both read it active and the second one overwrites `archived_at` with its own moment.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.errors import ConflictError, InvalidFieldError
from app.modules.accounts import service as accounts_service
from app.modules.transactions import service as transactions_service
from tests.overlap import Operation, overlap
from tests.transactions_helpers import make_account, make_user_and_space

BACKEND_DIR = Path(__file__).resolve().parents[2]
_NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)

# Accounts that are archived and still have a balance. It must stay empty.
ARCHIVED_WITH_A_BALANCE = (
    "SELECT count(*) FROM accounts a WHERE a.archived_at IS NOT NULL AND coalesce("
    "(SELECT sum(e.amount_minor) FROM entries e JOIN transactions t ON t.id = e.transaction_id"
    " WHERE e.account_id = a.id AND t.status = 'confirmed' AND t.deleted_at IS NULL), 0) <> 0"
)


@dataclass(frozen=True)
class World:
    user_id: uuid.UUID
    space_id: uuid.UUID
    account_id: uuid.UUID


@pytest.fixture
async def engines(scratch_database_url: str) -> AsyncIterator[tuple[AsyncEngine, ...]]:
    """Three engines on the migrated scratch database: actor A, actor B and the watcher."""
    await asyncio.to_thread(command.upgrade, Config(str(BACKEND_DIR / "alembic.ini")), "head")
    created = tuple(create_async_engine(scratch_database_url) for _ in range(3))
    try:
        yield created
    finally:
        for engine in created:
            await engine.dispose()


async def _committed_world(engine: AsyncEngine) -> World:
    """A space with an active bank account that has a zero balance."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        user_id, space_id = await make_user_and_space(session, "uid-archive")
        account = await make_account(session, space_id, name="Itaú")
        await session.commit()
        return World(user_id, space_id, account.id)


async def _scalar(engine: AsyncEngine, sql: str, **params: object) -> object:
    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).scalar_one()


def _archive(world: World) -> Operation:
    async def operation(session: AsyncSession) -> object:
        async def balance_of() -> int:
            return await transactions_service.get_account_balance(
                session, world.space_id, world.account_id
            )

        return await accounts_service.archive_account(
            session, world.space_id, world.account_id, balance_of=balance_of
        )

    return operation


def _add_money(world: World) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await transactions_service.create_adjustment(
            session,
            world.space_id,
            world.user_id,
            world.account_id,
            100,
            now=_NOW,
        )

    return operation


async def _archived_at(engine: AsyncEngine, account_id: uuid.UUID) -> object:
    return await _scalar(engine, "SELECT archived_at FROM accounts WHERE id = :id", id=account_id)


async def _balance(engine: AsyncEngine, account_id: uuid.UUID) -> object:
    return await _scalar(
        engine,
        "SELECT coalesce(sum(amount_minor), 0) FROM entries WHERE account_id = :id",
        id=account_id,
    )


async def test_a_movement_written_while_the_account_is_being_archived_is_refused(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    archived, movement = await overlap(engines, _archive(world), _add_money(world))

    assert getattr(archived, "archived_at", None) is not None
    # The movement waited for the archive, then read the account archived and refused.
    assert isinstance(movement, InvalidFieldError)
    assert (movement.code, movement.loc) == (
        "account_archived",
        ["body", "adjustment", "account_id"],
    )
    assert await _archived_at(engine, world.account_id) is not None
    assert await _balance(engine, world.account_id) == 0
    assert await _scalar(engine, ARCHIVED_WITH_A_BALANCE) == 0


async def test_archiving_while_a_movement_is_being_written_sees_its_balance_and_refuses(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    movement, archived = await overlap(engines, _add_money(world), _archive(world))

    assert getattr(movement, "type", None) == "adjustment"
    # The archive waited for the movement, then read the balance it had committed: 100.
    assert isinstance(archived, ConflictError)
    assert archived.code == "account_has_balance"
    assert await _archived_at(engine, world.account_id) is None
    assert await _balance(engine, world.account_id) == 100
    assert await _scalar(engine, ARCHIVED_WITH_A_BALANCE) == 0


async def test_two_archives_at_the_same_time_keep_the_first_moment(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await overlap(engines, _archive(world), _archive(world))

    first_moment = getattr(first, "archived_at", None)
    assert first_moment is not None
    # The second one waited, found the account archived and returned it as it was.
    assert getattr(second, "archived_at", None) == first_moment
    assert await _archived_at(engine, world.account_id) == first_moment
    assert await _scalar(engine, ARCHIVED_WITH_A_BALANCE) == 0
