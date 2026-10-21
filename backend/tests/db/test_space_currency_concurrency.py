"""Changing the currency of a space while a movement is written in it, or changing it twice.

The currency can only change while the space has no transactions, and that fact lives in another
module (`transactions`). Without a lock, this order is wrong:

- the change reads "no transactions", a movement is confirmed (its amount is in the old currency),
  the currency is changed: the movement is now read with another exponent.

The fix is the lock: `spaces.service.update_space` reads the space `FOR UPDATE` and only then asks
`has_transactions`. Every insert into `transactions` takes `FOR KEY SHARE` on its space row (the
foreign key `fk_transactions_space_id_spaces`), and only `FOR UPDATE` conflicts with it: the
`FOR NO KEY UPDATE` that archives and reconciles use would not. So the two never overlap, and
whoever goes second sees what the first one committed (READ COMMITTED).

As in `test_account_archive_concurrency.py`, the overlap is forced instead of hoped for, on two
real connections (one engine per actor on a scratch database), with `tests/overlap.py`: if the
second operation never blocks on the first one's lock, the test fails.
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
from app.modules.spaces import service as spaces_service
from app.modules.spaces.schemas import SpaceUpdate
from app.modules.transactions import service as transactions_service
from tests.overlap import Operation, overlap
from tests.transactions_helpers import make_account, make_user_and_space

BACKEND_DIR = Path(__file__).resolve().parents[2]
_NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)


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
    """A UYU space with an active bank account and no transactions."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        user_id, space_id = await make_user_and_space(session, "uid-currency")
        account = await make_account(session, space_id, name="Itaú")
        await session.commit()
        return World(user_id, space_id, account.id)


async def _scalar(engine: AsyncEngine, sql: str, **params: object) -> object:
    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).scalar_one()


def _change_currency(world: World, code: str) -> Operation:
    async def operation(session: AsyncSession) -> object:
        async def has_transactions() -> bool:
            return await transactions_service.space_has_transactions(session, world.space_id)

        return await spaces_service.update_space(
            session,
            world.space_id,
            SpaceUpdate.model_validate({"currency": code}),
            has_transactions=has_transactions,
        )

    return operation


def _add_money(world: World) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await transactions_service.create_adjustment(
            session, world.space_id, world.user_id, world.account_id, 100, now=_NOW
        )

    return operation


async def _currency(engine: AsyncEngine, space_id: uuid.UUID) -> object:
    return await _scalar(engine, "SELECT currency FROM spaces WHERE id = :id", id=space_id)


async def _transaction_count(engine: AsyncEngine, space_id: uuid.UUID) -> object:
    return await _scalar(
        engine, "SELECT count(*) FROM transactions WHERE space_id = :id", id=space_id
    )


async def test_changing_the_currency_while_a_movement_is_being_written_is_refused(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    movement, change = await overlap(engines, _add_money(world), _change_currency(world, "USD"))

    assert getattr(movement, "type", None) == "adjustment"
    # The change waited for the movement, then saw it committed and refused.
    assert isinstance(change, ConflictError)
    assert change.code == "space_has_transactions"
    assert await _currency(engine, world.space_id) == "UYU"
    assert await _transaction_count(engine, world.space_id) == 1


async def test_a_movement_written_while_the_currency_is_being_changed_waits_for_the_change(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    change, movement = await overlap(engines, _change_currency(world, "USD"), _add_money(world))

    assert getattr(getattr(change, "currency", None), "code", None) == "USD"
    # The movement waited for the change and was written afterwards, so it is in the new currency;
    # it was never written under the old one.
    assert getattr(movement, "type", None) == "adjustment"
    assert await _currency(engine, world.space_id) == "USD"
    assert await _transaction_count(engine, world.space_id) == 1


async def test_two_changes_at_the_same_time_end_with_the_last_one(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await overlap(
        engines, _change_currency(world, "USD"), _change_currency(world, "COP")
    )

    assert getattr(getattr(first, "currency", None), "code", None) == "USD"
    # The second one waited, read the space as the first one left it and changed it again.
    assert getattr(getattr(second, "currency", None), "code", None) == "COP"
    assert await _currency(engine, world.space_id) == "COP"


async def test_a_change_to_the_same_currency_waits_and_then_changes_nothing(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await overlap(
        engines, _change_currency(world, "USD"), _change_currency(world, "USD")
    )

    assert getattr(getattr(first, "currency", None), "code", None) == "USD"
    assert getattr(getattr(second, "currency", None), "code", None) == "USD"
    assert await _currency(engine, world.space_id) == "USD"
