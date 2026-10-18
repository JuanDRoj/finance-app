import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.modules.accounts.models import Account
from app.modules.spaces.models import Space
from app.modules.users.models import User

BACKEND_DIR = Path(__file__).resolve().parents[2]


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


async def _space(engine: AsyncEngine, firebase_uid: str = "uid-1") -> uuid.UUID:
    user_id, space_id = uuid.uuid4(), uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO users (id, firebase_uid, email) VALUES (:id, :uid, 'a@example.com')",
        id=user_id,
        uid=firebase_uid,
    )
    await _exec(
        engine,
        "INSERT INTO spaces (id, name, type, currency, timezone, created_by) "
        "VALUES (:id, 'Mi espacio', 'personal', 'UYU', 'America/Montevideo', :created_by)",
        id=space_id,
        created_by=user_id,
    )
    return space_id


async def _account(
    engine: AsyncEngine,
    space_id: uuid.UUID,
    *,
    name: str = "Itaú",
    type_: str = "bank",
    closing_day: int | None = None,
    due_day: int | None = None,
) -> None:
    await _exec(
        engine,
        "INSERT INTO accounts (id, space_id, name, type, closing_day, due_day) "
        "VALUES (:id, :space_id, :name, :type, :closing_day, :due_day)",
        id=uuid.uuid4(),
        space_id=space_id,
        name=name,
        type=type_,
        closing_day=closing_day,
        due_day=due_day,
    )


async def test_migration_creates_the_accounts_table_with_the_expected_columns(
    engine: AsyncEngine,
) -> None:
    rows = await _rows(
        engine,
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
        "WHERE table_name = 'accounts'",
    )
    columns = {c: (d, n) for c, d, n in rows}

    assert columns == {
        "id": ("uuid", "NO"),
        "space_id": ("uuid", "NO"),
        "name": ("text", "NO"),
        "type": ("text", "NO"),
        "closing_day": ("smallint", "YES"),
        "due_day": ("smallint", "YES"),
        "archived_at": ("timestamp with time zone", "YES"),
        "created_at": ("timestamp with time zone", "NO"),
        "updated_at": ("timestamp with time zone", "NO"),
    }


async def test_the_space_id_index_exists(engine: AsyncEngine) -> None:
    rows = await _rows(engine, "SELECT indexname FROM pg_indexes WHERE tablename = 'accounts'")

    assert ("ix_accounts_space_id",) in rows


async def test_valid_accounts_of_each_type_are_accepted(engine: AsyncEngine) -> None:
    space_id = await _space(engine)

    await _account(engine, space_id, type_="bank")
    await _account(engine, space_id, type_="cash")
    await _account(engine, space_id, type_="credit_card", closing_day=5, due_day=12)

    assert await _rows(engine, "SELECT count(*) FROM accounts") == [(3,)]


async def test_an_unknown_type_is_rejected(engine: AsyncEngine) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match="ck_accounts_type"):
        await _account(engine, space_id, type_="savings")


@pytest.mark.parametrize("name", ["", "   ", " "])
async def test_an_empty_or_blank_name_is_rejected(engine: AsyncEngine, name: str) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match="ck_accounts_name_not_blank"):
        await _account(engine, space_id, name=name)


async def test_a_name_longer_than_80_characters_is_rejected(engine: AsyncEngine) -> None:
    space_id = await _space(engine)

    await _account(engine, space_id, name="a" * 80)
    with pytest.raises(IntegrityError, match="ck_accounts_name_length"):
        await _account(engine, space_id, name="a" * 81)


@pytest.mark.parametrize("day", [0, 32, -1])
async def test_a_closing_day_outside_1_to_31_is_rejected(engine: AsyncEngine, day: int) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match="ck_accounts_closing_day_range"):
        await _account(engine, space_id, type_="credit_card", closing_day=day, due_day=10)


@pytest.mark.parametrize("day", [0, 32, -1])
async def test_a_due_day_outside_1_to_31_is_rejected(engine: AsyncEngine, day: int) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match="ck_accounts_due_day_range"):
        await _account(engine, space_id, type_="credit_card", closing_day=10, due_day=day)


@pytest.mark.parametrize("day", [1, 31])
async def test_the_limits_1_and_31_are_accepted(engine: AsyncEngine, day: int) -> None:
    space_id = await _space(engine)

    await _account(engine, space_id, type_="credit_card", closing_day=day, due_day=day)


@pytest.mark.parametrize(
    ("closing_day", "due_day"),
    [(None, None), (5, None), (None, 12)],
    ids=["none", "closing", "due"],
)
async def test_a_credit_card_needs_both_days(
    engine: AsyncEngine, closing_day: int | None, due_day: int | None
) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match="ck_accounts_card_days"):
        await _account(
            engine, space_id, type_="credit_card", closing_day=closing_day, due_day=due_day
        )


@pytest.mark.parametrize("type_", ["bank", "cash"])
@pytest.mark.parametrize(
    ("closing_day", "due_day"), [(5, None), (None, 12), (5, 12)], ids=["closing", "due", "both"]
)
async def test_bank_and_cash_cannot_have_days(
    engine: AsyncEngine, type_: str, closing_day: int | None, due_day: int | None
) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match="ck_accounts_card_days"):
        await _account(engine, space_id, type_=type_, closing_day=closing_day, due_day=due_day)


async def test_the_space_must_exist(engine: AsyncEngine) -> None:
    with pytest.raises(IntegrityError, match="fk_accounts_space_id_spaces"):
        await _account(engine, uuid.uuid4())


async def test_a_space_with_accounts_cannot_be_deleted(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    await _account(engine, space_id)

    with pytest.raises(IntegrityError, match="fk_accounts_space_id_spaces"):
        await _exec(engine, "DELETE FROM spaces WHERE id = :id", id=space_id)

    assert await _rows(engine, "SELECT count(*) FROM accounts") == [(1,)]


async def test_inserts_get_utc_timestamps_close_to_now(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    await _account(engine, space_id)

    [(created_at, updated_at, archived_at)] = await _rows(
        engine, "SELECT created_at, updated_at, archived_at FROM accounts"
    )

    now = datetime.now(UTC)
    for value in (created_at, updated_at):
        assert isinstance(value, datetime)
        assert value.utcoffset() == timedelta(0)
        assert abs(now - value) < timedelta(minutes=1)
    assert archived_at is None


async def test_orm_inserts_use_python_ids_and_orm_update_moves_updated_at(
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
        account = Account(
            space_id=space.id, name="Visa", type="credit_card", closing_day=5, due_day=12
        )
        s.add(account)
        await s.commit()
        assert account.id.version == 7
        before = account.updated_at
        assert account.created_at == before

    async with AsyncSession(engine, expire_on_commit=False) as s:
        account = await s.get_one(Account, account.id)
        account.name = "Visa Itaú"
        await s.commit()
        await s.refresh(account)

        assert account.updated_at > before
        assert account.created_at == before


async def test_downgrade_removes_the_table_and_upgrade_recreates_it(engine: AsyncEngine) -> None:
    config = _config()
    sql = "SELECT table_name FROM information_schema.tables WHERE table_name = 'accounts'"
    assert await _rows(engine, sql) == [("accounts",)]
    await _space(engine)  # data of a previous revision, which the downgrade must not touch

    await asyncio.to_thread(command.downgrade, config, "0002")
    assert await _rows(engine, sql) == []
    # The tables of the previous revisions keep their data.
    assert await _rows(engine, "SELECT count(*) FROM spaces") == [(1,)]
    assert await _rows(engine, "SELECT count(*) FROM users") == [(1,)]

    await asyncio.to_thread(command.upgrade, config, "head")
    assert await _rows(engine, sql) == [("accounts",)]
