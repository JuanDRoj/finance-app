"""Editing, deleting and restoring a movement take their locks, and the races they close (KAN-80).

The three operations change the balance of the accounts of the movement (the old ones and, in an
edit, the new ones) and the first thing each does is read the transaction row `FOR NO KEY UPDATE`
(`repository.get_for_update`): editing, deleting and restoring the same movement run one after the
other, and whoever goes second sees what the first one committed. Then the accounts are read
`FOR SHARE` in order of id (`accounts.service.get_account_for_share`), as every writer of movements
does, so the two operations that decide from the balance, archive and reconcile (`FOR NO KEY
UPDATE`), wait for them or are waited for:

- A restore that puts money back on an account that is being archived: whoever goes second sees the
  other (the archive sees the balance and answers 409 `account_has_balance`; the restore sees the
  account archived and answers 409 `account_archived`). Without the lock an account could end
  archived with a balance.
- A delete next to a reconciliation: the reconciliation writes `real - current balance`, so it has
  to read the balance after the delete committed, or the account would not end at the real balance.

As in `test_transaction_account_lock.py`, the lock is proved with `NOWAIT` (while an
operation is in flight, a `FOR NO KEY UPDATE` on its rows is refused at once) and the races with the
forced overlap of `tests/overlap.py` on two real connections.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from pydantic import TypeAdapter
from sqlalchemy import TextClause, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.errors import ConflictError, NotFoundError
from app.modules.accounts import service as accounts_service
from app.modules.transactions import service
from app.modules.transactions.schemas import MovementCreate, MovementRead
from tests.overlap import Operation, overlap
from tests.transactions_helpers import make_account, make_category, make_user_and_space

BACKEND_DIR = Path(__file__).resolve().parents[2]
TIMEOUT_SECONDS = 20
NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
LATER = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)
EVEN_LATER = datetime(2026, 10, 22, 12, 0, tzinfo=UTC)

LOCK_ACCOUNT = text("SELECT id FROM accounts WHERE id = :id FOR NO KEY UPDATE NOWAIT")
LOCK_TRANSACTION = text("SELECT id FROM transactions WHERE id = :id FOR NO KEY UPDATE NOWAIT")
adapter: TypeAdapter[Any] = TypeAdapter(MovementCreate)


@dataclass(frozen=True)
class World:
    user_id: uuid.UUID
    space_id: uuid.UUID
    bank_id: uuid.UUID
    cash_id: uuid.UUID
    savings_id: uuid.UUID
    category_id: uuid.UUID
    expense_id: uuid.UUID  # 1550 out of the bank
    other_expense_id: uuid.UUID  # 700 out of the cash


def _expense(world: World, account_id: uuid.UUID, amount: int = 1550) -> MovementCreate:
    data: MovementCreate = adapter.validate_python(
        {
            "type": "expense",
            "date": "2026-10-20",
            "account_id": account_id,
            "category_id": world.category_id,
            "amount_minor": amount,
        }
    )
    return data


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


async def _committed_world(engine: AsyncEngine, *, opening: int = 0) -> World:
    """A space with three accounts, a category and two expenses, all committed."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        user_id, space_id = await make_user_and_space(session, "uid-mutation")
        bank = await make_account(session, space_id, name="Itaú")
        cash = await make_account(session, space_id, type_="cash", name="Billetera")
        savings = await make_account(session, space_id, name="Ahorro")
        category = await make_category(session, space_id)
        if opening:
            await service.create_adjustment(session, space_id, user_id, bank.id, opening, now=NOW)
        world = World(
            user_id, space_id, bank.id, cash.id, savings.id, category.id, uuid.uuid4(), uuid.uuid4()
        )
        expense = await service.create_transaction(
            session, space_id, user_id, _expense(world, bank.id)
        )
        other = await service.create_transaction(
            session, space_id, user_id, _expense(world, cash.id, 700)
        )
        await session.commit()
        return World(
            user_id, space_id, bank.id, cash.id, savings.id, category.id, expense.id, other.id
        )


async def _scalar(engine: AsyncEngine, sql: str, **params: object) -> Any:
    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).scalar_one()


async def _balance(engine: AsyncEngine, account_id: uuid.UUID) -> Any:
    return await _scalar(
        engine,
        "SELECT coalesce(sum(e.amount_minor), 0) FROM entries e"
        " JOIN transactions t ON t.id = e.transaction_id"
        " WHERE e.account_id = :id AND t.status = 'confirmed' AND t.deleted_at IS NULL",
        id=account_id,
    )


async def _deleted_at(engine: AsyncEngine, transaction_id: uuid.UUID) -> Any:
    return await _scalar(
        engine, "SELECT deleted_at FROM transactions WHERE id = :id", id=transaction_id
    )


async def _entry_accounts(engine: AsyncEngine, transaction_id: uuid.UUID) -> list[uuid.UUID]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text("SELECT account_id FROM entries WHERE transaction_id = :id ORDER BY id"),
            {"id": transaction_id},
        )
        return [row[0] for row in rows]


def _edit(world: World, transaction_id: uuid.UUID, data: MovementCreate) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await service.update_transaction(
            session, world.space_id, transaction_id, data, now=LATER
        )

    return operation


def _delete(world: World, transaction_id: uuid.UUID, *, now: datetime = LATER) -> Operation:
    async def operation(session: AsyncSession) -> object:
        await service.delete_transaction(session, world.space_id, transaction_id, now=now)
        return None

    return operation


def _restore(world: World, transaction_id: uuid.UUID, *, now: datetime = EVEN_LATER) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await service.restore_transaction(session, world.space_id, transaction_id, now=now)

    return operation


def _archive(world: World, account_id: uuid.UUID) -> Operation:
    async def operation(session: AsyncSession) -> object:
        async def balance_of() -> int:
            return await service.get_account_balance(session, world.space_id, account_id)

        return await accounts_service.archive_account(
            session, world.space_id, account_id, balance_of=balance_of
        )

    return operation


def _reconcile(world: World, account_id: uuid.UUID, real_balance: int) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await service.reconcile_account(
            session,
            world.space_id,
            world.user_id,
            account_id,
            balance_minor=real_balance,
            now=NOW,
        )

    return operation


async def _can_lock(engine: AsyncEngine, statement: TextClause, row_id: uuid.UUID) -> bool:
    """Whether a `FOR NO KEY UPDATE` on that row is granted right now (NOWAIT: no waiting)."""
    async with engine.connect() as conn:
        try:
            await conn.execute(statement, {"id": row_id})
        except DBAPIError as exc:
            if "could not obtain lock" not in str(exc.orig):
                raise
            return False
        return True


# the locks of each operation, proved with NOWAIT ------------------------------------------------


async def test_nothing_in_flight_means_the_locks_are_granted(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator, prober, _ = engines
    world = await _committed_world(creator)

    assert await _can_lock(prober, LOCK_ACCOUNT, world.bank_id)
    assert await _can_lock(prober, LOCK_TRANSACTION, world.expense_id)


async def test_an_edit_in_flight_locks_its_transaction_and_both_the_old_and_the_new_account(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator, prober, _ = engines
    world = await _committed_world(creator)

    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        # The expense moves from the bank to the savings account.
        await _edit(world, world.expense_id, _expense(world, world.savings_id))(session)

        assert not await _can_lock(prober, LOCK_ACCOUNT, world.bank_id)  # the old account
        assert not await _can_lock(prober, LOCK_ACCOUNT, world.savings_id)  # the new one
        assert not await _can_lock(prober, LOCK_TRANSACTION, world.expense_id)
        assert await _can_lock(prober, LOCK_ACCOUNT, world.cash_id)  # only the accounts it uses
        assert await _can_lock(prober, LOCK_TRANSACTION, world.other_expense_id)
        await session.commit()

    assert await _can_lock(prober, LOCK_ACCOUNT, world.bank_id)
    assert await _can_lock(prober, LOCK_ACCOUNT, world.savings_id)
    assert await _can_lock(prober, LOCK_TRANSACTION, world.expense_id)


async def test_a_delete_in_flight_locks_its_transaction_and_its_account(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator, prober, _ = engines
    world = await _committed_world(creator)

    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        await _delete(world, world.expense_id)(session)

        assert not await _can_lock(prober, LOCK_ACCOUNT, world.bank_id)
        assert not await _can_lock(prober, LOCK_TRANSACTION, world.expense_id)
        assert await _can_lock(prober, LOCK_ACCOUNT, world.cash_id)
        await session.rollback()

    assert await _can_lock(prober, LOCK_ACCOUNT, world.bank_id)  # released by the rollback


async def test_a_restore_in_flight_locks_its_transaction_and_its_account(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator, prober, _ = engines
    world = await _committed_world(creator)
    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        await _delete(world, world.expense_id)(session)
        await session.commit()

    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        await _restore(world, world.expense_id)(session)

        assert not await _can_lock(prober, LOCK_ACCOUNT, world.bank_id)
        assert not await _can_lock(prober, LOCK_TRANSACTION, world.expense_id)
        assert await _can_lock(prober, LOCK_ACCOUNT, world.cash_id)
        await session.commit()

    assert await _can_lock(prober, LOCK_ACCOUNT, world.bank_id)


async def test_two_edits_over_the_same_account_do_not_wait_for_each_other(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator, other, _ = engines
    world = await _committed_world(creator)

    async with async_sessionmaker(creator, expire_on_commit=False)() as first:
        await _edit(world, world.expense_id, _expense(world, world.cash_id))(first)
        async with async_sessionmaker(other, expire_on_commit=False)() as second:
            # FOR SHARE is compatible with FOR SHARE, and the transactions are different rows.
            await asyncio.wait_for(
                _edit(world, world.other_expense_id, _expense(world, world.bank_id))(second),
                TIMEOUT_SECONDS,
            )
            await second.commit()
        await first.commit()

    assert await _entry_accounts(creator, world.expense_id) == [world.cash_id]
    assert await _entry_accounts(creator, world.other_expense_id) == [world.bank_id]


# archive and restore ----------------------------------------------------------------------------


async def test_an_archive_that_waits_for_a_restore_sees_the_balance_it_put_back(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator = engines[0]
    world = await _committed_world(creator)
    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        await _delete(world, world.expense_id)(session)
        await session.commit()
    # The balance of the bank is 0 now: only the restore stands between it and a clean archive.
    assert await _balance(creator, world.bank_id) == 0

    restored, archived = await overlap(
        engines, _restore(world, world.expense_id), _archive(world, world.bank_id)
    )

    assert isinstance(restored, MovementRead)
    assert isinstance(archived, ConflictError)
    assert archived.code == "account_has_balance"
    assert await _scalar(
        creator, "SELECT archived_at IS NULL FROM accounts WHERE id = :id", id=world.bank_id
    )
    assert await _balance(creator, world.bank_id) == -1550


async def test_a_restore_that_waits_for_an_archive_finds_the_account_archived(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator = engines[0]
    world = await _committed_world(creator)
    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        await _delete(world, world.expense_id)(session)
        await session.commit()

    _, restored = await overlap(
        engines, _archive(world, world.bank_id), _restore(world, world.expense_id)
    )

    assert isinstance(restored, ConflictError)
    assert restored.code == "account_archived"
    assert await _deleted_at(creator, world.expense_id) == LATER
    assert await _balance(creator, world.bank_id) == 0  # an archived account kept at zero


# reconcile and delete ---------------------------------------------------------------------------


async def test_a_reconciliation_that_waits_for_a_delete_reads_the_balance_after_it(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator = engines[0]
    world = await _committed_world(creator, opening=10_000)  # 10 000 - 1 550 = 8 450
    assert await _balance(creator, world.bank_id) == 8_450

    await overlap(
        engines, _delete(world, world.expense_id), _reconcile(world, world.bank_id, 12_000)
    )

    # Without the lock on the account the reconciliation would read 8 450 and write +3 550.
    assert await _balance(creator, world.bank_id) == 12_000


async def test_a_delete_that_waits_for_a_reconciliation_goes_after_it(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator = engines[0]
    world = await _committed_world(creator, opening=10_000)

    await overlap(
        engines, _reconcile(world, world.bank_id, 12_000), _delete(world, world.expense_id)
    )

    assert await _deleted_at(creator, world.expense_id) == LATER
    assert await _balance(creator, world.bank_id) == 12_000 + 1_550  # the delete came second


# the same movement ------------------------------------------------------------------------------


async def test_an_edit_that_waits_for_a_delete_of_the_same_movement_finds_it_deleted(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator = engines[0]
    world = await _committed_world(creator)

    _, edited = await overlap(
        engines,
        _delete(world, world.expense_id),
        _edit(world, world.expense_id, _expense(world, world.cash_id, 99)),
    )

    assert isinstance(edited, NotFoundError)
    assert edited.code == "transaction_not_found"
    assert await _deleted_at(creator, world.expense_id) == LATER
    assert await _entry_accounts(creator, world.expense_id) == [world.bank_id]


async def test_a_delete_that_waits_for_an_edit_of_the_same_movement_deletes_the_edited_one(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator = engines[0]
    world = await _committed_world(creator)

    await overlap(
        engines,
        _edit(world, world.expense_id, _expense(world, world.cash_id, 99)),
        _delete(world, world.expense_id),
    )

    assert await _deleted_at(creator, world.expense_id) == LATER
    assert await _entry_accounts(creator, world.expense_id) == [world.cash_id]
    assert await _balance(creator, world.cash_id) == -700  # the edited expense does not count


async def test_two_deletes_at_the_same_time_delete_once(engines: tuple[AsyncEngine, ...]) -> None:
    creator = engines[0]
    world = await _committed_world(creator)

    await overlap(
        engines,
        _delete(world, world.expense_id, now=LATER),
        _delete(world, world.expense_id, now=EVEN_LATER),
    )

    assert await _deleted_at(creator, world.expense_id) == LATER  # the second one changed nothing


async def test_two_restores_at_the_same_time_restore_once(engines: tuple[AsyncEngine, ...]) -> None:
    creator = engines[0]
    world = await _committed_world(creator)
    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        await _delete(world, world.expense_id)(session)
        await session.commit()

    await overlap(
        engines,
        _restore(world, world.expense_id, now=EVEN_LATER),
        _restore(world, world.expense_id, now=EVEN_LATER + (EVEN_LATER - LATER)),
    )

    assert await _deleted_at(creator, world.expense_id) is None
    assert await _balance(creator, world.bank_id) == -1550
    assert (
        await _scalar(
            creator,
            "SELECT updated_at FROM transactions WHERE id = :id",
            id=world.expense_id,
        )
        == EVEN_LATER
    )  # the second one found it already restored and wrote nothing


async def test_a_rolled_back_delete_lets_the_waiting_edit_go_on(
    engines: tuple[AsyncEngine, ...],
) -> None:
    creator = engines[0]
    world = await _committed_world(creator)

    _, edited = await overlap(
        engines,
        _delete(world, world.expense_id),
        _edit(world, world.expense_id, _expense(world, world.cash_id, 99)),
        first_commits=False,
    )

    assert isinstance(edited, MovementRead)
    assert await _deleted_at(creator, world.expense_id) is None
    assert await _balance(creator, world.cash_id) == -700 - 99
