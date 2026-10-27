"""Two creations with the same `Idempotency-Key` at the same time, on two real connections.

`create_movement` claims the key first with `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired`
and only then creates the movement. Two requests with the same key therefore meet at that INSERT:
the second one has to wait for the transaction of the first and, in READ COMMITTED, goes on
knowing what the first one did. If the first one commits, the key is taken and the second one
answers with the first movement (or with a 409 if its body differs); if it rolls back, the key never
existed and the second one creates its own movement. The same happens when the key is expired and
the first one replaces it (the `DO UPDATE` branch): the second one waits, then re-evaluates the
`WHERE` on the new version, finds it live and answers with the new movement, leaving the old one
untouched.

Against a live key `DO UPDATE ... WHERE` writes nothing, but PostgreSQL still locks the conflicting
row (`FOR NO KEY UPDATE`) until the request ends: the last tests show it with `NOWAIT` and with two
replays that run one after the other.

As in `test_account_reconcile_concurrency.py` the overlap is forced instead of hoped for
(`tests/overlap.py`): the first operation writes but does not end, the second has to block on it,
and only when a third connection sees a backend waiting on a lock does the first one end. If the
second never blocks (no lock between them) the helper times out and the test fails. The controls at
the end show that different keys, or the same key of another user, do not wait for each other.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.errors import ConflictError
from app.modules.spaces.models import SpaceMember
from app.modules.transactions import service as transactions_service
from app.modules.transactions.idempotency import IDEMPOTENCY_KEY_TTL
from app.modules.transactions.schemas import MovementCreate
from app.modules.users import service as users_service
from tests.overlap import Operation, overlap
from tests.transactions_helpers import make_account, make_category, make_user_and_space

BACKEND_DIR = Path(__file__).resolve().parents[2]
TIMEOUT_SECONDS = 20
NOW = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)
LONG_AGO = NOW - IDEMPOTENCY_KEY_TTL - timedelta(hours=1)  # a key created then is expired at NOW
KEY = uuid.UUID("0199a000-0000-4000-8000-00000000000a")
OTHER_KEY = uuid.UUID("0199a000-0000-4000-8000-00000000000b")
adapter: TypeAdapter[Any] = TypeAdapter(MovementCreate)


@dataclass(frozen=True)
class World:
    user_id: uuid.UUID
    other_user_id: uuid.UUID  # another member of the same space
    space_id: uuid.UUID
    account_id: uuid.UUID
    category_id: uuid.UUID

    def expense(self, amount_minor: int = 1550) -> MovementCreate:
        body: MovementCreate = adapter.validate_python(
            {
                "type": "expense",
                "date": "2026-10-20",
                "account_id": self.account_id,
                "category_id": self.category_id,
                "amount_minor": amount_minor,
            }
        )
        return body


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
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        user_id, space_id = await make_user_and_space(session, "uid-idempotency")
        other = await users_service.upsert_user(
            session, firebase_uid="uid-other", email="other@example.com", display_name=None
        )
        session.add(SpaceMember(user_id=other.id, space_id=space_id, role="member"))
        account = await make_account(session, space_id)
        category = await make_category(session, space_id)
        await session.commit()
        return World(user_id, other.id, space_id, account.id, category.id)


async def _scalar(engine: AsyncEngine, sql: str, **params: object) -> object:
    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).scalar_one()


def _create(
    world: World,
    key: uuid.UUID,
    data: MovementCreate,
    *,
    user_id: uuid.UUID | None = None,
    now: datetime = NOW,
) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await transactions_service.create_movement(
            session,
            world.space_id,
            user_id or world.user_id,
            data,
            idempotency_key=key,
            now=now,
        )

    return operation


async def _committed_key(engine: AsyncEngine, world: World, *, now: datetime) -> object:
    """Create a movement with `KEY` (the usual expense) as of `now` and commit; returns it."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        created = await _create(world, KEY, world.expense(), now=now)(session)
        await session.commit()
        return created


async def _movements(engine: AsyncEngine) -> object:
    return await _scalar(engine, "SELECT count(*) FROM transactions")


async def _entries(engine: AsyncEngine) -> object:
    return await _scalar(engine, "SELECT count(*) FROM entries")


async def _keys(engine: AsyncEngine) -> object:
    return await _scalar(engine, "SELECT count(*) FROM idempotency_keys")


async def _balance(engine: AsyncEngine, world: World) -> object:
    return await _scalar(
        engine,
        "SELECT coalesce(sum(amount_minor), 0) FROM entries WHERE account_id = :id",
        id=world.account_id,
    )


async def test_two_creations_with_the_same_key_leave_one_movement_and_both_answer_it(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await overlap(
        engines, _create(world, KEY, world.expense()), _create(world, KEY, world.expense())
    )

    # The second one waited for the key, found it taken and answered with the first movement.
    assert getattr(first, "id", None) is not None
    assert second == first
    assert await _movements(engine) == 1
    assert await _entries(engine) == 1
    assert await _keys(engine) == 1
    assert await _balance(engine, world) == -1550  # the balance changed once
    # Every committed key is tied to its movement (NULL only exists inside the claiming request).
    assert (
        await _scalar(engine, "SELECT count(*) FROM idempotency_keys WHERE transaction_id IS NULL")
        == 0
    )
    assert await _scalar(engine, "SELECT transaction_id FROM idempotency_keys") == getattr(
        first, "id", None
    )


async def test_the_same_key_with_another_body_waits_and_then_gets_the_409(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await overlap(
        engines,
        _create(world, KEY, world.expense(1550)),
        _create(world, KEY, world.expense(2000)),
    )

    assert getattr(first, "id", None) is not None
    assert getattr(second, "code", None) == "idempotency_key_reused"
    assert getattr(second, "status_code", None) == 409
    assert await _movements(engine) == 1
    assert await _keys(engine) == 1
    assert await _balance(engine, world) == -1550


async def test_when_the_first_creation_rolls_back_the_key_never_existed_and_the_second_creates(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await overlap(
        engines,
        _create(world, KEY, world.expense(1550)),
        _create(world, KEY, world.expense(2000)),
        first_commits=False,
    )

    assert getattr(first, "id", None) is not None  # it wrote, then rolled back
    assert getattr(second, "id", None) is not None
    assert getattr(second, "id", None) != getattr(first, "id", None)
    # Nothing of the first one survived, not even a 409 for the second body: only its movement.
    assert await _movements(engine) == 1
    assert await _keys(engine) == 1
    assert await _balance(engine, world) == -2000
    assert await _scalar(engine, "SELECT transaction_id FROM idempotency_keys") == getattr(
        second, "id", None
    )


# an expired key: the DO UPDATE branch ----------------------------------------------------------


async def test_two_claims_on_an_expired_key_replace_it_once_and_both_answer_the_new_movement(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)
    old = await _committed_key(engine, world, now=LONG_AGO)

    first, second = await overlap(
        engines, _create(world, KEY, world.expense()), _create(world, KEY, world.expense())
    )

    # The first one replaced the expired row; the second waited, re-evaluated the WHERE on the new
    # version (live now, created at NOW) and answered with the new movement.
    assert getattr(first, "id", None) is not None
    assert getattr(first, "id", None) != getattr(old, "id", None)
    assert second == first
    assert await _movements(engine) == 2  # the old one stays untouched
    assert await _entries(engine) == 2
    assert await _balance(engine, world) == -3100
    assert await _keys(engine) == 1  # replaced, not duplicated
    assert await _scalar(engine, "SELECT transaction_id FROM idempotency_keys") == getattr(
        first, "id", None
    )
    assert await _scalar(engine, "SELECT created_at FROM idempotency_keys") == NOW


async def test_a_second_claim_with_another_body_on_a_key_just_replaced_gets_the_409(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)
    old = await _committed_key(engine, world, now=LONG_AGO)

    first, second = await overlap(
        engines,
        _create(world, KEY, world.expense(1550)),
        _create(world, KEY, world.expense(2000)),
    )

    # The key is live again with the body of the first one; the second one's body is another.
    assert getattr(first, "id", None) not in (None, getattr(old, "id", None))
    assert getattr(second, "code", None) == "idempotency_key_reused"
    assert await _movements(engine) == 2
    assert await _balance(engine, world) == -3100
    assert await _scalar(engine, "SELECT transaction_id FROM idempotency_keys") == getattr(
        first, "id", None
    )


async def test_an_expired_key_replaced_and_rolled_back_leaves_the_old_row_as_it_was(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)
    old = await _committed_key(engine, world, now=LONG_AGO)

    first, second = await overlap(
        engines,
        _create(world, KEY, world.expense(1550)),
        _create(world, KEY, world.expense(2000)),
        first_commits=False,
    )

    # Nothing of the first one survived: the old row was expired, so the second one replaces it
    # (its own body, no 409) and the old movement is untouched.
    assert getattr(first, "id", None) is not None
    assert getattr(second, "id", None) not in (
        None,
        getattr(old, "id", None),
        getattr(first, "id", None),
    )
    assert await _movements(engine) == 2
    assert await _balance(engine, world) == -1550 - 2000
    assert await _keys(engine) == 1
    assert await _scalar(engine, "SELECT transaction_id FROM idempotency_keys") == getattr(
        second, "id", None
    )


# a live key: nothing is written, but the row stays locked until the request ends -------------


LOCK_THE_KEY = "SELECT key FROM idempotency_keys WHERE key = :key {mode} NOWAIT"


async def _lock_is_granted(engine: AsyncEngine, mode: str) -> bool:
    """Whether a row lock of `mode` on the key is granted right now (`NOWAIT`, no timing)."""
    async with engine.connect() as conn:
        try:
            await conn.execute(text(LOCK_THE_KEY.format(mode=mode)), {"key": KEY})
        except DBAPIError as exc:
            if "could not obtain lock" not in str(exc.orig):
                raise  # any other database error is a bug of the test
            return False
        return True


async def test_a_replay_in_flight_keeps_the_key_row_locked_until_it_ends(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine, prober, _ = engines
    world = await _committed_world(engine)
    created = await _committed_key(engine, world, now=NOW)
    assert await _lock_is_granted(prober, "FOR NO KEY UPDATE")  # control: nobody holds it

    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        again = await _create(world, KEY, world.expense())(session)  # a replay: it writes nothing

        assert again == created
        # PostgreSQL locks the conflicting row even if the WHERE of the DO UPDATE is false...
        assert not await _lock_is_granted(prober, "FOR NO KEY UPDATE")
        assert not await _lock_is_granted(prober, "FOR SHARE")
        # ...but only against writers and lockers of the row: a foreign key (FOR KEY SHARE) passes.
        assert await _lock_is_granted(prober, "FOR KEY SHARE")
        await session.commit()

    assert await _lock_is_granted(prober, "FOR NO KEY UPDATE")
    assert await _movements(engine) == 1  # and it wrote no movement


async def test_the_409_also_keeps_the_key_row_locked_until_it_ends(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine, prober, _ = engines
    world = await _committed_world(engine)
    await _committed_key(engine, world, now=NOW)

    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        with pytest.raises(ConflictError):
            await _create(world, KEY, world.expense(2000))(session)

        # The request has failed but its transaction is still open (get_session rolls it back).
        assert not await _lock_is_granted(prober, "FOR NO KEY UPDATE")
        await session.rollback()

    assert await _lock_is_granted(prober, "FOR NO KEY UPDATE")


async def test_two_replays_of_the_same_live_key_run_one_after_the_other(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)
    created = await _committed_key(engine, world, now=NOW)

    # `overlap` fails by timeout unless the second replay really blocks on the first one's lock.
    first, second = await overlap(
        engines, _create(world, KEY, world.expense()), _create(world, KEY, world.expense())
    )

    assert first == second == created
    assert await _movements(engine) == 1
    assert await _keys(engine) == 1


# controls: what must not wait --------------------------------------------------------------------


async def _runs_while_the_other_is_in_flight(
    engines: tuple[AsyncEngine, ...], first: Operation, second: Operation
) -> tuple[object, object]:
    """`second` finishes (and commits) while `first` is still open: no one waits for the other."""
    engine_a, engine_b, _ = engines
    async with async_sessionmaker(engine_a, expire_on_commit=False)() as open_session:
        in_flight = await first(open_session)
        async with async_sessionmaker(engine_b, expire_on_commit=False)() as other_session:
            done = await asyncio.wait_for(second(other_session), TIMEOUT_SECONDS)
            await other_session.commit()
        await open_session.commit()
    return in_flight, done


async def test_different_keys_do_not_wait_for_each_other(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await _runs_while_the_other_is_in_flight(
        engines, _create(world, KEY, world.expense()), _create(world, OTHER_KEY, world.expense())
    )

    assert getattr(first, "id", None) != getattr(second, "id", None)
    assert await _movements(engine) == 2
    assert await _keys(engine) == 2
    assert await _balance(engine, world) == -3100


async def test_the_same_key_of_another_member_does_not_wait_and_is_another_movement(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    mine, theirs = await _runs_while_the_other_is_in_flight(
        engines,
        _create(world, KEY, world.expense()),
        _create(world, KEY, world.expense(), user_id=world.other_user_id),
    )

    assert getattr(mine, "id", None) != getattr(theirs, "id", None)
    assert await _movements(engine) == 2
    assert await _keys(engine) == 2
