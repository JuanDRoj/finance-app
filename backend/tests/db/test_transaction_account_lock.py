"""`create_transaction` reads its accounts `FOR SHARE` until the request commits.

Creating a movement reads the account ("is it active?") and then writes entries that depend on it.
The foreign key of an entry only takes `FOR KEY SHARE` on the account, which does not conflict with
the `UPDATE` that archives it, so without an explicit lock an archive can run between the read and
the write and leave an archived account with a balance. The archive
(`accounts.service.archive_account`) reads the account `FOR NO KEY UPDATE`, computes the balance and
then updates; these tests prove the creation half of that contract deterministically, with `NOWAIT`
instead of timing (the overlap of both halves is in `test_account_archive_concurrency.py`): while a
creation is in flight, a `FOR NO KEY UPDATE` on its accounts is refused at once. The control cases
show the probe is not vacuous (nothing in flight, or the creation already committed: the
lock is granted).

Two creations at the same time must not wait for each other: `FOR SHARE` is compatible with itself.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.modules.transactions import service
from app.modules.transactions.schemas import TransactionCreate
from tests.transactions_helpers import make_account, make_user_and_space

BACKEND_DIR = Path(__file__).resolve().parents[2]
TIMEOUT_SECONDS = 20

LOCK_THE_ACCOUNT = text("SELECT id FROM accounts WHERE id = :id FOR NO KEY UPDATE NOWAIT")
adapter: TypeAdapter[TransactionCreate] = TypeAdapter(TransactionCreate)


@dataclass(frozen=True)
class World:
    user_id: uuid.UUID
    space_id: uuid.UUID
    bank_id: uuid.UUID
    cash_id: uuid.UUID


@pytest.fixture
async def engines(scratch_database_url: str) -> AsyncIterator[tuple[AsyncEngine, AsyncEngine]]:
    """Two engines on the migrated scratch database: the creator and the one that probes."""
    await asyncio.to_thread(command.upgrade, Config(str(BACKEND_DIR / "alembic.ini")), "head")
    created = (
        create_async_engine(scratch_database_url),
        create_async_engine(scratch_database_url),
    )
    try:
        yield created
    finally:
        for engine in created:
            await engine.dispose()


async def _committed_world(engine: AsyncEngine) -> World:
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        user_id, space_id = await make_user_and_space(session, "uid-lock")
        bank = await make_account(session, space_id, name="Itaú")
        cash = await make_account(session, space_id, type_="cash", name="Billetera")
        await session.commit()
        return World(user_id, space_id, bank.id, cash.id)


def _adjustment(account_id: uuid.UUID) -> TransactionCreate:
    return adapter.validate_python(
        {"type": "adjustment", "date": "2026-10-20", "account_id": account_id, "amount_minor": 100}
    )


def _transfer(from_id: uuid.UUID, to_id: uuid.UUID) -> TransactionCreate:
    return adapter.validate_python(
        {
            "type": "transfer",
            "date": "2026-10-20",
            "from_account_id": from_id,
            "to_account_id": to_id,
            "amount_minor": 100,
        }
    )


async def _can_lock_for_update(engine: AsyncEngine, account_id: uuid.UUID) -> bool:
    """Whether a `FOR NO KEY UPDATE` (what an archive takes) is granted right now."""
    async with engine.connect() as conn:
        try:
            await conn.execute(LOCK_THE_ACCOUNT, {"id": account_id})
        except DBAPIError as exc:
            return _is_lock_not_available(exc)
        return True


def _is_lock_not_available(exc: DBAPIError) -> bool:
    """False for the expected refusal (55P03); any other database error is a bug of the test."""
    if "could not obtain lock" not in str(exc.orig):
        raise exc
    return False


async def test_nothing_in_flight_means_the_archive_lock_is_granted(
    engines: tuple[AsyncEngine, AsyncEngine],
) -> None:
    creator, prober = engines
    world = await _committed_world(creator)

    assert await _can_lock_for_update(prober, world.bank_id)


async def test_a_creation_in_flight_blocks_the_archive_lock_on_its_account(
    engines: tuple[AsyncEngine, AsyncEngine],
) -> None:
    creator, prober = engines
    world = await _committed_world(creator)

    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        await service.create_transaction(
            session, world.space_id, world.user_id, _adjustment(world.bank_id)
        )

        assert not await _can_lock_for_update(prober, world.bank_id)
        assert await _can_lock_for_update(prober, world.cash_id)  # only the accounts it uses


async def test_a_transfer_in_flight_locks_both_of_its_accounts(
    engines: tuple[AsyncEngine, AsyncEngine],
) -> None:
    creator, prober = engines
    world = await _committed_world(creator)

    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        await service.create_transaction(
            session, world.space_id, world.user_id, _transfer(world.bank_id, world.cash_id)
        )

        assert not await _can_lock_for_update(prober, world.bank_id)
        assert not await _can_lock_for_update(prober, world.cash_id)


async def test_the_lock_is_released_when_the_creation_commits(
    engines: tuple[AsyncEngine, AsyncEngine],
) -> None:
    creator, prober = engines
    world = await _committed_world(creator)

    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        await service.create_transaction(
            session, world.space_id, world.user_id, _adjustment(world.bank_id)
        )
        assert not await _can_lock_for_update(prober, world.bank_id)
        await session.commit()

    assert await _can_lock_for_update(prober, world.bank_id)


async def test_the_lock_is_released_when_the_creation_rolls_back(
    engines: tuple[AsyncEngine, AsyncEngine],
) -> None:
    creator, prober = engines
    world = await _committed_world(creator)

    async with async_sessionmaker(creator, expire_on_commit=False)() as session:
        await service.create_transaction(
            session, world.space_id, world.user_id, _adjustment(world.bank_id)
        )
        await session.rollback()

    assert await _can_lock_for_update(prober, world.bank_id)


async def test_two_creations_on_the_same_account_do_not_wait_for_each_other(
    engines: tuple[AsyncEngine, AsyncEngine],
) -> None:
    creator, other = engines
    world = await _committed_world(creator)

    async with async_sessionmaker(creator, expire_on_commit=False)() as first:
        await service.create_transaction(
            first, world.space_id, world.user_id, _adjustment(world.bank_id)
        )
        async with async_sessionmaker(other, expire_on_commit=False)() as second:
            # FOR SHARE is compatible with FOR SHARE: this must not block behind the first one.
            await asyncio.wait_for(
                service.create_transaction(
                    second, world.space_id, world.user_id, _adjustment(world.bank_id)
                ),
                TIMEOUT_SECONDS,
            )
            await second.commit()
        await first.commit()
