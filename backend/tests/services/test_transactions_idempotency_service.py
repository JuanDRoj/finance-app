"""`create_movement`: a movement created with an `Idempotency-Key` is created once.

The key is claimed first (`INSERT ... ON CONFLICT`), then the movement is created as always, then
the key is tied to it, all in the transaction of the request. A second call with the same key and
the same body answers with the movement that already exists; with another body it is a 409.
Keys expire after 24 hours. The overlap of two real connections is in
`tests/db/test_transaction_idempotency_concurrency.py`.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from pydantic import TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.modules.categories import service as categories_service
from app.modules.spaces.models import Space, SpaceMember
from app.modules.transactions import service
from app.modules.transactions.idempotency import IDEMPOTENCY_KEY_TTL, request_fingerprint
from app.modules.transactions.models import Entry, IdempotencyKey, Transaction
from app.modules.transactions.schemas import MovementCreate
from app.modules.users import service as users_service
from tests.transactions_helpers import make_account, make_category, make_user_and_space

adapter: TypeAdapter[Any] = TypeAdapter(MovementCreate)
DAY = "2026-10-20"
NOW = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)
KEY = uuid.UUID("0199a000-0000-4000-8000-00000000000a")
OTHER_KEY = uuid.UUID("0199a000-0000-4000-8000-00000000000b")
REUSED = "idempotency_key_reused"


def _expense(account_id: uuid.UUID, category_id: uuid.UUID, **fields: Any) -> MovementCreate:
    body: MovementCreate = adapter.validate_python(
        {
            "type": "expense",
            "date": DAY,
            "account_id": str(account_id),
            "category_id": str(category_id),
            "amount_minor": 1550,
            **fields,
        }
    )
    return body


async def _create(
    session: AsyncSession,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    data: MovementCreate,
    key: uuid.UUID | None = KEY,
    *,
    now: datetime = NOW,
) -> Any:
    return await service.create_movement(
        session, space_id, user_id, data, idempotency_key=key, now=now
    )


async def _count(session: AsyncSession, model: type[Any]) -> int:
    return await session.scalar(select(func.count()).select_from(model)) or 0


async def _keys(session: AsyncSession) -> list[IdempotencyKey]:
    stmt = select(IdempotencyKey).order_by(IdempotencyKey.created_at)
    rows = await session.scalars(stmt.execution_options(populate_existing=True))
    return list(rows)


async def _balance(session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID) -> int:
    return await service.get_account_balance(session, space_id, account_id)


class World:
    """A user with a space, an active account and an expense category."""

    def __init__(
        self, user_id: uuid.UUID, space_id: uuid.UUID, account_id: uuid.UUID, category_id: uuid.UUID
    ) -> None:
        self.user_id = user_id
        self.space_id = space_id
        self.account_id = account_id
        self.category_id = category_id

    def expense(self, **fields: Any) -> MovementCreate:
        return _expense(self.account_id, self.category_id, **fields)


async def _world(session: AsyncSession, uid: str = "uid-a") -> World:
    user_id, space_id = await make_user_and_space(session, uid)
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    return World(user_id, space_id, account.id, category.id)


# without a key ---------------------------------------------------------------------------------


async def test_without_a_key_it_is_a_plain_creation_and_leaves_no_key(
    session: AsyncSession,
) -> None:
    world = await _world(session)

    first = await _create(session, world.space_id, world.user_id, world.expense(), None)
    second = await _create(session, world.space_id, world.user_id, world.expense(), None)

    assert first.id != second.id
    assert await _count(session, Transaction) == 2
    assert await _count(session, IdempotencyKey) == 0
    assert await _balance(session, world.space_id, world.account_id) == -3100


# with a key ------------------------------------------------------------------------------------


async def test_the_first_call_creates_the_movement_and_ties_the_key_to_it(
    session: AsyncSession,
) -> None:
    world = await _world(session)
    data = world.expense()

    created = await _create(session, world.space_id, world.user_id, data)

    [stored] = await _keys(session)
    assert (stored.space_id, stored.user_id, stored.key) == (world.space_id, world.user_id, KEY)
    assert stored.transaction_id == created.id
    assert stored.request_hash == request_fingerprint(data)
    assert stored.created_at == NOW
    assert created.status == "confirmed"
    assert await _balance(session, world.space_id, world.account_id) == -1550


async def test_the_same_key_and_body_answers_with_the_same_movement_and_writes_nothing(
    session: AsyncSession,
) -> None:
    world = await _world(session)
    first = await _create(session, world.space_id, world.user_id, world.expense())
    before = (await _count(session, Transaction), await _count(session, Entry))

    again = await _create(session, world.space_id, world.user_id, world.expense())

    assert again == first
    assert again.model_dump() == first.model_dump()
    assert (await _count(session, Transaction), await _count(session, Entry)) == before == (1, 1)
    assert await _count(session, IdempotencyKey) == 1
    assert await _balance(session, world.space_id, world.account_id) == -1550


async def test_a_transfer_is_replayed_with_both_of_its_entries_in_the_same_order(
    session: AsyncSession,
) -> None:
    world = await _world(session)
    cash = await make_account(session, world.space_id, type_="cash", name="Billetera")
    transfer: MovementCreate = adapter.validate_python(
        {
            "type": "transfer",
            "date": DAY,
            "from_account_id": str(world.account_id),
            "to_account_id": str(cash.id),
            "amount_minor": 3_000,
        }
    )

    first = await _create(session, world.space_id, world.user_id, transfer)
    again = await _create(session, world.space_id, world.user_id, transfer)

    assert [e.amount_minor for e in again.entries] == [-3_000, 3_000]
    assert again == first
    assert await _count(session, Entry) == 2


async def test_another_spelling_of_the_same_body_is_the_same_request(session: AsyncSession) -> None:
    world = await _world(session)
    first = await _create(
        session, world.space_id, world.user_id, world.expense(description="Súper")
    )

    again = await _create(
        session, world.space_id, world.user_id, world.expense(description="  Súper ")
    )

    assert again == first
    assert await _count(session, Transaction) == 1


async def test_the_same_key_with_another_body_is_a_409_and_writes_nothing(
    session: AsyncSession,
) -> None:
    world = await _world(session)
    await _create(session, world.space_id, world.user_id, world.expense())

    with pytest.raises(ConflictError) as error:
        await _create(session, world.space_id, world.user_id, world.expense(amount_minor=1551))

    assert (error.value.code, error.value.status_code) == (REUSED, 409)
    assert await _count(session, Transaction) == 1
    assert await _count(session, Entry) == 1
    assert await _balance(session, world.space_id, world.account_id) == -1550
    [stored] = await _keys(session)
    assert stored.request_hash == request_fingerprint(world.expense())


async def test_the_same_key_with_another_type_is_a_409(session: AsyncSession) -> None:
    world = await _world(session)
    income_category = await make_category(session, world.space_id, kind="income", name="Sueldo")
    await _create(session, world.space_id, world.user_id, world.expense())
    income: MovementCreate = adapter.validate_python(
        {
            "type": "income",
            "date": DAY,
            "account_id": str(world.account_id),
            "category_id": str(income_category.id),
            "amount_minor": 1550,
        }
    )

    with pytest.raises(ConflictError) as error:
        await _create(session, world.space_id, world.user_id, income)

    assert error.value.code == REUSED


async def test_another_key_with_the_same_body_is_another_movement(session: AsyncSession) -> None:
    world = await _world(session)

    first = await _create(session, world.space_id, world.user_id, world.expense(), KEY)
    second = await _create(session, world.space_id, world.user_id, world.expense(), OTHER_KEY)

    assert first.id != second.id
    assert await _count(session, Transaction) == 2
    assert len(await _keys(session)) == 2
    assert await _balance(session, world.space_id, world.account_id) == -3100


async def test_a_replay_does_not_validate_again(session: AsyncSession) -> None:
    world = await _world(session)
    first = await _create(session, world.space_id, world.user_id, world.expense())
    await categories_service.archive_category(session, world.space_id, world.category_id)

    again = await _create(session, world.space_id, world.user_id, world.expense())

    assert again == first


async def test_a_replay_returns_the_movement_even_if_it_was_deleted_afterwards(
    session: AsyncSession,
) -> None:
    world = await _world(session)
    first = await _create(session, world.space_id, world.user_id, world.expense())
    stored = await session.get_one(Transaction, first.id)
    stored.deleted_at = NOW + timedelta(minutes=1)
    await session.flush()

    again = await _create(session, world.space_id, world.user_id, world.expense())

    assert again == first
    assert await _count(session, Transaction) == 1


# the scope of a key: (space, user, key) --------------------------------------------------------


async def test_another_member_of_the_same_space_with_the_same_key_is_not_a_replay(
    session: AsyncSession,
) -> None:
    world = await _world(session)
    other = await users_service.upsert_user(
        session, firebase_uid="uid-b", email="uid-b@example.com", display_name=None
    )
    session.add(SpaceMember(user_id=other.id, space_id=world.space_id, role="member"))
    await session.flush()

    mine = await _create(session, world.space_id, world.user_id, world.expense())
    theirs = await _create(session, world.space_id, other.id, world.expense(amount_minor=999))

    assert mine.id != theirs.id
    assert [e.amount_minor for e in theirs.entries] == [-999]
    assert await _count(session, IdempotencyKey) == 2
    # each one still replays its own
    assert await _create(session, world.space_id, world.user_id, world.expense()) == mine
    assert (
        await _create(session, world.space_id, other.id, world.expense(amount_minor=999)) == theirs
    )


async def test_the_same_user_in_another_space_with_the_same_key_is_not_a_replay(
    session: AsyncSession,
) -> None:
    world = await _world(session)
    household = Space(
        name="Casa",
        type="household",
        currency="UYU",
        timezone="America/Montevideo",
        created_by=world.user_id,
    )
    session.add(household)
    await session.flush()
    session.add(SpaceMember(user_id=world.user_id, space_id=household.id, role="owner"))
    account = await make_account(session, household.id, name="Cuenta de la casa")
    category = await make_category(session, household.id, name="Servicios")
    await session.flush()

    here = await _create(session, world.space_id, world.user_id, world.expense())
    there = await _create(session, household.id, world.user_id, _expense(account.id, category.id))

    assert here.id != there.id
    assert await _count(session, Transaction) == 2
    assert (
        await _create(session, household.id, world.user_id, _expense(account.id, category.id))
        == there
    )


# expiry ----------------------------------------------------------------------------------------


async def test_a_key_still_counts_one_second_before_it_expires(session: AsyncSession) -> None:
    world = await _world(session)
    first = await _create(session, world.space_id, world.user_id, world.expense())

    again = await _create(
        session,
        world.space_id,
        world.user_id,
        world.expense(),
        now=NOW + IDEMPOTENCY_KEY_TTL - timedelta(seconds=1),
    )

    assert again == first
    assert await _count(session, Transaction) == 1


async def test_an_expired_key_is_replaced_by_a_new_movement(session: AsyncSession) -> None:
    world = await _world(session)
    first = await _create(session, world.space_id, world.user_id, world.expense())
    later = NOW + IDEMPOTENCY_KEY_TTL

    second = await _create(session, world.space_id, world.user_id, world.expense(), now=later)

    assert second.id != first.id
    assert await _count(session, Transaction) == 2
    [stored] = await _keys(session)  # replaced, not duplicated
    assert (stored.transaction_id, stored.created_at) == (second.id, later)
    # and the new one is the one that replays now
    assert (
        await _create(session, world.space_id, world.user_id, world.expense(), now=later) == second
    )


async def test_an_expired_key_does_not_complain_about_another_body(session: AsyncSession) -> None:
    world = await _world(session)
    first = await _create(session, world.space_id, world.user_id, world.expense())

    second = await _create(
        session,
        world.space_id,
        world.user_id,
        world.expense(amount_minor=2000),
        now=NOW + IDEMPOTENCY_KEY_TTL + timedelta(seconds=1),
    )

    assert second.id != first.id
    assert [e.amount_minor for e in second.entries] == [-2000]
    [stored] = await _keys(session)
    assert stored.request_hash == request_fingerprint(world.expense(amount_minor=2000))
