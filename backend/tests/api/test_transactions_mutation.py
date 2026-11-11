"""`PUT`, `DELETE` and `POST .../restore` of a movement (KAN-80)."""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts.models import Account
from app.modules.transactions.models import Entry, Transaction
from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import (
    insert_adjustment,
    insert_transaction,
    make_account,
    make_category,
    make_user_and_space,
)

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
NOT_AUTHENTICATED = {"detail": "Not authenticated", "code": "not_authenticated"}
TRANSACTION_NOT_FOUND = {"detail": "Transaction not found", "code": "transaction_not_found"}
DAY = "2026-10-20"


def _url(space_id: uuid.UUID, transaction_id: uuid.UUID | str, tail: str = "") -> str:
    return f"/spaces/{space_id}/transactions/{transaction_id}{tail}"


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


async def _put(
    client: AsyncClient, space_id: uuid.UUID, transaction_id: uuid.UUID | str, body: Any
) -> Response:
    return await client.put(_url(space_id, transaction_id), json=body, headers=COOKIE)


async def _delete(
    client: AsyncClient, space_id: uuid.UUID, transaction_id: uuid.UUID | str
) -> Response:
    return await client.delete(_url(space_id, transaction_id), headers=COOKIE)


async def _restore(
    client: AsyncClient, space_id: uuid.UUID, transaction_id: uuid.UUID | str
) -> Response:
    return await client.post(_url(space_id, transaction_id, "/restore"), headers=COOKIE)


async def _post(client: AsyncClient, space_id: uuid.UUID, body: Any) -> uuid.UUID:
    response = await client.post(f"/spaces/{space_id}/transactions", json=body, headers=COOKIE)
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _get_detail(
    client: AsyncClient, space_id: uuid.UUID, transaction_id: uuid.UUID
) -> Response:
    return await client.get(_url(space_id, transaction_id), headers=COOKIE)


async def _balance(client: AsyncClient, space_id: uuid.UUID, account_id: uuid.UUID) -> int:
    response = await client.get(f"/spaces/{space_id}/accounts/{account_id}", headers=COOKIE)
    assert response.status_code == 200, response.text
    balance: int = response.json()["balance_minor"]
    return balance


async def _summary(client: AsyncClient, space_id: uuid.UUID) -> dict[str, int]:
    response = await client.get(f"/spaces/{space_id}/balance-summary", headers=COOKIE)
    assert response.status_code == 200, response.text
    summary: dict[str, int] = response.json()
    return summary


async def _list(client: AsyncClient, space_id: uuid.UUID, **params: str) -> dict[str, Any]:
    response = await client.get(f"/spaces/{space_id}/transactions", params=params, headers=COOKIE)
    assert response.status_code == 200, response.text
    page: dict[str, Any] = response.json()
    return page


async def _totals(client: AsyncClient, space_id: uuid.UUID) -> dict[str, int | None]:
    response = await client.get(f"/spaces/{space_id}/transactions/summary", headers=COOKIE)
    assert response.status_code == 200, response.text
    totals: dict[str, int | None] = response.json()
    return totals


async def _counts(session: AsyncSession) -> tuple[int, int]:
    transactions = await session.scalar(select(func.count()).select_from(Transaction))
    entries = await session.scalar(select(func.count()).select_from(Entry))
    return transactions or 0, entries or 0


async def _deleted_at(session: AsyncSession, transaction_id: uuid.UUID) -> Any:
    stmt = (
        select(Transaction.deleted_at)
        .where(Transaction.id == transaction_id)
        .execution_options(populate_existing=True)
    )
    return await session.scalar(stmt)


def _issues(response: Response) -> list[tuple[str, list[str]]]:
    assert response.status_code == 422, response.text
    return [(issue["type"], issue["loc"]) for issue in response.json()["detail"]]


def _expense(account_id: uuid.UUID | str, category_id: uuid.UUID | str, **fields: Any) -> Any:
    return {
        "type": "expense",
        "date": DAY,
        "account_id": str(account_id),
        "category_id": str(category_id),
        "amount_minor": 1550,
        **fields,
    }


def _income(account_id: uuid.UUID | str, category_id: uuid.UUID | str, **fields: Any) -> Any:
    return {
        "type": "income",
        "date": DAY,
        "account_id": str(account_id),
        "category_id": str(category_id),
        "amount_minor": 90_000,
        **fields,
    }


def _transfer(from_id: uuid.UUID | str, to_id: uuid.UUID | str, **fields: Any) -> Any:
    return {
        "type": "transfer",
        "date": DAY,
        "from_account_id": str(from_id),
        "to_account_id": str(to_id),
        "amount_minor": 3_000,
        **fields,
    }


# edit -------------------------------------------------------------------------------------------


async def test_put_replaces_the_movement_and_answers_with_the_detail(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id, name="Itaú")
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    food = await make_category(session, space_id, name="Comida")
    market = await make_category(session, space_id, name="Mercado")
    transaction_id = await _post(api_client, space_id, _expense(bank.id, food.id))

    response = await _put(
        api_client,
        space_id,
        transaction_id,
        _expense(
            cash.id,
            market.id,
            amount_minor=2_300,
            date="2026-10-22",
            description="  Súper de la esquina ",
        ),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "id": str(transaction_id),
        "type": "expense",
        "status": "confirmed",
        "date": "2026-10-22",
        "description": "Súper de la esquina",
        "amount_minor": -2_300,
        "category": {"id": str(market.id), "name": "Mercado", "icon": "fork-knife", "parent": None},
        "account": {"id": str(cash.id), "name": "Billetera", "type": "cash"},
        "from_account": None,
        "to_account": None,
    }
    assert (await _get_detail(api_client, space_id, transaction_id)).json() == body
    assert await _balance(api_client, space_id, bank.id) == 0
    assert await _balance(api_client, space_id, cash.id) == -2_300
    assert await _counts(session) == (1, 1)


async def test_put_recalculates_every_balance_the_list_and_the_summary(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    visa = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id)
    salary = await make_category(session, space_id, kind="income", name="Sueldo")
    await insert_adjustment(session, space_id, user_id, bank.id, 10_000)
    await _post(api_client, space_id, _income(bank.id, salary.id, date="2026-10-19"))
    target = await _post(api_client, space_id, _expense(visa.id, food.id))
    assert await _summary(api_client, space_id) == {
        "available_minor": 100_000,
        "card_debt_minor": 1_550,
        "net_minor": 98_450,
    }

    response = await _put(
        api_client, space_id, target, _expense(visa.id, food.id, amount_minor=4_000)
    )

    assert response.status_code == 200, response.text
    assert await _balance(api_client, space_id, visa.id) == -4_000
    assert await _summary(api_client, space_id) == {
        "available_minor": 100_000,
        "card_debt_minor": 4_000,
        "net_minor": 96_000,
    }
    assert await _totals(api_client, space_id) == {
        "count": 3,
        "income_minor": 90_000,
        "expense_minor": 4_000,
        "remaining_minor": 86_000,
        "balance_change_minor": None,
    }
    items = (await _list(api_client, space_id, account_id=str(visa.id)))["items"]
    assert [(item["id"], item["balance_after_minor"]) for item in items] == [(str(target), -4_000)]


async def test_put_can_change_the_type(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    food = await make_category(session, space_id)
    transaction_id = await _post(api_client, space_id, _expense(bank.id, food.id))

    as_transfer = await _put(api_client, space_id, transaction_id, _transfer(bank.id, cash.id))

    assert as_transfer.status_code == 200, as_transfer.text
    body = as_transfer.json()
    assert (body["type"], body["amount_minor"], body["category"], body["account"]) == (
        "transfer",
        3_000,
        None,
        None,
    )
    assert (body["from_account"]["id"], body["to_account"]["id"]) == (str(bank.id), str(cash.id))
    assert await _balance(api_client, space_id, bank.id) == -3_000
    assert await _balance(api_client, space_id, cash.id) == 3_000
    assert await _counts(session) == (1, 2)

    back = await _put(api_client, space_id, transaction_id, _expense(bank.id, food.id))

    assert back.status_code == 200, back.text
    assert back.json()["type"] == "expense"
    assert await _balance(api_client, space_id, cash.id) == 0
    assert await _counts(session) == (1, 1)


@pytest.mark.parametrize("omit", [True, False], ids=["omitted", "null"])
async def test_put_without_a_description_clears_the_note(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, omit: bool
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    transaction_id = await _post(
        api_client, space_id, _expense(bank.id, food.id, description="Café")
    )
    body = _expense(bank.id, food.id)
    if not omit:
        body["description"] = None

    response = await _put(api_client, space_id, transaction_id, body)

    assert response.status_code == 200, response.text
    assert response.json()["description"] is None


async def test_put_on_a_movement_with_an_archived_category_keeps_it_if_it_does_not_change(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    transaction_id = await _post(api_client, space_id, _expense(bank.id, food.id))
    archived = await api_client.post(
        f"/spaces/{space_id}/categories/{food.id}/archive", headers=COOKIE
    )
    assert archived.status_code == 200, archived.text

    same_category = await _put(
        api_client, space_id, transaction_id, _expense(bank.id, food.id, description="Solo nota")
    )
    another_archived = await _put(
        api_client,
        space_id,
        transaction_id,
        _expense(bank.id, (await make_category(session, space_id, name="X", archived=True)).id),
    )

    assert same_category.status_code == 200, same_category.text
    assert same_category.json()["category"]["id"] == str(food.id)
    assert _issues(another_archived) == [("category_archived", ["body", "expense", "category_id"])]


@pytest.mark.parametrize(
    ("kind", "field", "expected"),
    [
        ("expense", "account_id", "account_not_found"),
        ("income", "account_id", "account_not_found"),
        ("transfer", "from_account_id", "account_not_found"),
        ("transfer", "to_account_id", "account_not_found"),
        ("expense", "category_id", "category_not_found"),
        ("income", "category_id", "category_not_found"),
    ],
)
async def test_put_with_a_missing_account_or_category_is_a_422_on_its_field(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    kind: str,
    field: str,
    expected: str,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    food = await make_category(session, space_id)
    salary = await make_category(session, space_id, kind="income", name="Sueldo")
    transaction_id = await _post(api_client, space_id, _expense(bank.id, food.id))
    bodies = {
        "expense": _expense(bank.id, food.id),
        "income": _income(bank.id, salary.id),
        "transfer": _transfer(bank.id, cash.id),
    }

    response = await _put(
        api_client, space_id, transaction_id, bodies[kind] | {field: str(uuid.uuid4())}
    )

    assert _issues(response) == [(expected, ["body", kind, field])]
    assert response.json()["detail"][0]["msg"]
    assert await _balance(api_client, space_id, bank.id) == -1_550  # nothing changed


async def test_put_with_a_category_of_the_other_kind_or_an_archived_account_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    old = await make_account(session, space_id, name="Viejo", archived=True)
    food = await make_category(session, space_id)
    transaction_id = await _post(api_client, space_id, _expense(bank.id, food.id))

    wrong_kind = await _put(api_client, space_id, transaction_id, _income(bank.id, food.id))
    archived = await _put(api_client, space_id, transaction_id, _expense(old.id, food.id))

    assert _issues(wrong_kind) == [
        ("transaction_category_kind_mismatch", ["body", "income", "category_id"])
    ]
    assert _issues(archived) == [("account_archived", ["body", "expense", "account_id"])]
    assert await _counts(session) == (1, 1)


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"type": "adjustment", "account_id": "x", "amount_minor": 5}, "union_tag_invalid"),
        ({"amount_minor": 0}, "greater_than"),
        ({"amount_minor": -5}, "greater_than"),
        ({"color": "red"}, "extra_forbidden"),
        ({"date": "2026-10-20T10:00:00"}, "date_invalid"),
    ],
    ids=["adjustment", "zero", "negative", "extra_field", "timestamp"],
)
async def test_put_validates_the_body_like_the_post(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    change: dict[str, Any],
    expected: str,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    transaction_id = await _post(api_client, space_id, _expense(bank.id, food.id))

    response = await _put(api_client, space_id, transaction_id, _expense(bank.id, food.id) | change)

    assert response.status_code == 422, response.text
    assert [issue["type"] for issue in response.json()["detail"]] == [expected]


async def test_put_needs_the_whole_movement_and_two_different_accounts_in_a_transfer(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    transaction_id = await _post(api_client, space_id, _expense(bank.id, food.id))

    partial = await _put(api_client, space_id, transaction_id, {"type": "expense", "date": DAY})
    same_account = await _put(api_client, space_id, transaction_id, _transfer(bank.id, bank.id))

    assert {t for t, _ in _issues(partial)} == {"missing"}
    assert _issues(partial)[0][1][:2] == ["body", "expense"]
    assert _issues(same_account) == [
        ("transfer_same_account", ["body", "transfer", "to_account_id"])
    ]


async def test_a_refused_put_leaves_rows_balances_and_summary_as_they_were(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    transaction_id = await _post(
        api_client, space_id, _expense(bank.id, food.id, description="Café")
    )
    before = (
        (await _get_detail(api_client, space_id, transaction_id)).json(),
        await _summary(api_client, space_id),
    )

    for body in (_expense(uuid.uuid4(), food.id), _expense(bank.id, uuid.uuid4())):
        assert (await _put(api_client, space_id, transaction_id, body)).status_code == 422

    assert (
        (await _get_detail(api_client, space_id, transaction_id)).json(),
        await _summary(api_client, space_id),
    ) == before
    assert await _counts(session) == (1, 1)


async def test_put_on_a_movement_that_cannot_be_edited_is_a_409(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    adjustment = await insert_adjustment(session, space_id, user_id, bank.id, 500)
    pending = await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(bank.id, -100, food.id)],
        type_="expense",
        status="pending",
    )

    for stored in (adjustment, pending):
        response = await _put(api_client, space_id, stored.id, _expense(bank.id, food.id))
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "transaction_not_editable"

    assert await _balance(api_client, space_id, bank.id) == 500


async def test_put_moving_a_movement_out_of_an_archived_account_is_a_409(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    old = await make_account(session, space_id, name="Viejo")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    transaction_id = await _post(api_client, space_id, _expense(old.id, food.id))
    await session.execute(
        update(Account).where(Account.id == old.id).values(archived_at=func.now())
    )

    response = await _put(api_client, space_id, transaction_id, _expense(bank.id, food.id))

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "account_archived"
    assert await _balance(api_client, space_id, bank.id) == 0


async def test_put_on_a_deleted_or_missing_movement_is_a_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    transaction_id = await _post(api_client, space_id, _expense(bank.id, food.id))
    assert (await _delete(api_client, space_id, transaction_id)).status_code == 204

    deleted = await _put(api_client, space_id, transaction_id, _expense(bank.id, food.id))
    missing = await _put(api_client, space_id, uuid.uuid4(), _expense(bank.id, food.id))

    assert (deleted.status_code, deleted.json()) == (404, TRANSACTION_NOT_FOUND)
    assert (missing.status_code, missing.json()) == (404, TRANSACTION_NOT_FOUND)


# delete -----------------------------------------------------------------------------------------


async def test_delete_answers_204_and_the_movement_stops_counting_everywhere(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    salary = await make_category(session, space_id, kind="income", name="Sueldo")
    await _post(api_client, space_id, _income(bank.id, salary.id))
    target = await _post(api_client, space_id, _expense(bank.id, food.id, description="Café"))
    assert await _balance(api_client, space_id, bank.id) == 88_450

    response = await _delete(api_client, space_id, target)

    assert response.status_code == 204
    assert response.content == b""
    assert await _balance(api_client, space_id, bank.id) == 90_000
    assert await _summary(api_client, space_id) == {
        "available_minor": 90_000,
        "card_debt_minor": 0,
        "net_minor": 90_000,
    }
    assert await _totals(api_client, space_id) == {
        "count": 1,
        "income_minor": 90_000,
        "expense_minor": 0,
        "remaining_minor": 90_000,
        "balance_change_minor": None,
    }
    listed = [item["id"] for item in (await _list(api_client, space_id))["items"]]
    assert str(target) not in listed
    by_account = (await _list(api_client, space_id, account_id=str(bank.id)))["items"]
    assert [item["balance_after_minor"] for item in by_account] == [90_000]
    detail = await _get_detail(api_client, space_id, target)
    assert (detail.status_code, detail.json()) == (404, TRANSACTION_NOT_FOUND)
    assert await _deleted_at(session, target) is not None
    assert await _counts(session) == (2, 2)  # a soft delete: nothing is removed


async def test_delete_keeps_the_currency_of_the_space_locked(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    target = await _post(api_client, space_id, _expense(bank.id, food.id))

    await _delete(api_client, space_id, target)

    space = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)
    assert space.json()["currency_locked"] is True


async def test_delete_twice_answers_204_both_times(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    target = await _post(api_client, space_id, _expense(bank.id, food.id))
    assert (await _delete(api_client, space_id, target)).status_code == 204
    first = await _deleted_at(session, target)

    again = await _delete(api_client, space_id, target)

    assert again.status_code == 204
    assert await _deleted_at(session, target) == first


async def test_delete_a_transfer_gives_both_accounts_their_balance_back(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    visa = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id)
    await _post(api_client, space_id, _expense(visa.id, food.id, amount_minor=3_000))
    payment = await _post(api_client, space_id, _transfer(bank.id, visa.id))
    assert await _balance(api_client, space_id, visa.id) == 0

    await _delete(api_client, space_id, payment)

    assert await _balance(api_client, space_id, bank.id) == 0
    assert await _balance(api_client, space_id, visa.id) == -3_000


async def test_delete_of_a_movement_that_cannot_be_deleted_is_a_409(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    adjustment = await insert_adjustment(session, space_id, user_id, bank.id, 500)

    response = await _delete(api_client, space_id, adjustment.id)

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "transaction_not_editable"
    assert await _balance(api_client, space_id, bank.id) == 500


async def test_delete_of_a_movement_of_an_archived_account_is_a_409(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    target = await _post(api_client, space_id, _expense(bank.id, food.id))
    await session.execute(
        update(Account).where(Account.id == bank.id).values(archived_at=func.now())
    )

    response = await _delete(api_client, space_id, target)

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "account_archived"
    assert await _deleted_at(session, target) is None


async def test_delete_of_a_missing_movement_is_a_404_and_a_bad_id_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    missing = await _delete(api_client, space_id, uuid.uuid4())
    not_a_uuid = await _delete(api_client, space_id, "not-a-uuid")

    assert (missing.status_code, missing.json()) == (404, TRANSACTION_NOT_FOUND)
    assert _issues(not_a_uuid) == [("uuid_parsing", ["path", "transaction_id"])]


# restore ----------------------------------------------------------------------------------------


async def test_restore_brings_the_movement_back_identical(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    food = await make_category(session, space_id)
    await _post(api_client, space_id, _expense(bank.id, food.id, date="2026-10-18"))
    target = await _post(api_client, space_id, _transfer(bank.id, cash.id, description="Retiro"))
    await _post(api_client, space_id, _expense(cash.id, food.id, date="2026-10-21"))
    before = {
        "detail": (await _get_detail(api_client, space_id, target)).json(),
        "list": await _list(api_client, space_id),
        "list_bank": await _list(api_client, space_id, account_id=str(bank.id)),
        "totals": await _totals(api_client, space_id),
        "summary": await _summary(api_client, space_id),
        "balances": [await _balance(api_client, space_id, a.id) for a in (bank, cash)],
    }
    assert (await _delete(api_client, space_id, target)).status_code == 204

    response = await _restore(api_client, space_id, target)

    assert response.status_code == 200, response.text
    assert response.json() == before["detail"]
    after = {
        "detail": (await _get_detail(api_client, space_id, target)).json(),
        "list": await _list(api_client, space_id),
        "list_bank": await _list(api_client, space_id, account_id=str(bank.id)),
        "totals": await _totals(api_client, space_id),
        "summary": await _summary(api_client, space_id),
        "balances": [await _balance(api_client, space_id, a.id) for a in (bank, cash)],
    }
    assert after == before
    assert await _deleted_at(session, target) is None


async def test_restore_of_a_movement_that_is_not_deleted_answers_200_without_changes(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    target = await _post(api_client, space_id, _expense(bank.id, food.id))
    detail = (await _get_detail(api_client, space_id, target)).json()

    response = await _restore(api_client, space_id, target)

    assert (response.status_code, response.json()) == (200, detail)
    assert await _balance(api_client, space_id, bank.id) == -1_550


async def test_restore_onto_an_account_archived_meanwhile_is_a_409(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    target = await _post(api_client, space_id, _expense(bank.id, food.id))
    assert (await _delete(api_client, space_id, target)).status_code == 204
    # The balance is 0 now, so the real archive rule lets the account go.
    archived = await api_client.post(
        f"/spaces/{space_id}/accounts/{bank.id}/archive", headers=COOKIE
    )
    assert archived.status_code == 200, archived.text

    refused = await _restore(api_client, space_id, target)

    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "account_archived"
    assert await _deleted_at(session, target) is not None
    unarchived = await api_client.post(
        f"/spaces/{space_id}/accounts/{bank.id}/unarchive", headers=COOKIE
    )
    assert unarchived.status_code == 200, unarchived.text
    assert (await _restore(api_client, space_id, target)).status_code == 200
    assert await _balance(api_client, space_id, bank.id) == -1_550


async def test_restore_of_a_missing_movement_is_a_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _restore(api_client, space_id, uuid.uuid4())

    assert (response.status_code, response.json()) == (404, TRANSACTION_NOT_FOUND)


# the story: edit, delete and undo ---------------------------------------------------------------


async def test_the_story_edit_delete_and_undo_keep_the_numbers_consistent(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Café")
    await insert_adjustment(session, space_id, user_id, bank.id, 10_000)
    target = await _post(api_client, space_id, _expense(bank.id, food.id, amount_minor=500))
    assert await _balance(api_client, space_id, bank.id) == 9_500

    await _put(api_client, space_id, target, _expense(bank.id, food.id, amount_minor=800))
    assert await _balance(api_client, space_id, bank.id) == 9_200

    await _delete(api_client, space_id, target)
    assert await _balance(api_client, space_id, bank.id) == 10_000

    await _restore(api_client, space_id, target)
    assert await _balance(api_client, space_id, bank.id) == 9_200
    assert (await _summary(api_client, space_id))["net_minor"] == 9_200
    assert (await _totals(api_client, space_id))["expense_minor"] == 800


# access -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("operation", ["put", "delete", "restore"])
async def test_without_a_session_the_three_operations_answer_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, operation: str
) -> None:
    url = _url(uuid.uuid4(), uuid.uuid4(), "/restore" if operation == "restore" else "")
    method = {"put": "PUT", "delete": "DELETE", "restore": "POST"}[operation]

    response = await api_client.request(
        method, url, json=_expense(uuid.uuid4(), uuid.uuid4()) if operation == "put" else None
    )

    assert (response.status_code, response.json()) == (401, NOT_AUTHENTICATED)


@pytest.mark.parametrize("operation", ["put", "delete", "restore"])
async def test_user_b_gets_404_on_the_movement_of_user_a_and_nothing_changes(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    operation: str,
) -> None:
    _, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    bank = await make_account(session, space_a, name="Itaú de A")
    food = await make_category(session, space_a)
    mine = await make_account(session, space_b, name="Itaú de B")
    my_food = await make_category(session, space_b)
    _sign_in_as(fake_firebase, "uid-a")
    target = await _post(api_client, space_a, _expense(bank.id, food.id, description="Secreto"))
    await _delete(api_client, space_a, target)  # deleted: restore has something to restore
    deleted_at = await _deleted_at(session, target)
    _sign_in_as(fake_firebase, "uid-b")

    def attempt(space_id: uuid.UUID, transaction_id: uuid.UUID) -> Any:
        if operation == "put":
            return _put(api_client, space_id, transaction_id, _expense(mine.id, my_food.id))
        if operation == "delete":
            return _delete(api_client, space_id, transaction_id)
        return _restore(api_client, space_id, transaction_id)

    in_the_space_of_a = await attempt(space_a, target)
    in_my_space = await attempt(space_b, target)
    missing = await attempt(space_b, uuid.uuid4())

    assert (in_the_space_of_a.status_code, in_the_space_of_a.json()) == (404, SPACE_NOT_FOUND)
    assert (in_my_space.status_code, in_my_space.json()) == (404, TRANSACTION_NOT_FOUND)
    assert (missing.status_code, missing.json()) == (404, TRANSACTION_NOT_FOUND)  # the same body
    for response in (in_the_space_of_a, in_my_space):
        assert "Secreto" not in response.text
        assert "de A" not in response.text
    assert await _deleted_at(session, target) == deleted_at
    _sign_in_as(fake_firebase, "uid-a")
    assert await _balance(api_client, space_a, bank.id) == 0
    _sign_in_as(fake_firebase, "uid-b")
    assert await _balance(api_client, space_b, mine.id) == 0


@pytest.mark.parametrize("operation", ["put", "delete"])
async def test_user_b_cannot_touch_an_active_movement_of_user_a(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    operation: str,
) -> None:
    _, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    bank = await make_account(session, space_a)
    food = await make_category(session, space_a)
    mine = await make_account(session, space_b)
    my_food = await make_category(session, space_b)
    _sign_in_as(fake_firebase, "uid-a")
    target = await _post(api_client, space_a, _expense(bank.id, food.id))
    _sign_in_as(fake_firebase, "uid-b")

    responses = [
        await (
            _put(api_client, space, target, _expense(mine.id, my_food.id, amount_minor=9))
            if operation == "put"
            else _delete(api_client, space, target)
        )
        for space in (space_a, space_b)
    ]

    assert [(r.status_code, r.json()["code"]) for r in responses] == [
        (404, "space_not_found"),
        (404, "transaction_not_found"),
    ]
    _sign_in_as(fake_firebase, "uid-a")
    assert await _balance(api_client, space_a, bank.id) == -1_550
    assert (await _get_detail(api_client, space_a, target)).status_code == 200
