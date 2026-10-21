import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import UnauthenticatedError
from app.modules.spaces import service as spaces_service
from app.modules.spaces.models import Space
from app.modules.users import service as users_service
from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import insert_transaction, make_account

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}


async def _user_with_space(session: AsyncSession, uid: str) -> tuple[uuid.UUID, uuid.UUID]:
    user = await users_service.upsert_user(
        session, firebase_uid=uid, email=f"{uid}@example.com", display_name=None
    )
    await spaces_service.ensure_personal_space(session, user.id, "America/Montevideo")
    [space] = await spaces_service.list_spaces(session, user.id)
    return user.id, space.id


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


async def test_list_returns_only_the_spaces_of_the_user(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await _user_with_space(session, "uid-a")
    _, space_b = await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get("/spaces", headers=COOKIE)

    assert response.status_code == 200
    assert [s["id"] for s in response.json()] == [str(space_a)]
    assert str(space_b) not in response.text


async def test_list_is_empty_for_a_user_without_spaces(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await users_service.upsert_user(
        session, firebase_uid="uid-a", email="a@example.com", display_name=None
    )
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get("/spaces", headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == []


async def test_detail_of_the_personal_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == {
        "id": str(space_id),
        "name": "Mi espacio",
        "type": "personal",
        "currency": {"code": "UYU", "exponent": 2},
        "timezone": "America/Montevideo",
        "currency_locked": False,
    }


async def test_detail_shows_the_exponent_of_a_zero_decimal_currency(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    space = await session.get(Space, space_id)
    assert space is not None
    space.currency = "CLP"
    await session.flush()
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    assert response.json()["currency"] == {"code": "CLP", "exponent": 0}


async def test_user_b_gets_404_on_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await _user_with_space(session, "uid-a")
    await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-b")

    foreign = await api_client.get(f"/spaces/{space_a}", headers=COOKIE)
    missing = await api_client.get(f"/spaces/{uuid.uuid4()}", headers=COOKIE)

    assert foreign.status_code == 404
    assert foreign.json() == SPACE_NOT_FOUND
    assert (foreign.status_code, foreign.json()) == (missing.status_code, missing.json())


async def test_without_a_session_both_routes_are_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")

    for path in ("/spaces", f"/spaces/{space_id}"):
        response = await api_client.get(path)
        assert response.status_code == 401, path
        assert response.json()["code"] == "not_authenticated"


async def test_a_space_id_that_is_not_a_uuid_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await users_service.upsert_user(
        session, firebase_uid="uid-a", email="a@example.com", display_name=None
    )
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get("/spaces/not-a-uuid", headers=COOKIE)

    assert response.status_code == 422


async def test_trailing_slash_is_a_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get("/spaces/", headers=COOKIE)

    assert response.status_code == 404


async def test_a_cookie_rejected_by_firebase_is_401_on_both_routes(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    fake_firebase.session_error = UnauthenticatedError("invalid_session", "Invalid session")

    for path in ("/spaces", f"/spaces/{space_id}"):
        response = await api_client.get(path, headers=COOKIE)
        assert response.status_code == 401, path
        assert response.json() == {"detail": "Invalid session", "code": "invalid_session"}


# currency_locked ------------------------------------------------------------------------------


async def _add_movement(
    session: AsyncSession,
    user_id: uuid.UUID,
    space_id: uuid.UUID,
    *,
    status: str = "confirmed",
    deleted: bool = False,
) -> None:
    account = await make_account(session, space_id)
    await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(account.id, 1000, None)],
        status=status,
        deleted_at=datetime.now(UTC) if deleted else None,
    )


async def test_a_space_without_movements_is_not_locked_in_the_list_and_in_the_detail(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    listed = await api_client.get("/spaces", headers=COOKIE)
    detail = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    assert [s["currency_locked"] for s in listed.json()] == [False]
    assert detail.json()["currency_locked"] is False


async def test_an_account_without_an_initial_balance_does_not_lock_the_currency(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    created = await api_client.post(
        f"/spaces/{space_id}/accounts",
        json={"type": "bank", "name": "Itaú", "initial_balance_minor": 0},
        headers=COOKIE,
    )
    detail = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    assert created.status_code == 201
    assert detail.json()["currency_locked"] is False


async def test_an_account_with_an_initial_balance_locks_the_currency(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    before = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    created = await api_client.post(
        f"/spaces/{space_id}/accounts",
        json={"type": "bank", "name": "Itaú", "initial_balance_minor": 150000},
        headers=COOKIE,
    )
    listed = await api_client.get("/spaces", headers=COOKIE)
    detail = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    assert created.status_code == 201
    assert before.json()["currency_locked"] is False
    assert [s["currency_locked"] for s in listed.json()] == [True]
    assert detail.json()["currency_locked"] is True


@pytest.mark.parametrize(
    ("status", "deleted"),
    [("confirmed", False), ("pending", False), ("skipped", False), ("confirmed", True)],
    ids=["confirmed", "pending", "skipped", "deleted"],
)
async def test_any_movement_locks_the_currency_even_a_pending_or_a_deleted_one(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    status: str,
    deleted: bool,
) -> None:
    user_id, space_id = await _user_with_space(session, "uid-a")
    await _add_movement(session, user_id, space_id, status=status, deleted=deleted)
    _sign_in_as(fake_firebase, "uid-a")

    detail = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    assert detail.json()["currency_locked"] is True


async def test_the_movements_of_another_space_do_not_lock_this_one(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await _user_with_space(session, "uid-a")
    _, space_b = await _user_with_space(session, "uid-b")
    await _add_movement(session, user_a, space_a)
    _sign_in_as(fake_firebase, "uid-b")

    detail = await api_client.get(f"/spaces/{space_b}", headers=COOKIE)

    assert detail.json()["currency_locked"] is False


# PATCH: change the currency -------------------------------------------------------------------


def _patch(client: AsyncClient, space_id: uuid.UUID | str, body: Any) -> Any:
    return client.patch(f"/spaces/{space_id}", json=body, headers=COOKIE)


async def _currency_of(session: AsyncSession, space_id: uuid.UUID) -> str:
    space = await session.get(Space, space_id, populate_existing=True)
    assert space is not None
    return space.currency


def _assert_has_transactions(response: Response) -> None:
    assert response.status_code == 409
    assert response.json() == {
        "detail": "The currency cannot be changed once the space has transactions",
        "code": "space_has_transactions",
    }


async def test_patch_changes_the_currency_of_a_space_without_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": "USD"})

    assert response.status_code == 200
    assert response.json() == {
        "id": str(space_id),
        "name": "Mi espacio",
        "type": "personal",
        "currency": {"code": "USD", "exponent": 2},
        "timezone": "America/Montevideo",
        "currency_locked": False,
    }
    assert await _currency_of(session, space_id) == "USD"
    detail = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)
    assert detail.json()["currency"] == {"code": "USD", "exponent": 2}


async def test_patch_returns_the_exponent_of_the_new_currency(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": "CLP"})

    assert response.status_code == 200
    assert response.json()["currency"] == {"code": "CLP", "exponent": 0}


async def test_patch_can_change_the_currency_more_than_once_while_there_are_no_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    first = await _patch(api_client, space_id, {"currency": "COP"})
    second = await _patch(api_client, space_id, {"currency": "EUR"})

    assert (first.status_code, second.status_code) == (200, 200)
    assert second.json()["currency"] == {"code": "EUR", "exponent": 2}


async def test_patch_works_when_the_space_has_accounts_but_no_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    await make_account(session, space_id)
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": "BRL"})

    assert response.status_code == 200
    assert response.json()["currency"]["code"] == "BRL"


async def test_patch_is_refused_after_an_account_was_created_with_an_initial_balance(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    await api_client.post(
        f"/spaces/{space_id}/accounts",
        json={"type": "bank", "name": "Itaú", "initial_balance_minor": 150000},
        headers=COOKIE,
    )

    response = await _patch(api_client, space_id, {"currency": "USD"})

    _assert_has_transactions(response)
    assert await _currency_of(session, space_id) == "UYU"


@pytest.mark.parametrize(
    ("status", "deleted"),
    [("confirmed", False), ("pending", False), ("skipped", False), ("confirmed", True)],
    ids=["confirmed", "pending", "skipped", "deleted"],
)
async def test_patch_is_refused_when_the_space_has_any_movement_even_a_deleted_one(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    status: str,
    deleted: bool,
) -> None:
    user_id, space_id = await _user_with_space(session, "uid-a")
    await _add_movement(session, user_id, space_id, status=status, deleted=deleted)
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": "USD"})

    _assert_has_transactions(response)
    assert await _currency_of(session, space_id) == "UYU"


async def test_the_movements_of_another_space_do_not_stop_the_change(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await _user_with_space(session, "uid-a")
    _, space_b = await _user_with_space(session, "uid-b")
    await _add_movement(session, user_a, space_a)
    _sign_in_as(fake_firebase, "uid-b")

    response = await _patch(api_client, space_b, {"currency": "USD"})

    assert response.status_code == 200
    assert await _currency_of(session, space_b) == "USD"
    assert await _currency_of(session, space_a) == "UYU"


async def test_patch_with_the_same_currency_changes_nothing_and_is_200(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": "UYU"})

    assert response.status_code == 200
    assert response.json()["currency"] == {"code": "UYU", "exponent": 2}
    assert response.json()["currency_locked"] is False


async def test_patch_with_the_same_currency_is_200_even_when_the_space_has_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await _user_with_space(session, "uid-a")
    await _add_movement(session, user_id, space_id)
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": "UYU"})

    assert response.status_code == 200
    assert response.json()["currency"]["code"] == "UYU"
    assert response.json()["currency_locked"] is True


async def test_an_empty_patch_is_200_and_changes_nothing(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await _user_with_space(session, "uid-a")
    await _add_movement(session, user_id, space_id)
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {})

    assert response.status_code == 200
    assert response.json()["currency"]["code"] == "UYU"
    assert response.json()["currency_locked"] is True


async def test_patch_with_an_unsupported_currency_is_a_422_on_the_field(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": "XXX"})

    assert response.status_code == 422
    assert response.json() == {
        "detail": [
            {
                "type": "currency_unsupported",
                "loc": ["body", "currency"],
                "msg": "Unsupported currency",
            }
        ]
    }
    assert await _currency_of(session, space_id) == "UYU"


async def test_an_unsupported_currency_is_a_422_before_the_409_of_the_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await _user_with_space(session, "uid-a")
    await _add_movement(session, user_id, space_id)
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": "XXX"})

    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "currency_unsupported"


@pytest.mark.parametrize("value", ["usd", "US", "USDD", "", "US1", " USD"])
async def test_patch_with_a_malformed_currency_code_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, value: str
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": value})

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert error["loc"] == ["body", "currency"]
    assert await _currency_of(session, space_id) == "UYU"


@pytest.mark.parametrize("value", [123, True, ["USD"], {"code": "USD"}])
async def test_patch_with_a_currency_that_is_not_a_string_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, value: Any
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": value})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "currency"]


async def test_patch_with_a_null_currency_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": None})

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("null_not_allowed", ["body", "currency"])


@pytest.mark.parametrize("field", ["name", "timezone", "type", "id", "currency_locked"])
async def test_patch_only_accepts_the_currency(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, field: str
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _patch(api_client, space_id, {"currency": "USD", field: "x"})

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("extra_forbidden", ["body", field])
    assert await _currency_of(session, space_id) == "UYU"


async def test_patch_without_a_body_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.patch(f"/spaces/{space_id}", headers=COOKIE)

    assert response.status_code == 422


async def test_user_b_gets_404_when_changing_the_currency_of_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await _user_with_space(session, "uid-a")  # no movements: A could change it
    _, space_b = await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-b")

    foreign = await _patch(api_client, space_a, {"currency": "USD"})
    missing = await _patch(api_client, uuid.uuid4(), {"currency": "USD"})

    assert foreign.status_code == 404
    assert foreign.json() == SPACE_NOT_FOUND
    assert (foreign.status_code, foreign.json()) == (missing.status_code, missing.json())
    assert await _currency_of(session, space_a) == "UYU"
    assert await _currency_of(session, space_b) == "UYU"


async def test_the_404_of_a_foreign_space_comes_before_the_validation_of_the_body(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await _user_with_space(session, "uid-a")
    await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-b")

    response = await _patch(api_client, space_a, {"currency": "XXX", "name": "x"})

    assert response.status_code == 404
    assert response.json() == SPACE_NOT_FOUND


async def test_patch_without_a_session_is_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")

    response = await api_client.patch(f"/spaces/{space_id}", json={"currency": "USD"})

    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"
    assert await _currency_of(session, space_id) == "UYU"
