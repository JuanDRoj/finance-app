import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.modules.accounts.models import Account
from app.modules.spaces.models import Space
from app.modules.transactions.models import Entry, Transaction
from app.modules.users.models import User

BACKEND_DIR = Path(__file__).resolve().parents[2]
MAX_SAFE_INTEGER = 2**53 - 1


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


async def _user(engine: AsyncEngine, firebase_uid: str = "uid-1") -> uuid.UUID:
    user_id = uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO users (id, firebase_uid, email) VALUES (:id, :uid, 'a@example.com')",
        id=user_id,
        uid=firebase_uid,
    )
    return user_id


async def _space(engine: AsyncEngine, user_id: uuid.UUID | None = None) -> uuid.UUID:
    space_id = uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO spaces (id, name, type, currency, timezone, created_by) "
        "VALUES (:id, 'Mi espacio', 'personal', 'UYU', 'America/Montevideo', :created_by)",
        id=space_id,
        created_by=user_id or await _user(engine, f"uid-{uuid.uuid4().hex[:8]}"),
    )
    return space_id


async def _account(engine: AsyncEngine, space_id: uuid.UUID) -> uuid.UUID:
    account_id = uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO accounts (id, space_id, name, type) VALUES (:id, :space_id, 'Itaú', 'bank')",
        id=account_id,
        space_id=space_id,
    )
    return account_id


async def _category(engine: AsyncEngine, space_id: uuid.UUID) -> uuid.UUID:
    category_id = uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO categories (id, space_id, name, kind, icon) "
        "VALUES (:id, :space_id, 'Comida', 'expense', 'fork-knife')",
        id=category_id,
        space_id=space_id,
    )
    return category_id


async def _transaction(
    engine: AsyncEngine,
    space_id: uuid.UUID,
    created_by: uuid.UUID,
    *,
    type_: str = "adjustment",
    status: str = "confirmed",
    description: str | None = None,
) -> uuid.UUID:
    transaction_id = uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO transactions (id, space_id, type, status, date, description, created_by) "
        "VALUES (:id, :space_id, :type, :status, '2026-10-20', :description, :created_by)",
        id=transaction_id,
        space_id=space_id,
        type=type_,
        status=status,
        description=description,
        created_by=created_by,
    )
    return transaction_id


async def _entry(
    engine: AsyncEngine,
    transaction_id: uuid.UUID,
    space_id: uuid.UUID,
    account_id: uuid.UUID,
    *,
    amount: int = 1000,
    category_id: uuid.UUID | None = None,
) -> None:
    await _exec(
        engine,
        "INSERT INTO entries (id, transaction_id, space_id, account_id, amount_minor, category_id) "
        "VALUES (:id, :transaction_id, :space_id, :account_id, :amount, :category_id)",
        id=uuid.uuid4(),
        transaction_id=transaction_id,
        space_id=space_id,
        account_id=account_id,
        amount=amount,
        category_id=category_id,
    )


class World:
    """A user with a space, one account and one transaction ready to receive entries."""

    def __init__(
        self,
        user_id: uuid.UUID,
        space_id: uuid.UUID,
        account_id: uuid.UUID,
        transaction_id: uuid.UUID,
    ) -> None:
        self.user_id = user_id
        self.space_id = space_id
        self.account_id = account_id
        self.transaction_id = transaction_id


async def _world(engine: AsyncEngine) -> World:
    user_id = await _user(engine)
    space_id = await _space(engine, user_id)
    account_id = await _account(engine, space_id)
    transaction_id = await _transaction(engine, space_id, user_id)
    return World(user_id, space_id, account_id, transaction_id)


# structure ----------------------------------------------------------------------------------


async def test_migration_creates_the_transactions_table_with_the_expected_columns(
    engine: AsyncEngine,
) -> None:
    rows = await _rows(
        engine,
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
        "WHERE table_name = 'transactions'",
    )

    assert {c: (d, n) for c, d, n in rows} == {
        "id": ("uuid", "NO"),
        "space_id": ("uuid", "NO"),
        "type": ("text", "NO"),
        "status": ("text", "NO"),
        "date": ("date", "NO"),
        "description": ("text", "YES"),
        "created_by": ("uuid", "NO"),
        "created_at": ("timestamp with time zone", "NO"),
        "updated_at": ("timestamp with time zone", "NO"),
        "deleted_at": ("timestamp with time zone", "YES"),
    }


async def test_migration_creates_the_entries_table_with_the_expected_columns(
    engine: AsyncEngine,
) -> None:
    rows = await _rows(
        engine,
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
        "WHERE table_name = 'entries'",
    )

    assert {c: (d, n) for c, d, n in rows} == {
        "id": ("uuid", "NO"),
        "transaction_id": ("uuid", "NO"),
        "space_id": ("uuid", "NO"),
        "account_id": ("uuid", "NO"),
        "amount_minor": ("bigint", "NO"),
        "category_id": ("uuid", "YES"),
    }


async def test_the_expected_indexes_and_constraints_exist(engine: AsyncEngine) -> None:
    indexes = {r[0] for r in await _rows(engine, "SELECT indexname FROM pg_indexes")}
    constraints = {r[0] for r in await _rows(engine, "SELECT conname FROM pg_constraint")}

    assert {
        "ix_transactions_space_id_date_id_active",
        "ix_entries_transaction_id",
        "ix_entries_account_id",
    } <= indexes
    assert {
        "pk_transactions",
        "pk_entries",
        "uq_transactions_id_space_id",
        "uq_accounts_id_space_id",
        "uq_categories_id_space_id",
        "fk_transactions_space_id_spaces",
        "fk_transactions_created_by_users",
        "fk_entries_transaction_id_space_id_transactions",
        "fk_entries_account_id_space_id_accounts",
        "fk_entries_category_id_space_id_categories",
        "ck_transactions_type",
        "ck_transactions_status",
        "ck_transactions_description_not_blank",
        "ck_transactions_description_length",
        "ck_entries_amount_not_zero",
        "ck_entries_amount_range",
    } <= constraints


async def test_the_listing_index_is_partial_and_ordered_newest_first(engine: AsyncEngine) -> None:
    [(definition,)] = await _rows(
        engine,
        "SELECT indexdef FROM pg_indexes "
        "WHERE indexname = 'ix_transactions_space_id_date_id_active'",
    )

    assert isinstance(definition, str)
    assert "(space_id, date DESC, id DESC)" in definition
    assert "WHERE (deleted_at IS NULL)" in definition


# transactions: valid rows and checks ------------------------------------------------------------


@pytest.mark.parametrize("type_", ["expense", "income", "transfer", "adjustment"])
@pytest.mark.parametrize("status", ["pending", "confirmed", "skipped"])
async def test_every_type_and_status_is_accepted(
    engine: AsyncEngine, type_: str, status: str
) -> None:
    world = await _world(engine)

    await _transaction(engine, world.space_id, world.user_id, type_=type_, status=status)


async def test_an_unknown_type_is_rejected(engine: AsyncEngine) -> None:
    world = await _world(engine)

    with pytest.raises(IntegrityError, match="ck_transactions_type"):
        await _transaction(engine, world.space_id, world.user_id, type_="refund")


async def test_an_unknown_status_is_rejected(engine: AsyncEngine) -> None:
    world = await _world(engine)

    with pytest.raises(IntegrityError, match="ck_transactions_status"):
        await _transaction(engine, world.space_id, world.user_id, status="deleted")


@pytest.mark.parametrize("description", ["", "   ", " "])
async def test_a_blank_description_is_rejected(engine: AsyncEngine, description: str) -> None:
    world = await _world(engine)

    with pytest.raises(IntegrityError, match="ck_transactions_description_not_blank"):
        await _transaction(engine, world.space_id, world.user_id, description=description)


async def test_a_description_longer_than_200_characters_is_rejected(engine: AsyncEngine) -> None:
    world = await _world(engine)

    await _transaction(engine, world.space_id, world.user_id, description="a" * 200)
    with pytest.raises(IntegrityError, match="ck_transactions_description_length"):
        await _transaction(engine, world.space_id, world.user_id, description="a" * 201)


async def test_the_description_may_be_null(engine: AsyncEngine) -> None:
    world = await _world(engine)

    await _transaction(engine, world.space_id, world.user_id, description=None)


# transactions: foreign keys ---------------------------------------------------------------------


async def test_the_space_must_exist(engine: AsyncEngine) -> None:
    user_id = await _user(engine)

    with pytest.raises(IntegrityError, match="fk_transactions_space_id_spaces"):
        await _transaction(engine, uuid.uuid4(), user_id)


async def test_the_creator_must_exist(engine: AsyncEngine) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match="fk_transactions_created_by_users"):
        await _transaction(engine, space_id, uuid.uuid4())


async def test_a_space_with_transactions_cannot_be_deleted(engine: AsyncEngine) -> None:
    user_id = await _user(engine)
    space_id = await _space(
        engine, user_id
    )  # no account, so only the transaction stands in the way
    await _transaction(engine, space_id, user_id)

    with pytest.raises(IntegrityError, match="fk_transactions_space_id_spaces"):
        await _exec(engine, "DELETE FROM spaces WHERE id = :id", id=space_id)


async def test_a_user_with_transactions_cannot_be_deleted(engine: AsyncEngine) -> None:
    world = await _world(engine)
    author = await _user(engine, "uid-author")  # not the creator of the space: only the transaction
    await _transaction(engine, world.space_id, author)

    with pytest.raises(IntegrityError, match="fk_transactions_created_by_users"):
        await _exec(engine, "DELETE FROM users WHERE id = :id", id=author)


# entries: checks --------------------------------------------------------------------------------


@pytest.mark.parametrize("amount", [1, -1, 1550, -1550, MAX_SAFE_INTEGER, -MAX_SAFE_INTEGER])
async def test_entries_with_a_signed_amount_are_accepted(engine: AsyncEngine, amount: int) -> None:
    world = await _world(engine)

    await _entry(engine, world.transaction_id, world.space_id, world.account_id, amount=amount)


async def test_an_entry_of_zero_is_rejected(engine: AsyncEngine) -> None:
    world = await _world(engine)

    with pytest.raises(IntegrityError, match="ck_entries_amount_not_zero"):
        await _entry(engine, world.transaction_id, world.space_id, world.account_id, amount=0)


@pytest.mark.parametrize("amount", [MAX_SAFE_INTEGER + 1, -MAX_SAFE_INTEGER - 1])
async def test_an_entry_beyond_the_js_safe_limit_is_rejected(
    engine: AsyncEngine, amount: int
) -> None:
    world = await _world(engine)

    with pytest.raises(IntegrityError, match="ck_entries_amount_range"):
        await _entry(engine, world.transaction_id, world.space_id, world.account_id, amount=amount)


async def test_an_entry_may_have_no_category_or_a_category_of_its_space(
    engine: AsyncEngine,
) -> None:
    world = await _world(engine)
    category_id = await _category(engine, world.space_id)

    await _entry(engine, world.transaction_id, world.space_id, world.account_id)
    await _entry(
        engine,
        world.transaction_id,
        world.space_id,
        world.account_id,
        category_id=category_id,
    )


# entries: the space is the same everywhere ----------------------------------------------------


async def test_an_entry_cannot_use_an_account_of_another_space(engine: AsyncEngine) -> None:
    world = await _world(engine)
    other_space = await _space(engine)
    foreign_account = await _account(engine, other_space)

    with pytest.raises(IntegrityError, match="fk_entries_account_id_space_id_accounts"):
        await _entry(engine, world.transaction_id, world.space_id, foreign_account)


async def test_an_entry_cannot_use_a_category_of_another_space(engine: AsyncEngine) -> None:
    world = await _world(engine)
    other_space = await _space(engine)
    foreign_category = await _category(engine, other_space)

    with pytest.raises(IntegrityError, match="fk_entries_category_id_space_id_categories"):
        await _entry(
            engine,
            world.transaction_id,
            world.space_id,
            world.account_id,
            category_id=foreign_category,
        )


async def test_an_entry_cannot_declare_a_space_other_than_its_transactions(
    engine: AsyncEngine,
) -> None:
    world = await _world(engine)
    other_space = await _space(engine)
    other_account = await _account(engine, other_space)

    # The account matches the space written in the entry, but the transaction is in another space.
    with pytest.raises(IntegrityError, match="fk_entries_transaction_id_space_id_transactions"):
        await _entry(engine, world.transaction_id, other_space, other_account)


async def test_an_entry_needs_an_existing_transaction_and_account(engine: AsyncEngine) -> None:
    world = await _world(engine)

    with pytest.raises(IntegrityError, match="fk_entries_transaction_id_space_id_transactions"):
        await _entry(engine, uuid.uuid4(), world.space_id, world.account_id)
    with pytest.raises(IntegrityError, match="fk_entries_account_id_space_id_accounts"):
        await _entry(engine, world.transaction_id, world.space_id, uuid.uuid4())


# entries: deletes -----------------------------------------------------------------------------


async def test_an_account_with_entries_cannot_be_deleted(engine: AsyncEngine) -> None:
    world = await _world(engine)
    await _entry(engine, world.transaction_id, world.space_id, world.account_id)

    with pytest.raises(IntegrityError, match="fk_entries_account_id_space_id_accounts"):
        await _exec(engine, "DELETE FROM accounts WHERE id = :id", id=world.account_id)


async def test_a_category_with_entries_cannot_be_deleted(engine: AsyncEngine) -> None:
    world = await _world(engine)
    category_id = await _category(engine, world.space_id)
    await _entry(
        engine, world.transaction_id, world.space_id, world.account_id, category_id=category_id
    )

    with pytest.raises(IntegrityError, match="fk_entries_category_id_space_id_categories"):
        await _exec(engine, "DELETE FROM categories WHERE id = :id", id=category_id)


async def test_deleting_a_transaction_deletes_its_entries(engine: AsyncEngine) -> None:
    world = await _world(engine)
    await _entry(engine, world.transaction_id, world.space_id, world.account_id)
    await _entry(engine, world.transaction_id, world.space_id, world.account_id, amount=-5)

    await _exec(engine, "DELETE FROM transactions WHERE id = :id", id=world.transaction_id)

    assert await _rows(engine, "SELECT count(*) FROM entries") == [(0,)]
    assert await _rows(engine, "SELECT count(*) FROM accounts") == [(1,)]


# ORM ----------------------------------------------------------------------------------------


async def test_orm_inserts_use_python_ids_and_utc_timestamps_and_updated_at_moves(
    engine: AsyncEngine,
) -> None:
    # Separate commits: now() is the transaction start, so one transaction cannot show a change.
    async with AsyncSession(engine, expire_on_commit=False) as s:
        user = User(firebase_uid="orm", email="o@example.com")
        s.add(user)
        await s.flush()
        space = Space(
            name="Mi espacio",
            type="personal",
            currency="UYU",
            timezone="America/Montevideo",
            created_by=user.id,
        )
        s.add(space)
        await s.flush()
        account = Account(space_id=space.id, name="Itaú", type="bank")
        s.add(account)
        await s.flush()
        transaction = Transaction(
            space_id=space.id,
            type="adjustment",
            status="confirmed",
            date=date(2026, 10, 20),
            description="Saldo",
            created_by=user.id,
        )
        s.add(transaction)
        await s.flush()
        entry = Entry(
            transaction_id=transaction.id,
            space_id=space.id,
            account_id=account.id,
            amount_minor=1550,
        )
        s.add(entry)
        await s.commit()
        assert transaction.id.version == 7
        assert entry.id.version == 7
        before = transaction.updated_at
        assert transaction.created_at == before
        assert before.utcoffset() == timedelta(0)
        assert abs(datetime.now(UTC) - before) < timedelta(minutes=1)
        assert transaction.deleted_at is None

    async with AsyncSession(engine, expire_on_commit=False) as s:
        transaction = await s.get_one(Transaction, transaction.id)
        transaction.description = "Saldo corregido"
        await s.commit()
        await s.refresh(transaction)

        assert transaction.updated_at > before
        assert transaction.created_at == before


# downgrade ----------------------------------------------------------------------------------


async def test_downgrade_removes_the_tables_and_the_new_unique_keys_and_upgrade_recreates_them(
    engine: AsyncEngine,
) -> None:
    config = _config()
    tables = (
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name IN ('transactions', 'entries') ORDER BY 1"
    )
    unique_keys = (
        "SELECT conname FROM pg_constraint WHERE conname IN "
        "('uq_accounts_id_space_id', 'uq_categories_id_space_id') ORDER BY 1"
    )
    world = await _world(engine)
    await _entry(engine, world.transaction_id, world.space_id, world.account_id)
    assert await _rows(engine, tables) == [("entries",), ("transactions",)]
    assert len(await _rows(engine, unique_keys)) == 2

    await asyncio.to_thread(command.downgrade, config, "0004")

    assert await _rows(engine, tables) == []
    assert await _rows(engine, unique_keys) == []
    # The previous revisions keep their data.
    assert await _rows(engine, "SELECT count(*) FROM accounts") == [(1,)]
    assert await _rows(engine, "SELECT count(*) FROM spaces") == [(1,)]

    await asyncio.to_thread(command.upgrade, config, "head")
    assert await _rows(engine, tables) == [("entries",), ("transactions",)]
    assert len(await _rows(engine, unique_keys)) == 2
