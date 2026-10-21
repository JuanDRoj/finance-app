"""Reconciling an account while another reconciliation, a movement or an archive runs on it.

A reconciliation writes an adjustment for `real balance - current balance`, so it decides from the
balance it reads. Two of them at the same time (a double tap) that only took `FOR SHARE` on the
account (compatible with itself) would read the same balance and each write the whole difference:
balance 100, real balance 150, both write +50 and the account ends at 200. `reconcile_account`
therefore reads the account `FOR NO KEY UPDATE` (`accounts.service.get_account_for_update`), which
conflicts with `FOR SHARE` (every writer of movements) and with itself (another reconciliation, an
archive): the second one waits for the first to end and, in READ COMMITTED, reads the balance it
committed. The reconciliation then holds a lock stronger than the `FOR SHARE` that
`create_transaction` asks for inside it, so the two never wait for each other.

As in `test_account_archive_concurrency.py`, the overlap is forced instead of hoped for, on two real
connections (one engine per actor on a scratch database), with `tests/overlap.py`: the first
operation writes but does not commit, the second has to block on it, and only when a third
connection sees a backend waiting on a lock does the first one commit. If the second never blocks
(no lock between them), the helper times out and the test fails.
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

from app.core.errors import ConflictError
from app.modules.accounts import service as accounts_service
from app.modules.transactions import service as transactions_service
from tests.overlap import Operation, overlap
from tests.transactions_helpers import make_account, make_user_and_space

BACKEND_DIR = Path(__file__).resolve().parents[2]
_NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
OPENING_BALANCE = 100
REAL_BALANCE = 150


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


async def _committed_world(engine: AsyncEngine, *, balance: int) -> World:
    """A space with an active bank account whose balance is `balance` (one adjustment if not 0)."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        user_id, space_id = await make_user_and_space(session, "uid-reconcile")
        account = await make_account(session, space_id, name="Itaú")
        if balance:
            await transactions_service.create_adjustment(
                session, space_id, user_id, account.id, balance, now=_NOW
            )
        await session.commit()
        return World(user_id, space_id, account.id)


async def _scalar(engine: AsyncEngine, sql: str, **params: object) -> object:
    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).scalar_one()


async def _balance(engine: AsyncEngine, world: World) -> object:
    return await _scalar(
        engine,
        "SELECT coalesce(sum(amount_minor), 0) FROM entries WHERE account_id = :id",
        id=world.account_id,
    )


async def _adjustments(engine: AsyncEngine) -> object:
    return await _scalar(engine, "SELECT count(*) FROM transactions WHERE type = 'adjustment'")


def _reconcile(world: World, balance_minor: int) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await transactions_service.reconcile_account(
            session,
            world.space_id,
            world.user_id,
            world.account_id,
            balance_minor=balance_minor,
            now=_NOW,
        )

    return operation


def _add_money(world: World, amount: int) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await transactions_service.create_adjustment(
            session, world.space_id, world.user_id, world.account_id, amount, now=_NOW
        )

    return operation


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


async def test_two_reconciliations_at_the_same_time_write_one_adjustment(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine, balance=OPENING_BALANCE)

    first, second = await overlap(
        engines, _reconcile(world, REAL_BALANCE), _reconcile(world, REAL_BALANCE)
    )

    assert [e.amount_minor for e in getattr(first, "entries", [])] == [50]
    # The second one waited, read the balance the first one committed and found no difference.
    assert second is None
    assert await _adjustments(engine) == 2  # the opening balance and one reconciliation
    assert await _balance(engine, world) == REAL_BALANCE


async def test_a_reconciliation_waits_for_a_movement_being_written_and_ends_at_the_real_balance(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine, balance=OPENING_BALANCE)

    movement, reconciliation = await overlap(
        engines, _add_money(world, 10), _reconcile(world, REAL_BALANCE)
    )

    assert getattr(movement, "type", None) == "adjustment"
    # It read the balance with the movement (110), so the difference is 40 and the account ends
    # at exactly the real balance.
    assert [e.amount_minor for e in getattr(reconciliation, "entries", [])] == [40]
    assert await _balance(engine, world) == REAL_BALANCE
    assert await _adjustments(engine) == 3


async def test_a_movement_waits_for_a_reconciliation_in_flight_and_goes_after_it(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine, balance=OPENING_BALANCE)

    reconciliation, movement = await overlap(
        engines, _reconcile(world, REAL_BALANCE), _add_money(world, 10)
    )

    assert [e.amount_minor for e in getattr(reconciliation, "entries", [])] == [50]
    assert getattr(movement, "type", None) == "adjustment"
    assert await _balance(engine, world) == REAL_BALANCE + 10  # the real balance, then the movement
    assert await _adjustments(engine) == 3


async def test_archiving_while_a_reconciliation_is_in_flight_sees_the_new_balance_and_refuses(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine, balance=OPENING_BALANCE)

    reconciliation, archived = await overlap(engines, _reconcile(world, 0), _archive(world))

    # The reconciliation brought the balance to zero before the archive read it: it succeeds.
    assert [e.amount_minor for e in getattr(reconciliation, "entries", [])] == [-OPENING_BALANCE]
    assert getattr(archived, "archived_at", None) is not None
    assert await _balance(engine, world) == 0
    assert await _scalar(engine, "SELECT count(*) FROM accounts WHERE archived_at IS NULL") == 0


async def test_reconciling_while_the_account_is_being_archived_is_refused(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine, balance=0)

    archived, reconciliation = await overlap(
        engines, _archive(world), _reconcile(world, REAL_BALANCE)
    )

    assert getattr(archived, "archived_at", None) is not None
    # The reconciliation waited for the archive and then read the account archived.
    assert isinstance(reconciliation, ConflictError)
    assert reconciliation.code == "account_archived"
    assert await _adjustments(engine) == 0
    assert await _balance(engine, world) == 0
