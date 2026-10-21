import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts.models import Account
from app.modules.spaces import service as spaces_service
from app.modules.users import service as users_service
from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import insert_transaction

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
ACCOUNT_NOT_FOUND = {"detail": "Account not found", "code": "account_not_found"}
NOT_AUTHENTICATED = {"detail": "Not authenticated", "code": "not_authenticated"}


async def _user_with_space(session: AsyncSession, uid: str) -> uuid.UUID:
    user = await users_service.upsert_user(
        session, firebase_uid=uid, email=f"{uid}@example.com", display_name=None
    )
    await spaces_service.ensure_personal_space(session, user.id, "America/Montevideo")
    [space] = await spaces_service.list_spaces(session, user.id)
    return space.id


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


def _url(space_id: uuid.UUID, account_id: uuid.UUID | str | None = None) -> str:
    base = f"/spaces/{space_id}/accounts"
    return base if account_id is None else f"{base}/{account_id}"


async def _post(client: AsyncClient, space_id: uuid.UUID, **body: Any) -> dict[str, Any]:
    response = await client.post(_url(space_id), json=body, headers=COOKIE)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def _archived_account(session: AsyncSession, space_id: uuid.UUID, name: str) -> uuid.UUID:
    # There is no archive endpoint yet (BE-16): archived rows are inserted directly.
    account = Account(space_id=space_id, name=name, type="bank", archived_at=datetime.now(UTC))
    session.add(account)
    await session.flush()
    return account.id


# POST ---------------------------------------------------------------------------------------


async def test_create_a_bank_account(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.post(
        _url(space_id), json={"type": "bank", "name": "  Itaú "}, headers=COOKIE
    )

    assert response.status_code == 201
    body = response.json()
    assert uuid.UUID(body.pop("id")).version == 7
    assert body == {
        "name": "Itaú",
        "type": "bank",
        "closing_day": None,
        "due_day": None,
        "archived_at": None,
        "balance_minor": 0,
    }


async def test_create_a_cash_account(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    body = await _post(api_client, space_id, type="cash", name="Billetera")

    assert (body["type"], body["closing_day"], body["due_day"]) == ("cash", None, None)


async def test_create_a_credit_card_with_its_days(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    body = await _post(
        api_client, space_id, type="credit_card", name="Visa", closing_day=5, due_day=12
    )

    assert (body["type"], body["closing_day"], body["due_day"]) == ("credit_card", 5, 12)


async def test_a_created_account_can_be_read_back(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id, type="cash", name="Billetera")

    response = await api_client.get(_url(space_id, created["id"]), headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == created


@pytest.mark.parametrize(
    ("body", "error_type", "loc"),
    [
        ({"type": "bank", "name": ""}, "string_too_short", ["body", "name"]),
        ({"type": "bank", "name": "   "}, "string_too_short", ["body", "name"]),
        ({"type": "bank", "name": "a" * 81}, "string_too_long", ["body", "name"]),
        ({"type": "bank"}, "missing", ["body", "name"]),
        ({"name": "x"}, "missing", ["body", "type"]),
        ({"type": "savings", "name": "x"}, "literal_error", ["body", "type"]),
        (
            {"type": "credit_card", "name": "Visa", "due_day": 12},
            "card_day_required",
            ["body", "closing_day"],
        ),
        (
            {"type": "credit_card", "name": "Visa", "closing_day": 5},
            "card_day_required",
            ["body", "due_day"],
        ),
        (
            {"type": "bank", "name": "Itaú", "closing_day": 5},
            "card_day_not_allowed",
            ["body", "closing_day"],
        ),
        (
            {"type": "cash", "name": "Caja", "due_day": 5},
            "card_day_not_allowed",
            ["body", "due_day"],
        ),
        (
            {"type": "credit_card", "name": "V", "closing_day": 0, "due_day": 5},
            "greater_than_equal",
            ["body", "closing_day"],
        ),
        (
            {"type": "credit_card", "name": "V", "closing_day": 5, "due_day": 32},
            "less_than_equal",
            ["body", "due_day"],
        ),
        (
            {"type": "bank", "name": "Itaú", "initial_balance_minor": 1000},
            "extra_forbidden",
            ["body", "initial_balance_minor"],
        ),
        (
            {"type": "bank", "name": "Itaú", "archived_at": "2026-01-01T00:00:00Z"},
            "extra_forbidden",
            ["body", "archived_at"],
        ),
        (
            {"type": "bank", "name": "Itaú", "space_id": str(uuid.uuid4())},
            "extra_forbidden",
            ["body", "space_id"],
        ),
    ],
)
async def test_create_rejects_invalid_bodies_with_a_422_on_the_offending_field(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    body: dict[str, Any],
    error_type: str,
    loc: list[str],
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.post(_url(space_id), json=body, headers=COOKIE)

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == (error_type, loc)
    assert (await api_client.get(_url(space_id), headers=COOKIE)).json() == []


async def test_a_credit_card_without_days_reports_both_days(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.post(
        _url(space_id), json={"type": "credit_card", "name": "Visa"}, headers=COOKIE
    )

    assert response.status_code == 422
    assert [(e["type"], e["loc"]) for e in response.json()["detail"]] == [
        ("card_day_required", ["body", "closing_day"]),
        ("card_day_required", ["body", "due_day"]),
    ]


async def test_create_without_a_body_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.post(_url(space_id), headers=COOKIE)

    assert response.status_code == 422


# GET list -----------------------------------------------------------------------------------


async def test_list_is_empty_without_accounts(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get(_url(space_id), headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == []


async def test_list_returns_the_accounts_ordered_by_name(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    await _post(api_client, space_id, type="bank", name="Santander")
    await _post(api_client, space_id, type="cash", name="Billetera")
    await _post(api_client, space_id, type="credit_card", name="Visa", closing_day=1, due_day=9)

    response = await api_client.get(_url(space_id), headers=COOKIE)

    assert response.status_code == 200
    assert [a["name"] for a in response.json()] == ["Billetera", "Santander", "Visa"]
    assert set(response.json()[0]) == {
        "id",
        "name",
        "type",
        "closing_day",
        "due_day",
        "archived_at",
        "balance_minor",
    }


async def test_list_hides_archived_accounts_by_default(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    active = await _post(api_client, space_id, type="bank", name="Activa")
    await _archived_account(session, space_id, "Archivada")

    response = await api_client.get(_url(space_id), headers=COOKIE)

    assert [a["id"] for a in response.json()] == [active["id"]]


async def test_list_can_include_the_archived_accounts(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    await _post(api_client, space_id, type="bank", name="Activa")
    await _archived_account(session, space_id, "Archivada")

    response = await api_client.get(
        _url(space_id), params={"include_archived": "true"}, headers=COOKIE
    )

    assert [(a["name"], a["archived_at"] is not None) for a in response.json()] == [
        ("Activa", False),
        ("Archivada", True),
    ]


async def test_list_rejects_a_malformed_include_archived(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get(
        _url(space_id), params={"include_archived": "maybe"}, headers=COOKIE
    )

    assert response.status_code == 422


# GET detail ---------------------------------------------------------------------------------


async def test_detail_of_an_archived_account_is_still_readable(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    archived_id = await _archived_account(session, space_id, "Vieja")

    response = await api_client.get(_url(space_id, archived_id), headers=COOKIE)

    assert response.status_code == 200
    assert response.json()["archived_at"] is not None


async def test_detail_of_a_missing_account_is_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get(_url(space_id, uuid.uuid4()), headers=COOKIE)

    assert response.status_code == 404
    assert response.json() == ACCOUNT_NOT_FOUND


async def test_an_account_id_that_is_not_a_uuid_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    get = await api_client.get(_url(space_id, "not-a-uuid"), headers=COOKIE)
    patch = await api_client.patch(_url(space_id, "not-a-uuid"), json={}, headers=COOKIE)

    assert (get.status_code, patch.status_code) == (422, 422)


# PATCH --------------------------------------------------------------------------------------


async def test_patch_renames_an_account_and_the_change_persists(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id, type="bank", name="Itaú")

    response = await api_client.patch(
        _url(space_id, created["id"]), json={"name": " Itaú Pesos "}, headers=COOKIE
    )

    assert response.status_code == 200
    assert response.json() == {**created, "name": "Itaú Pesos"}
    reread = await api_client.get(_url(space_id, created["id"]), headers=COOKIE)
    assert reread.json() == response.json()


async def test_patch_changes_the_days_of_a_card(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    card = await _post(
        api_client, space_id, type="credit_card", name="Visa", closing_day=5, due_day=12
    )

    only_closing = await api_client.patch(
        _url(space_id, card["id"]), json={"closing_day": 20}, headers=COOKIE
    )
    both = await api_client.patch(
        _url(space_id, card["id"]), json={"closing_day": 1, "due_day": 31}, headers=COOKIE
    )

    assert (only_closing.json()["closing_day"], only_closing.json()["due_day"]) == (20, 12)
    assert (both.json()["closing_day"], both.json()["due_day"]) == (1, 31)


async def test_an_empty_patch_returns_the_account_unchanged(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id, type="bank", name="Itaú")

    response = await api_client.patch(_url(space_id, created["id"]), json={}, headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == created


async def test_patch_can_rename_an_archived_account(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    archived_id = await _archived_account(session, space_id, "Vieja")

    response = await api_client.patch(
        _url(space_id, archived_id), json={"name": "Nueva"}, headers=COOKIE
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Nueva"
    assert response.json()["archived_at"] is not None


@pytest.mark.parametrize("field", ["type", "archived_at", "space_id", "id"])
async def test_patch_does_not_accept_the_type_or_other_fields(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, field: str
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id, type="bank", name="Itaú")

    response = await api_client.patch(
        _url(space_id, created["id"]), json={field: "cash"}, headers=COOKIE
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("extra_forbidden", ["body", field])
    assert (await api_client.get(_url(space_id, created["id"]), headers=COOKIE)).json() == created


@pytest.mark.parametrize("field", ["name", "closing_day", "due_day"])
async def test_patch_rejects_an_explicit_null(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, field: str
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    card = await _post(
        api_client, space_id, type="credit_card", name="Visa", closing_day=5, due_day=12
    )

    response = await api_client.patch(
        _url(space_id, card["id"]), json={field: None}, headers=COOKIE
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("null_not_allowed", ["body", field])


@pytest.mark.parametrize(
    ("body", "loc"),
    [
        ({"name": ""}, ["body", "name"]),
        ({"name": "   "}, ["body", "name"]),
        ({"name": "a" * 81}, ["body", "name"]),
        ({"closing_day": 0}, ["body", "closing_day"]),
        ({"due_day": 32}, ["body", "due_day"]),
        ({"due_day": "5"}, ["body", "due_day"]),
    ],
)
async def test_patch_validates_the_name_and_the_days(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    body: dict[str, Any],
    loc: list[str],
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    card = await _post(
        api_client, space_id, type="credit_card", name="Visa", closing_day=5, due_day=12
    )

    response = await api_client.patch(_url(space_id, card["id"]), json=body, headers=COOKIE)

    assert response.status_code == 422
    assert [e["loc"] for e in response.json()["detail"]] == [loc]


@pytest.mark.parametrize("kind", ["bank", "cash"])
@pytest.mark.parametrize("field", ["closing_day", "due_day"])
async def test_patch_rejects_days_on_a_bank_or_cash_account(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    kind: str,
    field: str,
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id, type=kind, name="Cuenta")

    response = await api_client.patch(
        _url(space_id, created["id"]), json={"name": "Otra", field: 5}, headers=COOKIE
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("card_day_not_allowed", ["body", field])
    # The whole request is rejected: the valid name was not applied either.
    assert (await api_client.get(_url(space_id, created["id"]), headers=COOKIE)).json() == created


async def test_patch_of_a_missing_account_is_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.patch(
        _url(space_id, uuid.uuid4()), json={"name": "x"}, headers=COOKIE
    )

    assert response.status_code == 404
    assert response.json() == ACCOUNT_NOT_FOUND


# balances -----------------------------------------------------------------------------------


async def _user_id(session: AsyncSession, uid: str) -> uuid.UUID:
    user = await users_service.get_by_firebase_uid(session, uid)
    assert user is not None
    return user.id


async def test_list_shows_the_balance_of_each_account(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    user_id = await _user_id(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await _post(api_client, space_id, type="bank", name="Itaú")
    cash = await _post(api_client, space_id, type="cash", name="Billetera")
    card = await _post(
        api_client, space_id, type="credit_card", name="Visa", closing_day=5, due_day=12
    )
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(uuid.UUID(bank["id"]), 100_000, None)])
    await insert_transaction(session, *spec, entries=[(uuid.UUID(bank["id"]), -2_550, None)])
    await insert_transaction(session, *spec, entries=[(uuid.UUID(card["id"]), -30_000, None)])

    response = await api_client.get(_url(space_id), headers=COOKIE)

    balances = {a["id"]: a["balance_minor"] for a in response.json()}
    assert balances == {bank["id"]: 97_450, cash["id"]: 0, card["id"]: -30_000}


async def test_the_balance_ignores_pending_skipped_and_deleted_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    user_id = await _user_id(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = uuid.UUID((await _post(api_client, space_id, type="bank", name="Itaú"))["id"])
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(bank, 1_000, None)])
    await insert_transaction(session, *spec, entries=[(bank, 7, None)], status="pending")
    await insert_transaction(session, *spec, entries=[(bank, 70, None)], status="skipped")
    await insert_transaction(
        session, *spec, entries=[(bank, 700, None)], deleted_at=datetime.now(UTC)
    )

    listed = await api_client.get(_url(space_id), headers=COOKIE)
    detail = await api_client.get(_url(space_id, bank), headers=COOKIE)

    assert [a["balance_minor"] for a in listed.json()] == [1_000]
    assert detail.json()["balance_minor"] == 1_000


async def test_detail_patch_and_archived_list_also_carry_the_balance(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    user_id = await _user_id(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await _post(api_client, space_id, type="bank", name="Itaú")
    await insert_transaction(
        session,
        space_id=space_id,
        user_id=user_id,
        entries=[(uuid.UUID(bank["id"]), 4_321, None)],
    )

    detail = await api_client.get(_url(space_id, bank["id"]), headers=COOKIE)
    patched = await api_client.patch(
        _url(space_id, bank["id"]), json={"name": "Itaú Pesos"}, headers=COOKIE
    )
    empty_patch = await api_client.patch(_url(space_id, bank["id"]), json={}, headers=COOKIE)

    assert detail.json()["balance_minor"] == 4_321
    assert patched.json()["balance_minor"] == 4_321
    assert empty_patch.json()["balance_minor"] == 4_321


async def test_the_balance_of_an_account_ignores_the_movements_of_another_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_a = await _user_with_space(session, "uid-a")
    space_b = await _user_with_space(session, "uid-b")
    user_a = await _user_id(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-b")
    mine = await _post(api_client, space_b, type="bank", name="Mía")
    _sign_in_as(fake_firebase, "uid-a")
    theirs = await _post(api_client, space_a, type="bank", name="De A")
    await insert_transaction(
        session,
        space_id=space_a,
        user_id=user_a,
        entries=[(uuid.UUID(theirs["id"]), 99_000, None)],
    )
    _sign_in_as(fake_firebase, "uid-b")

    listed = await api_client.get(_url(space_b), headers=COOKIE)
    stolen = await api_client.get(_url(space_b, theirs["id"]), headers=COOKIE)

    assert [(a["id"], a["balance_minor"]) for a in listed.json()] == [(mine["id"], 0)]
    assert (stolen.status_code, stolen.json()) == (404, ACCOUNT_NOT_FOUND)


# 401 ----------------------------------------------------------------------------------------


async def test_every_account_route_without_a_session_is_a_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    account_id = uuid.uuid4()

    responses = [
        await api_client.get(_url(space_id)),
        await api_client.post(_url(space_id), json={"type": "cash", "name": "x"}),
        await api_client.get(_url(space_id, account_id)),
        await api_client.patch(_url(space_id, account_id), json={"name": "x"}),
    ]

    assert [r.status_code for r in responses] == [401, 401, 401, 401]
    assert all(r.json() == NOT_AUTHENTICATED for r in responses)
    assert not fake_firebase.called


# IDOR ---------------------------------------------------------------------------------------


async def test_user_b_gets_404_on_every_account_route_of_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_a = await _user_with_space(session, "uid-a")
    await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-a")
    account_a = await _post(api_client, space_a, type="bank", name="De A")
    _sign_in_as(fake_firebase, "uid-b")

    responses = [
        await api_client.get(_url(space_a), headers=COOKIE),
        await api_client.get(_url(space_a), params={"include_archived": "true"}, headers=COOKIE),
        await api_client.post(
            _url(space_a), json={"type": "cash", "name": "Intrusa"}, headers=COOKIE
        ),
        await api_client.get(_url(space_a, account_a["id"]), headers=COOKIE),
        await api_client.patch(
            _url(space_a, account_a["id"]), json={"name": "Robada"}, headers=COOKIE
        ),
    ]

    assert [r.status_code for r in responses] == [404] * 5
    assert all(r.json() == SPACE_NOT_FOUND for r in responses)
    _sign_in_as(fake_firebase, "uid-a")
    after = await api_client.get(_url(space_a), headers=COOKIE)
    assert after.json() == [account_a]


async def test_an_account_of_space_a_is_a_404_inside_the_own_space_of_user_b(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    # B is a member of space B, so the membership guard passes: the 404 comes from the repository
    # filtering by space, which is what stops an id guessed from another space.
    space_a = await _user_with_space(session, "uid-a")
    space_b = await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-a")
    account_a = await _post(api_client, space_a, type="bank", name="De A")
    _sign_in_as(fake_firebase, "uid-b")

    read = await api_client.get(_url(space_b, account_a["id"]), headers=COOKIE)
    write = await api_client.patch(
        _url(space_b, account_a["id"]), json={"name": "Robada"}, headers=COOKIE
    )

    assert (read.status_code, write.status_code) == (404, 404)
    assert read.json() == ACCOUNT_NOT_FOUND
    assert write.json() == ACCOUNT_NOT_FOUND
    _sign_in_as(fake_firebase, "uid-a")
    unchanged = await api_client.get(_url(space_a, account_a["id"]), headers=COOKIE)
    assert unchanged.json() == account_a


async def test_the_list_of_user_b_never_includes_the_accounts_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_a = await _user_with_space(session, "uid-a")
    space_b = await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-a")
    account_a = await _post(api_client, space_a, type="bank", name="De A")
    archived_a = await _archived_account(session, space_a, "Archivada de A")
    _sign_in_as(fake_firebase, "uid-b")
    account_b = await _post(api_client, space_b, type="cash", name="De B")

    default = await api_client.get(_url(space_b), headers=COOKIE)
    everything = await api_client.get(
        _url(space_b), params={"include_archived": "true"}, headers=COOKIE
    )

    assert [a["id"] for a in default.json()] == [account_b["id"]]
    assert [a["id"] for a in everything.json()] == [account_b["id"]]
    assert account_a["id"] not in everything.text
    assert str(archived_a) not in everything.text
