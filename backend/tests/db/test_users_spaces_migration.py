import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.modules.spaces.models import Space, SpaceMember
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


async def _user(engine: AsyncEngine, firebase_uid: str = "uid-1") -> uuid.UUID:
    user_id = uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO users (id, firebase_uid, email) VALUES (:id, :uid, 'a@example.com')",
        id=user_id,
        uid=firebase_uid,
    )
    return user_id


async def _space(
    engine: AsyncEngine,
    created_by: uuid.UUID,
    type_: str = "personal",
    currency: str = "UYU",
) -> uuid.UUID:
    space_id = uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO spaces (id, name, type, currency, timezone, created_by) "
        "VALUES (:id, 'Mi espacio', :type, :currency, 'America/Montevideo', :created_by)",
        id=space_id,
        type=type_,
        currency=currency,
        created_by=created_by,
    )
    return space_id


async def test_migration_creates_the_three_tables(engine: AsyncEngine) -> None:
    rows = await _rows(
        engine,
        "SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns "
        "WHERE table_name IN ('users', 'spaces', 'space_members')",
    )
    columns = {(t, c): (d, n) for t, c, d, n in rows}

    assert columns[("users", "id")] == ("uuid", "NO")
    assert columns[("users", "firebase_uid")] == ("text", "NO")
    assert columns[("users", "email")] == ("text", "NO")
    assert columns[("users", "display_name")] == ("text", "YES")
    assert columns[("users", "created_at")] == ("timestamp with time zone", "NO")
    assert columns[("users", "updated_at")] == ("timestamp with time zone", "NO")
    assert columns[("spaces", "currency")] == ("character", "NO")
    assert columns[("spaces", "created_by")] == ("uuid", "NO")
    assert columns[("spaces", "created_at")] == ("timestamp with time zone", "NO")
    assert columns[("space_members", "role")] == ("text", "NO")
    assert ("space_members", "updated_at") not in columns


async def test_inserts_get_utc_timestamps_close_to_now(engine: AsyncEngine) -> None:
    user_id = await _user(engine)
    await _space(engine, user_id)

    rows = await _rows(
        engine,
        "SELECT u.created_at, u.updated_at, s.created_at, s.updated_at FROM users u, spaces s",
    )

    now = datetime.now(UTC)
    assert len(rows) == 1
    for value in rows[0]:
        assert isinstance(value, datetime)
        assert value.utcoffset() == timedelta(0)
        assert abs(now - value) < timedelta(minutes=1)


async def test_orm_update_moves_updated_at_forward_on_users_and_spaces(
    engine: AsyncEngine,
) -> None:
    # Separate commits: now() is the transaction start, so one transaction cannot show a change.
    async with AsyncSession(engine, expire_on_commit=False) as s:
        user = User(firebase_uid="upd", email="u@example.com")
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
        await s.commit()
        user_before, space_before = user.updated_at, space.updated_at

    async with AsyncSession(engine, expire_on_commit=False) as s:
        user = await s.get_one(User, user.id)
        space = await s.get_one(Space, space.id)
        user.display_name = "New name"
        space.name = "Renamed"
        await s.commit()
        await s.refresh(user)
        await s.refresh(space)

        assert user.updated_at > user_before
        assert space.updated_at > space_before
        assert user.created_at == user_before
        assert space.created_at == space_before


async def test_duplicate_firebase_uid_is_rejected(engine: AsyncEngine) -> None:
    await _user(engine, "same")

    with pytest.raises(IntegrityError, match="uq_users_firebase_uid"):
        await _user(engine, "same")


async def test_invalid_space_type_is_rejected(engine: AsyncEngine) -> None:
    user_id = await _user(engine)

    with pytest.raises(IntegrityError, match="ck_spaces_type"):
        await _space(engine, user_id, type_="team")


async def test_invalid_member_role_is_rejected(engine: AsyncEngine) -> None:
    user_id = await _user(engine)
    space_id = await _space(engine, user_id)

    with pytest.raises(IntegrityError, match="ck_space_members_role"):
        await _exec(
            engine,
            "INSERT INTO space_members (user_id, space_id, role) VALUES (:u, :s, 'admin')",
            u=user_id,
            s=space_id,
        )


async def test_unsupported_currency_is_rejected_and_supported_accepted(
    engine: AsyncEngine,
) -> None:
    user_id = await _user(engine)

    with pytest.raises(IntegrityError, match="fk_spaces_currency_currencies"):
        await _space(engine, user_id, currency="XXX")
    await _space(engine, user_id, currency="CLP")


async def test_a_creator_cannot_have_two_personal_spaces(engine: AsyncEngine) -> None:
    user_id = await _user(engine)
    await _space(engine, user_id)

    with pytest.raises(IntegrityError, match="uq_spaces_created_by_personal"):
        await _space(engine, user_id)


async def test_households_are_unlimited_and_other_users_have_their_own_personal(
    engine: AsyncEngine,
) -> None:
    first = await _user(engine, "uid-1")
    second = await _user(engine, "uid-2")
    await _space(engine, first)
    await _space(engine, first, type_="household")
    await _space(engine, first, type_="household")
    await _space(engine, second)

    assert await _rows(engine, "SELECT count(*) FROM spaces") == [(4,)]


async def test_space_member_pair_is_unique_and_references_must_exist(
    engine: AsyncEngine,
) -> None:
    user_id = await _user(engine)
    space_id = await _space(engine, user_id)
    insert = "INSERT INTO space_members (user_id, space_id, role) VALUES (:u, :s, 'owner')"
    await _exec(engine, insert, u=user_id, s=space_id)

    with pytest.raises(IntegrityError, match="pk_space_members"):
        await _exec(engine, insert, u=user_id, s=space_id)
    with pytest.raises(IntegrityError, match="fk_space_members_user_id_users"):
        await _exec(engine, insert, u=uuid.uuid4(), s=space_id)
    with pytest.raises(IntegrityError, match="fk_space_members_space_id_spaces"):
        await _exec(engine, insert, u=user_id, s=uuid.uuid4())
    with pytest.raises(IntegrityError, match="fk_spaces_created_by_users"):
        await _space(engine, uuid.uuid4(), type_="household")


async def test_deleting_a_space_removes_its_members_but_a_user_with_spaces_cannot_be_deleted(
    engine: AsyncEngine,
) -> None:
    user_id = await _user(engine)
    space_id = await _space(engine, user_id)
    await _exec(
        engine,
        "INSERT INTO space_members (user_id, space_id, role) VALUES (:u, :s, 'owner')",
        u=user_id,
        s=space_id,
    )

    with pytest.raises(IntegrityError, match="fk_spaces_created_by_users"):
        await _exec(engine, "DELETE FROM users WHERE id = :id", id=user_id)

    await _exec(engine, "DELETE FROM spaces WHERE id = :id", id=space_id)
    assert await _rows(engine, "SELECT 1 FROM space_members") == []


async def test_orm_inserts_use_python_ids_and_database_defaults(
    engine: AsyncEngine,
) -> None:
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
        s.add(SpaceMember(user_id=user.id, space_id=space.id, role="owner"))
        await s.commit()

        assert user.id.version == 7
        assert space.id.version == 7
        member = (await s.execute(select(SpaceMember))).scalar_one()
        assert member.created_at is not None
        assert user.display_name is None


async def test_downgrade_removes_the_tables_and_upgrade_recreates_them(
    engine: AsyncEngine,
) -> None:
    config = _config()
    currencies_before = await _rows(engine, "SELECT count(*) FROM currencies")
    assert currencies_before != [(0,)]
    await asyncio.to_thread(command.downgrade, config, "0001")
    sql = (
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name IN ('users', 'spaces', 'space_members')"
    )
    assert await _rows(engine, sql) == []
    assert await _rows(engine, "SELECT count(*) FROM currencies") == currencies_before

    await asyncio.to_thread(command.downgrade, config, "base")
    await asyncio.to_thread(command.upgrade, config, "head")
    assert len(await _rows(engine, sql)) == 3
