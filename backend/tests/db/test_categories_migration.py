import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.modules.categories.models import Category
from app.modules.spaces.models import Space
from app.modules.users.models import User

BACKEND_DIR = Path(__file__).resolve().parents[2]
FK_PARENT = "fk_categories_parent_id_space_id_kind_has_parent_categories"


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


@pytest.fixture
async def engine_before_categories(scratch_database_url: str) -> AsyncIterator[AsyncEngine]:
    """A database at revision 0003 (spaces exist, `categories` does not)."""
    await asyncio.to_thread(command.upgrade, _config(), "0003")
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


async def _category(
    engine: AsyncEngine,
    space_id: uuid.UUID,
    *,
    name: str = "Comida",
    kind: str = "expense",
    icon: str = "fork-knife",
    parent_id: uuid.UUID | None = None,
) -> uuid.UUID:
    category_id = uuid.uuid4()
    await _exec(
        engine,
        "INSERT INTO categories (id, space_id, parent_id, name, kind, icon) "
        "VALUES (:id, :space_id, :parent_id, :name, :kind, :icon)",
        id=category_id,
        space_id=space_id,
        parent_id=parent_id,
        name=name,
        kind=kind,
        icon=icon,
    )
    return category_id


async def _count(engine: AsyncEngine, table: str = "categories") -> int:
    [(count,)] = await _rows(engine, f"SELECT count(*) FROM {table}")  # noqa: S608
    assert isinstance(count, int)
    return count


# Shape --------------------------------------------------------------------------------------


async def test_migration_creates_the_categories_table_with_the_expected_columns(
    engine: AsyncEngine,
) -> None:
    rows = await _rows(
        engine,
        "SELECT column_name, data_type, is_nullable, is_generated FROM information_schema.columns "
        "WHERE table_name = 'categories'",
    )
    columns = {c: (d, n, g) for c, d, n, g in rows}

    assert columns == {
        "id": ("uuid", "NO", "NEVER"),
        "space_id": ("uuid", "NO", "NEVER"),
        "parent_id": ("uuid", "YES", "NEVER"),
        "name": ("text", "NO", "NEVER"),
        "kind": ("text", "NO", "NEVER"),
        "icon": ("text", "NO", "NEVER"),
        "is_main": ("boolean", "NO", "ALWAYS"),
        "has_parent": ("boolean", "NO", "ALWAYS"),
        "archived_at": ("timestamp with time zone", "YES", "NEVER"),
        "created_at": ("timestamp with time zone", "NO", "NEVER"),
        "updated_at": ("timestamp with time zone", "NO", "NEVER"),
    }


async def test_the_expected_indexes_and_constraints_exist(engine: AsyncEngine) -> None:
    indexes = {r[0] for r in await _rows(engine, "SELECT indexname FROM pg_indexes")}
    constraints = {
        r[0]
        for r in await _rows(
            engine, "SELECT conname FROM pg_constraint WHERE conrelid = 'categories'::regclass"
        )
    }

    assert {
        "ix_categories_space_id",
        "uq_categories_main_name",
        "uq_categories_sub_name",
    } <= indexes
    assert {
        "pk_categories",
        "uq_categories_id_space_id_kind_is_main",
        "fk_categories_space_id_spaces",
        FK_PARENT,
        "ck_categories_kind",
        "ck_categories_name_not_blank",
        "ck_categories_name_length",
        "ck_categories_icon_format",
    } <= constraints


async def test_the_generated_columns_follow_the_parent(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    main = await _category(engine, space_id)
    await _category(engine, space_id, name="Supermercado", parent_id=main)

    rows = await _rows(
        engine, "SELECT name, is_main, has_parent FROM categories ORDER BY is_main DESC"
    )

    assert rows == [("Comida", True, False), ("Supermercado", False, True)]


async def test_the_generated_columns_cannot_be_written(engine: AsyncEngine) -> None:
    space_id = await _space(engine)

    with pytest.raises(DBAPIError, match="is_main"):
        await _exec(
            engine,
            "INSERT INTO categories (id, space_id, name, kind, icon, is_main) "
            "VALUES (:id, :space_id, 'x', 'expense', 'tag', false)",
            id=uuid.uuid4(),
            space_id=space_id,
        )


# Checks -------------------------------------------------------------------------------------


async def test_valid_main_and_sub_categories_of_both_kinds_are_accepted(
    engine: AsyncEngine,
) -> None:
    space_id = await _space(engine)

    food = await _category(engine, space_id, name="Comida", kind="expense")
    await _category(engine, space_id, name="Supermercado", kind="expense", parent_id=food)
    pay = await _category(engine, space_id, name="Trabajo", kind="income", icon="briefcase")
    await _category(engine, space_id, name="Sueldo", kind="income", icon="money", parent_id=pay)

    assert await _count(engine) == 4


@pytest.mark.parametrize("kind", ["transfer", "adjustment", "Expense", ""])
async def test_an_unknown_kind_is_rejected(engine: AsyncEngine, kind: str) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match="ck_categories_kind"):
        await _category(engine, space_id, kind=kind)


@pytest.mark.parametrize("name", ["", "   ", " "])
async def test_an_empty_or_blank_name_is_rejected(engine: AsyncEngine, name: str) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match="ck_categories_name_not_blank"):
        await _category(engine, space_id, name=name)


async def test_a_name_longer_than_80_characters_is_rejected(engine: AsyncEngine) -> None:
    space_id = await _space(engine)

    await _category(engine, space_id, name="a" * 80)
    with pytest.raises(IntegrityError, match="ck_categories_name_length"):
        await _category(engine, space_id, name="a" * 81)


@pytest.mark.parametrize(
    "icon", ["", "Fork_Knife", "ForkKnife", "fork knife", "-fork", "fork-", "fork--knife", "a" * 41]
)
async def test_an_icon_that_is_not_a_kebab_case_key_is_rejected(
    engine: AsyncEngine, icon: str
) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match="ck_categories_icon_format"):
        await _category(engine, space_id, icon=icon)


@pytest.mark.parametrize("icon", ["tag", "fork-knife", "t-shirt", "a" * 40])
async def test_kebab_case_icon_keys_are_accepted(engine: AsyncEngine, icon: str) -> None:
    space_id = await _space(engine)

    await _category(engine, space_id, icon=icon)


# Foreign keys -------------------------------------------------------------------------------


async def test_the_space_must_exist(engine: AsyncEngine) -> None:
    with pytest.raises(IntegrityError, match="fk_categories_space_id_spaces"):
        await _category(engine, uuid.uuid4())


async def test_a_space_with_categories_cannot_be_deleted(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    await _category(engine, space_id)

    with pytest.raises(IntegrityError, match="fk_categories_space_id_spaces"):
        await _exec(engine, "DELETE FROM spaces WHERE id = :id", id=space_id)

    assert await _count(engine) == 1


async def test_a_subcategory_needs_an_existing_parent(engine: AsyncEngine) -> None:
    space_id = await _space(engine)

    with pytest.raises(IntegrityError, match=FK_PARENT):
        await _category(engine, space_id, parent_id=uuid.uuid4())


async def test_a_subcategory_cannot_have_a_different_kind_than_its_main(
    engine: AsyncEngine,
) -> None:
    space_id = await _space(engine)
    main = await _category(engine, space_id, kind="expense")

    with pytest.raises(IntegrityError, match=FK_PARENT):
        await _category(engine, space_id, name="Sueldo", kind="income", parent_id=main)


async def test_a_subcategory_cannot_belong_to_another_space_than_its_main(
    engine: AsyncEngine,
) -> None:
    space_a = await _space(engine, "uid-a")
    space_b = await _space(engine, "uid-b")
    main_of_a = await _category(engine, space_a)

    with pytest.raises(IntegrityError, match=FK_PARENT):
        await _category(engine, space_b, name="Intrusa", parent_id=main_of_a)


async def test_a_third_level_is_rejected(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    main = await _category(engine, space_id)
    sub = await _category(engine, space_id, name="Supermercado", parent_id=main)

    with pytest.raises(IntegrityError, match=FK_PARENT):
        await _category(engine, space_id, name="Marca", parent_id=sub)

    assert await _count(engine) == 2


async def test_a_category_cannot_be_its_own_parent(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    category = await _category(engine, space_id)

    with pytest.raises(IntegrityError, match=FK_PARENT):
        await _exec(engine, "UPDATE categories SET parent_id = id WHERE id = :id", id=category)


async def test_a_main_with_subcategories_cannot_be_deleted(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    main = await _category(engine, space_id)
    await _category(engine, space_id, name="Supermercado", parent_id=main)

    with pytest.raises(IntegrityError, match=FK_PARENT):
        await _exec(engine, "DELETE FROM categories WHERE id = :id", id=main)

    assert await _count(engine) == 2


async def test_the_kind_of_a_main_with_subcategories_cannot_change(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    main = await _category(engine, space_id)
    await _category(engine, space_id, name="Supermercado", parent_id=main)

    with pytest.raises(IntegrityError, match=FK_PARENT):
        await _exec(engine, "UPDATE categories SET kind = 'income' WHERE id = :id", id=main)


async def test_a_main_with_subcategories_cannot_become_a_subcategory(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    food = await _category(engine, space_id, name="Comida")
    await _category(engine, space_id, name="Supermercado", parent_id=food)
    home = await _category(engine, space_id, name="Hogar")

    with pytest.raises(IntegrityError, match=FK_PARENT):
        await _exec(
            engine,
            "UPDATE categories SET parent_id = :parent WHERE id = :id",
            parent=home,
            id=food,
        )


async def test_a_main_without_subcategories_can_be_deleted(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    main = await _category(engine, space_id)

    await _exec(engine, "DELETE FROM categories WHERE id = :id", id=main)

    assert await _count(engine) == 0


# Unique names -------------------------------------------------------------------------------


async def test_two_mains_of_the_same_kind_cannot_share_a_name_ignoring_case(
    engine: AsyncEngine,
) -> None:
    space_id = await _space(engine)
    await _category(engine, space_id, name="Comida")

    with pytest.raises(IntegrityError, match="uq_categories_main_name"):
        await _category(engine, space_id, name="COMIDA")


async def test_a_main_name_is_unique_even_when_the_other_one_is_archived(
    engine: AsyncEngine,
) -> None:
    space_id = await _space(engine)
    old = await _category(engine, space_id, name="Ocio")
    await _exec(engine, "UPDATE categories SET archived_at = now() WHERE id = :id", id=old)

    with pytest.raises(IntegrityError, match="uq_categories_main_name"):
        await _category(engine, space_id, name="Ocio")


async def test_the_same_main_name_is_allowed_in_the_other_kind_and_in_another_space(
    engine: AsyncEngine,
) -> None:
    space_a = await _space(engine, "uid-a")
    space_b = await _space(engine, "uid-b")
    await _category(engine, space_a, name="Regalos", kind="expense")

    await _category(engine, space_a, name="Regalos", kind="income")
    await _category(engine, space_b, name="Regalos", kind="expense")

    assert await _count(engine) == 3


async def test_two_subcategories_of_one_main_cannot_share_a_name_ignoring_case(
    engine: AsyncEngine,
) -> None:
    space_id = await _space(engine)
    main = await _category(engine, space_id)
    await _category(engine, space_id, name="Supermercado", parent_id=main)

    with pytest.raises(IntegrityError, match="uq_categories_sub_name"):
        await _category(engine, space_id, name="supermercado", parent_id=main)


async def test_the_same_subcategory_name_is_allowed_under_another_main(
    engine: AsyncEngine,
) -> None:
    space_id = await _space(engine)
    food = await _category(engine, space_id, name="Comida")
    home = await _category(engine, space_id, name="Hogar")

    await _category(engine, space_id, name="Otros", parent_id=food)
    await _category(engine, space_id, name="Otros", parent_id=home)

    assert await _count(engine) == 4


async def test_a_subcategory_may_share_the_name_of_a_main(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    main = await _category(engine, space_id, name="Salud")

    await _category(engine, space_id, name="Salud", parent_id=main)

    assert await _count(engine) == 2


# Timestamps and ORM -------------------------------------------------------------------------


async def test_inserts_get_utc_timestamps_close_to_now(engine: AsyncEngine) -> None:
    space_id = await _space(engine)
    await _category(engine, space_id)

    [(created_at, updated_at, archived_at)] = await _rows(
        engine, "SELECT created_at, updated_at, archived_at FROM categories"
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
        main = Category(space_id=space.id, name="Comida", kind="expense", icon="fork-knife")
        s.add(main)
        await s.flush()
        sub = Category(
            space_id=space.id,
            parent_id=main.id,
            name="Supermercado",
            kind="expense",
            icon="shopping-cart",
        )
        s.add(sub)
        await s.commit()
        assert main.id.version == 7
        assert (main.is_main, main.has_parent) == (True, False)
        assert (sub.is_main, sub.has_parent) == (False, True)
        before = main.updated_at
        assert main.created_at == before

    async with AsyncSession(engine, expire_on_commit=False) as s:
        category = await s.get_one(Category, main.id)
        category.name = "Alimentos"
        await s.commit()
        await s.refresh(category)

        assert category.updated_at > before
        assert category.created_at == before


# Data migration -----------------------------------------------------------------------------


async def test_a_fresh_database_has_no_categories(engine: AsyncEngine) -> None:
    assert await _count(engine) == 0


async def test_existing_spaces_get_the_34_default_categories(
    engine_before_categories: AsyncEngine,
) -> None:
    engine = engine_before_categories
    space_a = await _space(engine, "uid-a")
    space_b = await _space(engine, "uid-b")

    await asyncio.to_thread(command.upgrade, _config(), "head")

    for space_id in (space_a, space_b):
        [(total, mains, subs, archived)] = await _rows(
            engine,
            "SELECT count(*), count(*) FILTER (WHERE parent_id IS NULL), "
            "count(*) FILTER (WHERE parent_id IS NOT NULL), "
            "count(*) FILTER (WHERE archived_at IS NOT NULL) "
            "FROM categories WHERE space_id = :space_id",
            space_id=space_id,
        )
        assert (total, mains, subs, archived) == (34, 15, 19, 0)
    assert await _count(engine) == 68


async def test_seeded_subcategories_have_the_space_and_kind_of_their_main(
    engine_before_categories: AsyncEngine,
) -> None:
    engine = engine_before_categories
    await _space(engine)

    await asyncio.to_thread(command.upgrade, _config(), "head")

    mismatched = await _rows(
        engine,
        "SELECT count(*) FROM categories sub JOIN categories main ON main.id = sub.parent_id "
        "WHERE main.parent_id IS NOT NULL OR main.space_id <> sub.space_id "
        "OR main.kind <> sub.kind",
    )
    assert mismatched == [(0,)]


async def test_seeded_ids_are_uuid_v7_and_follow_the_order_of_the_list(
    engine_before_categories: AsyncEngine,
) -> None:
    engine = engine_before_categories
    space_id = await _space(engine)

    await asyncio.to_thread(command.upgrade, _config(), "head")

    versions = await _rows(engine, "SELECT DISTINCT substr(id::text, 15, 1) FROM categories")
    assert versions == [("7",)]
    mains = await _rows(
        engine,
        "SELECT name, kind, icon FROM categories "
        "WHERE space_id = :space_id AND parent_id IS NULL ORDER BY created_at, id",
        space_id=space_id,
    )
    assert mains[:5] == [
        ("Comida", "expense", "fork-knife"),
        ("Transporte", "expense", "car"),
        ("Hogar", "expense", "house"),
        ("Salud", "expense", "heartbeat"),
        ("Ocio", "expense", "game-controller"),
    ]
    assert [m[1] for m in mains] == ["expense"] * 10 + ["income"] * 5


async def test_the_seeded_subcategories_are_the_ones_of_the_approved_table(
    engine_before_categories: AsyncEngine,
) -> None:
    engine = engine_before_categories
    await _space(engine)

    await asyncio.to_thread(command.upgrade, _config(), "head")

    rows = await _rows(
        engine,
        "SELECT main.name, sub.name, sub.icon FROM categories sub "
        "JOIN categories main ON main.id = sub.parent_id ORDER BY sub.created_at, sub.id",
    )
    assert rows[:3] == [
        ("Comida", "Supermercado", "shopping-cart"),
        ("Comida", "Restaurantes", "bowl-food"),
        ("Comida", "Cafés", "coffee"),
    ]
    assert rows[-2:] == [
        ("Inversiones", "Intereses", "percent"),
        ("Inversiones", "Dividendos", "coins"),
    ]


async def test_the_migration_does_not_touch_a_database_without_spaces(
    engine_before_categories: AsyncEngine,
) -> None:
    await asyncio.to_thread(command.upgrade, _config(), "head")

    assert await _count(engine_before_categories) == 0


# Downgrade ----------------------------------------------------------------------------------


async def test_downgrade_removes_the_table_and_upgrade_recreates_and_reseeds_it(
    engine: AsyncEngine,
) -> None:
    config = _config()
    sql = "SELECT table_name FROM information_schema.tables WHERE table_name = 'categories'"
    assert await _rows(engine, sql) == [("categories",)]
    await _space(engine)  # data of a previous revision, which the downgrade must not touch

    await asyncio.to_thread(command.downgrade, config, "0003")
    assert await _rows(engine, sql) == []
    # The tables of the previous revisions keep their data.
    assert await _count(engine, "spaces") == 1
    assert await _count(engine, "users") == 1
    assert await _count(engine, "accounts") == 0

    await asyncio.to_thread(command.upgrade, config, "head")
    assert await _rows(engine, sql) == [("categories",)]
    assert await _count(engine) == 34  # the space that existed meanwhile got its defaults
