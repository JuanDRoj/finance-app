import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidFieldError, NotFoundError
from app.modules.accounts import service
from app.modules.accounts.models import Account
from app.modules.accounts.schemas import AccountCreate, AccountRead, AccountUpdate
from app.modules.spaces import service as spaces_service
from app.modules.users import service as users_service


async def _make_space(session: AsyncSession, uid: str) -> uuid.UUID:
    user = await users_service.upsert_user(
        session, firebase_uid=uid, email=f"{uid}@example.com", display_name=None
    )
    await spaces_service.ensure_personal_space(session, user.id, "America/Montevideo")
    [space] = await spaces_service.list_spaces(session, user.id)
    return space.id


def _create(**fields: object) -> AccountCreate:
    return AccountCreate.model_validate({"type": "bank", "name": "Itaú", **fields})


def _update(**fields: object) -> AccountUpdate:
    return AccountUpdate.model_validate(fields)


async def _archived(session: AsyncSession, space_id: uuid.UUID, name: str) -> Account:
    account = Account(space_id=space_id, name=name, type="cash", archived_at=datetime.now(UTC))
    session.add(account)
    await session.flush()
    return account


# create -------------------------------------------------------------------------------------


async def test_create_a_bank_account(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    account = await service.create_account(session, space_id, _create())

    assert account.id.version == 7
    assert account.space_id == space_id
    assert (account.name, account.type) == ("Itaú", "bank")
    assert (account.closing_day, account.due_day, account.archived_at) == (None, None, None)


async def test_create_a_cash_account(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    account = await service.create_account(session, space_id, _create(type="cash", name="Cartera"))

    assert (account.type, account.closing_day, account.due_day) == ("cash", None, None)


async def test_create_a_credit_card_with_its_days(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    account = await service.create_account(
        session, space_id, _create(type="credit_card", name="Visa", closing_day=5, due_day=12)
    )

    assert (account.type, account.closing_day, account.due_day) == ("credit_card", 5, 12)


async def test_two_accounts_may_share_a_name(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    first = await service.create_account(session, space_id, _create())
    second = await service.create_account(session, space_id, _create())

    assert first.id != second.id


# list ---------------------------------------------------------------------------------------


async def test_list_returns_the_accounts_of_the_space_ordered_by_name(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    for name in ("Santander", "BBVA", "Itaú"):
        await service.create_account(session, space_id, _create(name=name))

    accounts = await service.list_accounts(session, space_id)

    assert [a.name for a in accounts] == ["BBVA", "Itaú", "Santander"]


async def test_list_orders_equal_names_by_id(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    first = await service.create_account(session, space_id, _create())
    second = await service.create_account(session, space_id, _create())

    accounts = await service.list_accounts(session, space_id)

    assert [a.id for a in accounts] == sorted([first.id, second.id])


async def test_list_is_empty_for_a_space_without_accounts(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    assert await service.list_accounts(session, space_id) == []


async def test_list_hides_archived_accounts_unless_asked(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    await service.create_account(session, space_id, _create(name="Activa"))
    await _archived(session, space_id, "Archivada")

    default = await service.list_accounts(session, space_id)
    everything = await service.list_accounts(session, space_id, include_archived=True)

    assert [a.name for a in default] == ["Activa"]
    assert [a.name for a in everything] == ["Activa", "Archivada"]


async def test_list_never_returns_accounts_of_another_space(session: AsyncSession) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    await service.create_account(session, space_a, _create(name="De A"))
    archived_a = await _archived(session, space_a, "Archivada de A")
    mine = await service.create_account(session, space_b, _create(name="De B"))

    accounts = await service.list_accounts(session, space_b, include_archived=True)

    assert [a.id for a in accounts] == [mine.id]
    assert archived_a.id not in {a.id for a in accounts}


# get ----------------------------------------------------------------------------------------


async def test_get_returns_a_schema_not_the_orm_object(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    created = await service.create_account(session, space_id, _create())

    account = await service.get_account(session, space_id, created.id)

    assert isinstance(account, AccountRead)
    assert account.model_dump() == {
        "id": created.id,
        "name": "Itaú",
        "type": "bank",
        "closing_day": None,
        "due_day": None,
        "archived_at": None,
    }


async def test_get_also_returns_an_archived_account(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    archived = await _archived(session, space_id, "Vieja")

    account = await service.get_account(session, space_id, archived.id)

    assert account.archived_at is not None


async def test_get_of_a_missing_account_is_not_found(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    with pytest.raises(NotFoundError) as exc:
        await service.get_account(session, space_id, uuid.uuid4())

    assert exc.value.code == "account_not_found"


async def test_get_of_an_account_of_another_space_is_not_found(session: AsyncSession) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    theirs = await service.create_account(session, space_a, _create())

    with pytest.raises(NotFoundError) as exc:
        await service.get_account(session, space_b, theirs.id)

    assert exc.value.code == "account_not_found"


# update -------------------------------------------------------------------------------------


async def test_update_renames_the_account(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    created = await service.create_account(session, space_id, _create())

    updated = await service.update_account(session, space_id, created.id, _update(name="Nuevo"))

    assert updated.name == "Nuevo"
    assert (await service.get_account(session, space_id, created.id)).name == "Nuevo"


async def test_update_changes_one_day_of_a_card_and_keeps_the_other(
    session: AsyncSession,
) -> None:
    space_id = await _make_space(session, "uid-a")
    card = await service.create_account(
        session, space_id, _create(type="credit_card", name="Visa", closing_day=5, due_day=12)
    )

    updated = await service.update_account(session, space_id, card.id, _update(closing_day=20))

    assert (updated.closing_day, updated.due_day, updated.name) == (20, 12, "Visa")


async def test_update_changes_name_and_days_together(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    card = await service.create_account(
        session, space_id, _create(type="credit_card", name="Visa", closing_day=5, due_day=12)
    )

    updated = await service.update_account(
        session, space_id, card.id, _update(name="Visa Gold", closing_day=1, due_day=31)
    )

    assert (updated.name, updated.closing_day, updated.due_day) == ("Visa Gold", 1, 31)


async def test_an_empty_update_changes_nothing(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    created = await service.create_account(session, space_id, _create())

    updated = await service.update_account(session, space_id, created.id, _update())

    assert (updated.name, updated.type, updated.closing_day) == ("Itaú", "bank", None)


@pytest.mark.parametrize("kind", ["bank", "cash"])
@pytest.mark.parametrize("field", ["closing_day", "due_day"])
async def test_update_rejects_days_on_accounts_that_are_not_cards(
    session: AsyncSession, kind: str, field: str
) -> None:
    space_id = await _make_space(session, "uid-a")
    created = await service.create_account(session, space_id, _create(type=kind))

    with pytest.raises(InvalidFieldError) as exc:
        await service.update_account(session, space_id, created.id, _update(**{field: 5}))

    assert exc.value.code == "card_day_not_allowed"
    assert exc.value.loc == ["body", field]
    assert (await service.get_account(session, space_id, created.id)).model_dump()[field] is None


async def test_a_rejected_update_changes_nothing_else(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    created = await service.create_account(session, space_id, _create())

    with pytest.raises(InvalidFieldError):
        await service.update_account(
            session, space_id, created.id, _update(name="Otro", closing_day=5)
        )

    assert (await service.get_account(session, space_id, created.id)).name == "Itaú"


async def test_update_of_an_account_of_another_space_is_not_found_and_changes_nothing(
    session: AsyncSession,
) -> None:
    space_a = await _make_space(session, "uid-a")
    space_b = await _make_space(session, "uid-b")
    theirs = await service.create_account(session, space_a, _create(name="De A"))

    with pytest.raises(NotFoundError) as exc:
        await service.update_account(session, space_b, theirs.id, _update(name="Robada"))

    assert exc.value.code == "account_not_found"
    assert (await service.get_account(session, space_a, theirs.id)).name == "De A"


async def test_update_of_a_missing_account_is_not_found(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")

    with pytest.raises(NotFoundError):
        await service.update_account(session, space_id, uuid.uuid4(), _update(name="x"))


async def test_an_archived_account_can_be_renamed(session: AsyncSession) -> None:
    space_id = await _make_space(session, "uid-a")
    archived = await _archived(session, space_id, "Vieja")

    updated = await service.update_account(session, space_id, archived.id, _update(name="Nueva"))

    assert updated.name == "Nueva"
    assert updated.archived_at is not None
