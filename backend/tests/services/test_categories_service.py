import uuid
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InvalidFieldError, NotFoundError
from app.modules.categories import service
from app.modules.categories.defaults import DEFAULT_CATEGORIES
from app.modules.categories.models import Category
from app.modules.categories.schemas import CategoryCreate, CategoryRead, CategoryUpdate
from app.modules.spaces import service as spaces_service
from app.modules.users import service as users_service

TOTAL_DEFAULTS = 34


async def _make_space(session: AsyncSession, uid: str) -> uuid.UUID:
    user = await users_service.upsert_user(
        session, firebase_uid=uid, email=f"{uid}@example.com", display_name=None
    )
    await spaces_service.ensure_personal_space(session, user.id, "America/Montevideo")
    [space] = await spaces_service.list_spaces(session, user.id)
    return space.id


def _create(**fields: Any) -> CategoryCreate:
    return CategoryCreate.model_validate(
        {"name": "Comida", "kind": "expense", "icon": "fork-knife", **fields}
    )


def _update(**fields: Any) -> CategoryUpdate:
    return CategoryUpdate.model_validate(fields)


async def _main(
    session: AsyncSession, space_id: uuid.UUID, name: str = "Comida", kind: str = "expense"
) -> Category:
    return await service.create_category(session, space_id, _create(name=name, kind=kind))


async def _sub(
    session: AsyncSession, space_id: uuid.UUID, parent: Category, name: str = "Supermercado"
) -> Category:
    data = _create(name=name, kind=parent.kind, parent_id=str(parent.id))
    return await service.create_category(session, space_id, data)


async def _count(session: AsyncSession, space_id: uuid.UUID) -> int:
    stmt = select(func.count()).select_from(Category).where(Category.space_id == space_id)
    return (await session.scalar(stmt)) or 0


async def _names(session: AsyncSession, space_id: uuid.UUID, **kwargs: bool) -> list[str]:
    return [c.name for c in await service.list_categories(session, space_id, **kwargs)]


# seed ---------------------------------------------------------------------------------------


async def test_seed_creates_the_34_default_categories(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    seeded = await service.seed_default_categories(session, space_id)

    assert seeded is True
    rows = list(await session.scalars(select(Category).where(Category.space_id == space_id)))
    assert len(rows) == TOTAL_DEFAULTS
    assert sum(c.parent_id is None for c in rows) == 15
    assert all(c.archived_at is None for c in rows)
    assert all(c.id.version == 7 for c in rows)


async def test_seed_stores_every_default_with_its_kind_and_icon(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    await service.seed_default_categories(session, space_id)

    rows = list(await session.scalars(select(Category).where(Category.space_id == space_id)))
    stored = {(c.name, c.kind, c.icon, c.parent_id) for c in rows}
    by_name = {(c.kind, c.name): c.id for c in rows if c.parent_id is None}
    expected: set[tuple[str, str, str, uuid.UUID | None]] = set()
    for main in DEFAULT_CATEGORIES:
        expected.add((main.name, main.kind, main.icon, None))
        for sub in main.children:
            expected.add((sub.name, main.kind, sub.icon, by_name[(main.kind, main.name)]))
    assert stored == expected


async def test_seeded_subcategories_hang_from_a_main_of_the_same_space_and_kind(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    await service.seed_default_categories(session, space_id)

    rows = list(await session.scalars(select(Category).where(Category.space_id == space_id)))

    mains = {c.id: c for c in rows if c.parent_id is None}
    subs = [c for c in rows if c.parent_id is not None]
    assert len(subs) == 19
    for sub in subs:
        assert sub.parent_id in mains
        assert mains[sub.parent_id].kind == sub.kind


async def test_seed_lists_the_main_categories_in_the_order_of_the_table(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    await service.seed_default_categories(session, space_id)

    listed = await service.list_categories(session, space_id)

    mains = [c.name for c in listed if c.parent_id is None]
    assert mains == [main.name for main in DEFAULT_CATEGORIES]
    assert mains[:5] == ["Comida", "Transporte", "Hogar", "Salud", "Ocio"]


async def test_list_category_reads_returns_schemas_in_the_same_order_as_list_categories(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    sub = await _sub(session, space_id, main)
    archived = await _main(session, space_id, name="Vieja")
    await service.archive_category(session, space_id, archived.id)

    reads = await service.list_category_reads(session, space_id, include_archived=True)
    orm = await service.list_categories(session, space_id, include_archived=True)

    assert all(type(read) is CategoryRead for read in reads)
    assert [read.id for read in reads] == [category.id for category in orm]
    assert {read.id for read in reads} == {main.id, sub.id, archived.id}
    by_id = {read.id: read for read in reads}
    assert by_id[sub.id].parent_id == main.id
    assert by_id[archived.id].archived_at is not None
    visible = await service.list_category_reads(session, space_id)
    assert archived.id not in {read.id for read in visible}


async def test_list_category_reads_stays_in_the_space(session: AsyncSession) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    mine = await _main(session, space_a, name="Mia")
    await _main(session, space_b, name="Ajena")

    assert [read.id for read in await service.list_category_reads(session, space_a)] == [mine.id]


async def test_seed_twice_does_not_duplicate_anything(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    first = await service.seed_default_categories(session, space_id)
    second = await service.seed_default_categories(session, space_id)

    assert (first, second) == (True, False)
    assert await _count(session, space_id) == TOTAL_DEFAULTS


async def test_seed_leaves_a_space_that_already_has_categories_alone(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    await _main(session, space_id, "Mi categoría")

    seeded = await service.seed_default_categories(session, space_id)

    assert seeded is False
    assert await _names(session, space_id) == ["Mi categoría"]


async def test_seed_does_not_bring_back_a_default_the_user_renamed_or_archived(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    await service.seed_default_categories(session, space_id)
    [comida] = [c for c in await service.list_categories(session, space_id) if c.name == "Comida"]
    await service.update_category(session, space_id, comida.id, _update(name="Alimentación"))
    [ocio] = [c for c in await service.list_categories(session, space_id) if c.name == "Ocio"]
    await service.archive_category(session, space_id, ocio.id)

    await service.seed_default_categories(session, space_id)

    assert await _count(session, space_id) == TOTAL_DEFAULTS
    names = await _names(session, space_id, include_archived=True)
    assert "Comida" not in names
    assert names.count("Ocio") == 1


async def test_two_spaces_get_their_own_separate_set(session: AsyncSession) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")

    await service.seed_default_categories(session, space_a)
    await service.seed_default_categories(session, space_b)

    assert await _count(session, space_a) == TOTAL_DEFAULTS
    assert await _count(session, space_b) == TOTAL_DEFAULTS
    ids_a = {c.id for c in await service.list_categories(session, space_a)}
    ids_b = {c.id for c in await service.list_categories(session, space_b)}
    assert ids_a.isdisjoint(ids_b)


# list ---------------------------------------------------------------------------------------


async def test_list_is_empty_for_a_space_without_categories(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    assert await service.list_categories(session, space_id) == []


async def test_list_returns_the_categories_in_creation_order_not_alphabetical(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    await _main(session, space_id, "Zeta")
    await _main(session, space_id, "Alfa")
    await _main(session, space_id, "Medio")

    assert await _names(session, space_id) == ["Zeta", "Alfa", "Medio"]


async def test_list_keeps_a_renamed_category_where_it_was(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    first = await _main(session, space_id, "Primera")
    await _main(session, space_id, "Segunda")

    await service.update_category(session, space_id, first.id, _update(name="Zzz"))

    assert await _names(session, space_id) == ["Zzz", "Segunda"]


async def test_list_hides_the_archived_categories_unless_asked(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    await _main(session, space_id, "Activa")
    old = await _main(session, space_id, "Vieja")
    await service.archive_category(session, space_id, old.id)

    assert await _names(session, space_id) == ["Activa"]
    assert await _names(session, space_id, include_archived=True) == ["Activa", "Vieja"]


async def test_list_never_returns_the_categories_of_another_space(session: AsyncSession) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    await _main(session, space_a, "De A")
    await _main(session, space_b, "De B")

    assert await _names(session, space_b, include_archived=True) == ["De B"]


# create -------------------------------------------------------------------------------------


async def test_create_a_main_category(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    category = await service.create_category(
        session, space_id, _create(name="  Mascotas ", icon="paw-print")
    )

    assert category.id.version == 7
    assert category.space_id == space_id
    assert (category.name, category.kind, category.icon) == ("Mascotas", "expense", "paw-print")
    assert (category.parent_id, category.archived_at) == (None, None)


async def test_create_a_subcategory_of_a_main_of_the_same_kind(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    parent = await _main(session, space_id)

    sub = await service.create_category(
        session, space_id, _create(name="Supermercado", parent_id=str(parent.id))
    )

    assert (sub.parent_id, sub.kind) == (parent.id, "expense")


async def test_create_an_income_category(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    category = await _main(session, space_id, "Sueldo", kind="income")

    assert category.kind == "income"


async def test_create_a_third_level_is_a_422_on_the_parent(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    sub = await _sub(session, space_id, main)

    with pytest.raises(InvalidFieldError) as caught:
        await service.create_category(
            session, space_id, _create(name="Marca", parent_id=str(sub.id))
        )

    assert caught.value.loc == ["body", "parent_id"]
    assert caught.value.code == "category_parent_not_main"
    assert await _count(session, space_id) == 2


async def test_create_a_subcategory_of_another_kind_is_a_422_on_the_kind(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)

    with pytest.raises(InvalidFieldError) as caught:
        await service.create_category(
            session, space_id, _create(name="Sueldo", kind="income", parent_id=str(main.id))
        )

    assert caught.value.loc == ["body", "kind"]
    assert caught.value.code == "category_kind_mismatch"
    assert await _count(session, space_id) == 1


async def test_create_with_a_parent_that_does_not_exist_is_a_422_on_the_parent(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")

    with pytest.raises(InvalidFieldError) as caught:
        await service.create_category(session, space_id, _create(parent_id=str(uuid.uuid4())))

    assert caught.value.loc == ["body", "parent_id"]
    assert caught.value.code == "category_parent_not_found"


async def test_create_with_a_parent_of_another_space_is_the_same_422_as_a_missing_one(
    session: AsyncSession,
) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    parent_of_a = await _main(session, space_a)

    with pytest.raises(InvalidFieldError) as caught:
        await service.create_category(
            session, space_b, _create(name="Intrusa", parent_id=str(parent_of_a.id))
        )

    assert caught.value.loc == ["body", "parent_id"]
    assert caught.value.code == "category_parent_not_found"
    assert await _count(session, space_b) == 0


async def test_create_a_subcategory_under_an_archived_main_is_a_422_on_the_parent(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    await service.archive_category(session, space_id, main.id)

    with pytest.raises(InvalidFieldError) as caught:
        await service.create_category(
            session, space_id, _create(name="Nueva", parent_id=str(main.id))
        )

    assert caught.value.loc == ["body", "parent_id"]
    assert caught.value.code == "category_parent_archived"


# create: name conflicts ---------------------------------------------------------------------


async def test_a_main_name_already_used_in_the_same_kind_is_a_409(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    await _main(session, space_id, "Comida")

    with pytest.raises(ConflictError) as caught:
        await _main(session, space_id, "Comida")

    assert caught.value.code == "category_name_taken"
    assert await _names(session, space_id) == ["Comida"]


async def test_name_conflicts_ignore_case_and_surrounding_spaces(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    await _main(session, space_id, "Educación")

    with pytest.raises(ConflictError):
        await _main(session, space_id, "  EDUCACIÓN ")


async def test_a_subcategory_name_already_used_under_the_same_main_is_a_409(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    await _sub(session, space_id, main, "Supermercado")

    with pytest.raises(ConflictError) as caught:
        await _sub(session, space_id, main, "supermercado")

    assert caught.value.code == "category_name_taken"


async def test_an_archived_category_still_holds_its_name(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    old = await _main(session, space_id, "Ocio")
    await service.archive_category(session, space_id, old.id)

    with pytest.raises(ConflictError) as caught:
        await _main(session, space_id, "Ocio")

    assert caught.value.code == "category_name_taken"


async def test_the_session_is_still_usable_after_a_name_conflict(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    await _main(session, space_id, "Comida")
    with pytest.raises(ConflictError):
        await _main(session, space_id, "Comida")

    await _main(session, space_id, "Transporte")

    assert await _names(session, space_id) == ["Comida", "Transporte"]


async def test_the_same_name_is_allowed_in_the_other_kind(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    await _main(session, space_id, "Regalos", kind="expense")

    income = await _main(session, space_id, "Regalos", kind="income")

    assert income.kind == "income"


async def test_the_same_subcategory_name_is_allowed_under_another_main(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    food = await _main(session, space_id, "Comida")
    home = await _main(session, space_id, "Hogar")
    await _sub(session, space_id, food, "Otros")

    other = await _sub(session, space_id, home, "Otros")

    assert other.parent_id == home.id


async def test_a_subcategory_may_share_the_name_of_a_main(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id, "Salud")

    sub = await _sub(session, space_id, main, "Salud")

    assert sub.parent_id == main.id


async def test_the_same_name_is_allowed_in_another_space(session: AsyncSession) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    await _main(session, space_a, "Comida")

    other = await _main(session, space_b, "Comida")

    assert other.space_id == space_b


# update -------------------------------------------------------------------------------------


async def test_update_renames_a_category_and_changes_its_icon(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    category = await _main(session, space_id)

    updated = await service.update_category(
        session, space_id, category.id, _update(name=" Alimentos ", icon="basket")
    )

    assert (updated.name, updated.icon) == ("Alimentos", "basket")
    assert (updated.kind, updated.parent_id) == ("expense", None)


async def test_update_only_touches_the_fields_that_were_sent(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    category = await _main(session, space_id)

    renamed = await service.update_category(session, space_id, category.id, _update(name="Otro"))
    after_rename = (renamed.name, renamed.icon)
    iconed = await service.update_category(session, space_id, category.id, _update(icon="tag"))
    after_icon = (iconed.name, iconed.icon)

    assert after_rename == ("Otro", "fork-knife")
    assert after_icon == ("Otro", "tag")


async def test_an_empty_update_returns_the_category_unchanged(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    category = await _main(session, space_id)

    same = await service.update_category(session, space_id, category.id, _update())

    assert (same.name, same.icon, same.archived_at) == ("Comida", "fork-knife", None)


async def test_update_can_rename_a_subcategory_and_an_archived_category(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    sub = await _sub(session, space_id, main)
    await service.archive_category(session, space_id, main.id)

    renamed = await service.update_category(session, space_id, sub.id, _update(name="Mercado"))

    assert renamed.name == "Mercado"
    assert renamed.archived_at is not None


async def test_renaming_to_a_taken_name_is_a_409_and_keeps_the_old_one(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    await _main(session, space_id, "Comida")
    other = await _main(session, space_id, "Hogar")

    with pytest.raises(ConflictError) as caught:
        await service.update_category(session, space_id, other.id, _update(name="comida"))

    assert caught.value.code == "category_name_taken"
    assert await _names(session, space_id) == ["Comida", "Hogar"]


async def test_renaming_a_category_to_its_own_name_is_not_a_conflict(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    category = await _main(session, space_id, "Comida")

    same = await service.update_category(session, space_id, category.id, _update(name="COMIDA"))

    assert same.name == "COMIDA"


async def test_update_of_a_category_of_another_space_is_not_found(session: AsyncSession) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    category = await _main(session, space_a)

    with pytest.raises(NotFoundError) as caught:
        await service.update_category(session, space_b, category.id, _update(name="Robada"))

    assert caught.value.code == "category_not_found"
    assert await _names(session, space_a) == ["Comida"]


async def test_update_of_a_missing_category_is_not_found(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    with pytest.raises(NotFoundError):
        await service.update_category(session, space_id, uuid.uuid4(), _update(name="x"))


# archive ------------------------------------------------------------------------------------


async def test_archive_marks_the_category_as_archived(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    category = await _main(session, space_id)

    archived = await service.archive_category(session, space_id, category.id)

    assert archived.archived_at is not None


async def test_archiving_a_main_archives_its_active_subcategories_with_the_same_moment(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    first = await _sub(session, space_id, main, "Supermercado")
    second = await _sub(session, space_id, main, "Restaurantes")

    archived = await service.archive_category(session, space_id, main.id)

    await session.refresh(first)
    await session.refresh(second)
    assert archived.archived_at is not None
    assert first.archived_at == archived.archived_at
    assert second.archived_at == archived.archived_at


async def test_archiving_a_main_does_not_touch_other_mains_or_their_subcategories(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    food = await _main(session, space_id, "Comida")
    home = await _main(session, space_id, "Hogar")
    rent = await _sub(session, space_id, home, "Alquiler")

    await service.archive_category(session, space_id, food.id)

    await session.refresh(home)
    await session.refresh(rent)
    assert (home.archived_at, rent.archived_at) == (None, None)


async def test_archiving_a_subcategory_leaves_its_main_active(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    sub = await _sub(session, space_id, main)

    archived = await service.archive_category(session, space_id, sub.id)

    await session.refresh(main)
    assert archived.archived_at is not None
    assert main.archived_at is None


async def test_archiving_twice_keeps_the_first_moment(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    category = await _main(session, space_id)
    first = await service.archive_category(session, space_id, category.id)
    moment = first.archived_at

    again = await service.archive_category(session, space_id, category.id)

    assert again.archived_at == moment


async def test_a_subcategory_archived_earlier_keeps_its_own_moment_when_the_main_is_archived(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    early = await _sub(session, space_id, main, "Antes")
    early_moment = (await service.archive_category(session, space_id, early.id)).archived_at
    assert early_moment is not None

    archived = await service.archive_category(session, space_id, main.id)

    await session.refresh(early)
    assert early.archived_at == early_moment
    assert archived.archived_at != early_moment


async def test_archive_of_a_category_of_another_space_is_not_found(
    session: AsyncSession,
) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    category = await _main(session, space_a)

    with pytest.raises(NotFoundError) as caught:
        await service.archive_category(session, space_b, category.id)

    assert caught.value.code == "category_not_found"
    assert category.archived_at is None


# unarchive ----------------------------------------------------------------------------------


async def test_unarchive_makes_the_category_active_again(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    category = await _main(session, space_id)
    await service.archive_category(session, space_id, category.id)

    restored = await service.unarchive_category(session, space_id, category.id)

    assert restored.archived_at is None
    assert await _names(session, space_id) == ["Comida"]


async def test_unarchiving_a_main_restores_the_subcategories_archived_with_it(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    sub = await _sub(session, space_id, main)
    await service.archive_category(session, space_id, main.id)

    await service.unarchive_category(session, space_id, main.id)

    await session.refresh(sub)
    assert sub.archived_at is None
    assert await _names(session, space_id) == ["Comida", "Supermercado"]


async def test_unarchiving_a_main_keeps_archived_the_subcategories_archived_on_their_own(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    alone = await _sub(session, space_id, main, "Sola")
    together = await _sub(session, space_id, main, "Junta")
    await service.archive_category(session, space_id, alone.id)
    await service.archive_category(session, space_id, main.id)

    await service.unarchive_category(session, space_id, main.id)

    await session.refresh(alone)
    await session.refresh(together)
    assert alone.archived_at is not None
    assert together.archived_at is None


async def test_unarchiving_a_subcategory_whose_main_is_archived_is_a_409(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    sub = await _sub(session, space_id, main)
    await service.archive_category(session, space_id, main.id)

    with pytest.raises(ConflictError) as caught:
        await service.unarchive_category(session, space_id, sub.id)

    assert caught.value.code == "category_parent_archived"
    await session.refresh(sub)
    assert sub.archived_at is not None


async def test_unarchiving_a_subcategory_whose_main_is_active_works(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    sub = await _sub(session, space_id, main)
    await service.archive_category(session, space_id, sub.id)

    restored = await service.unarchive_category(session, space_id, sub.id)

    assert restored.archived_at is None


async def test_unarchiving_an_active_category_changes_nothing(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    category = await _main(session, space_id)

    same = await service.unarchive_category(session, space_id, category.id)

    assert same.archived_at is None


async def test_unarchive_of_a_category_of_another_space_is_not_found(
    session: AsyncSession,
) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    category = await _main(session, space_a)
    await service.archive_category(session, space_a, category.id)

    with pytest.raises(NotFoundError):
        await service.unarchive_category(session, space_b, category.id)

    assert category.archived_at is not None


# get_category (for other modules) -----------------------------------------------------------


async def test_get_category_returns_a_schema_even_when_archived(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    main = await _main(session, space_id)
    sub = await _sub(session, space_id, main)
    await service.archive_category(session, space_id, sub.id)

    read = await service.get_category(session, space_id, sub.id)

    assert isinstance(read, CategoryRead)
    assert (read.id, read.parent_id, read.kind, read.icon) == (
        sub.id,
        main.id,
        "expense",
        "fork-knife",
    )
    assert read.archived_at is not None


async def test_get_category_of_another_space_is_not_found(session: AsyncSession) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    category = await _main(session, space_a)

    with pytest.raises(NotFoundError) as caught:
        await service.get_category(session, space_b, category.id)

    assert caught.value.code == "category_not_found"
