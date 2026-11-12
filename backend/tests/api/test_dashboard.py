"""`GET /spaces/{id}/dashboard` (KAN-81): Available, card debt, net and the top of the month.

The router takes the clock itself (`datetime.now(UTC)`), so the data here is dated relative to the
current month of the space (Montevideo). The `months` fixture (`tests/api/conftest.py`) reads the
clock when each test starts, not when the module is imported, so the only window in which a change
of month could surprise a test is that test's own few milliseconds. The exact edges of the month
and the timezones are covered with an injected clock in `tests/services/test_dashboard_service.py`.
"""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from tests.fakes import FakeFirebaseAuth, make_identity
from tests.months import Months
from tests.transactions_helpers import (
    insert_adjustment,
    insert_expense,
    insert_income,
    insert_transaction,
    insert_transfer,
    make_account,
    make_category,
    make_user_and_space,
)

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
NOT_AUTHENTICATED = {"detail": "Not authenticated", "code": "not_authenticated"}


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


def _url(space_id: uuid.UUID) -> str:
    return f"/spaces/{space_id}/dashboard"


async def _get(client: AsyncClient, space_id: uuid.UUID) -> Response:
    return await client.get(_url(space_id), headers=COOKIE)


async def _dashboard(client: AsyncClient, space_id: uuid.UUID) -> dict[str, Any]:
    response = await _get(client, space_id)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def _expense_total(
    client: AsyncClient, space_id: uuid.UUID, month: str, **params: Any
) -> int:
    response = await client.get(
        f"/spaces/{space_id}/transactions/summary",
        params={"month": month, **params},
        headers=COOKIE,
    )
    assert response.status_code == 200, response.text
    total: int = response.json()["expense_minor"]
    return total


def _rows(body: dict[str, Any]) -> list[tuple[str, int, int]]:
    return [(r["name"], r["amount_minor"], r["percentage"]) for r in body["top_expense_categories"]]


# the shape --------------------------------------------------------------------------------------


async def test_a_space_without_movements_gets_zeros_an_empty_top_and_the_current_month(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _get(api_client, space_id)

    assert response.status_code == 200
    assert response.json() == {
        "month": months.month,
        "available_minor": 0,
        "card_debt_minor": 0,
        "net_minor": 0,
        "month_expense_minor": 0,
        "top_expense_categories": [],
    }


async def test_the_dashboard_of_a_space_with_movements_over_several_months(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id, name="Comida")
    market = await make_category(session, space_id, name="Supermercado", parent_id=food.id)
    transport = await make_category(session, space_id, name="Transporte")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    await insert_adjustment(session, space_id, user_id, bank.id, 100_000, day=months.two_months_ago)
    await insert_adjustment(session, space_id, user_id, cash.id, 2_500, day=months.two_months_ago)
    await insert_income(
        session, space_id, user_id, bank.id, salary.id, 20_000, day=months.last_month
    )
    await insert_expense(session, space_id, user_id, card.id, food.id, 5_000, day=months.last_month)
    await insert_expense(session, space_id, user_id, bank.id, transport.id, 3_000, day=months.first)
    await insert_expense(session, space_id, user_id, card.id, market.id, 6_000, day=months.first)
    await insert_expense(session, space_id, user_id, cash.id, food.id, 1_000, day=months.first)
    await insert_transfer(session, space_id, user_id, bank.id, card.id, 500, day=months.first)

    body = await _dashboard(api_client, space_id)

    assert body == {
        "month": months.month,
        # bank 100.000 + 20.000 - 3.000 - 500, cash 2.500 - 1.000
        "available_minor": 118_000,
        # card -(5.000 + 6.000) + 500 transfer in
        "card_debt_minor": 10_500,
        "net_minor": 107_500,
        "month_expense_minor": 10_000,
        "top_expense_categories": [
            {
                "category_id": str(food.id),
                "name": "Comida",
                "icon": "fork-knife",
                "amount_minor": 7_000,
                "percentage": 70,
            },
            {
                "category_id": str(transport.id),
                "name": "Transporte",
                "icon": "fork-knife",
                "amount_minor": 3_000,
                "percentage": 30,
            },
        ],
    }


# the figures match the rest of the API ---------------------------------------------------------


async def test_available_debt_and_net_match_the_balance_summary_and_the_sum_of_the_accounts(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id, name="Comida")
    await insert_adjustment(session, space_id, user_id, bank.id, 80_000)
    await insert_expense(session, space_id, user_id, card.id, food.id, 12_345, day=months.first)
    await insert_transfer(session, space_id, user_id, bank.id, card.id, 2_000, day=months.first)

    body = await _dashboard(api_client, space_id)

    summary = (await api_client.get(f"/spaces/{space_id}/balance-summary", headers=COOKIE)).json()
    assert {k: body[k] for k in ("available_minor", "card_debt_minor", "net_minor")} == summary
    accounts = (
        await api_client.get(
            f"/spaces/{space_id}/accounts", params={"include_archived": True}, headers=COOKIE
        )
    ).json()
    in_cash = sum(a["balance_minor"] for a in accounts if a["type"] != "credit_card")
    on_cards = sum(a["balance_minor"] for a in accounts if a["type"] == "credit_card")
    assert body["available_minor"] == in_cash
    assert body["card_debt_minor"] == -on_cards
    assert body["net_minor"] == in_cash + on_cards


async def test_the_month_total_and_each_row_match_the_summary_of_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    """`Ver todo` leads to Movimientos: its figures must be the ones the dashboard shows."""
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    market = await make_category(session, space_id, name="Supermercado", parent_id=food.id)
    restaurants = await make_category(session, space_id, name="Restaurantes", parent_id=food.id)
    health = await make_category(session, space_id, name="Salud")
    await insert_expense(session, space_id, user_id, account.id, food.id, 100, day=months.first)
    await insert_expense(session, space_id, user_id, account.id, market.id, 250, day=months.first)
    await insert_expense(
        session, space_id, user_id, account.id, restaurants.id, 75, day=months.first
    )
    await insert_expense(session, space_id, user_id, account.id, health.id, 400, day=months.first)
    await insert_expense(
        session, space_id, user_id, account.id, health.id, 9_999, day=months.last_month
    )

    body = await _dashboard(api_client, space_id)

    assert (
        body["month_expense_minor"]
        == await _expense_total(api_client, space_id, months.month)
        == 825
    )
    assert len(body["top_expense_categories"]) == 2
    for row in body["top_expense_categories"]:
        by_category = await _expense_total(
            api_client, space_id, months.month, category_id=row["category_id"]
        )
        assert row["amount_minor"] == by_category


# what does not count ----------------------------------------------------------------------------


async def test_adjustments_transfers_incomes_pending_skipped_and_deleted_are_not_in_the_top(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    await insert_expense(session, space_id, user_id, bank.id, food.id, 100, day=months.first)
    await insert_adjustment(session, space_id, user_id, bank.id, -9_000, day=months.first)
    await insert_transfer(session, space_id, user_id, bank.id, cash.id, 8_000, day=months.first)
    await insert_income(session, space_id, user_id, bank.id, salary.id, 70_000, day=months.first)
    await insert_expense(
        session, space_id, user_id, bank.id, food.id, 7, day=months.first, status="pending"
    )
    await insert_expense(
        session, space_id, user_id, bank.id, food.id, 70, day=months.first, status="skipped"
    )
    await insert_expense(
        session,
        space_id,
        user_id,
        bank.id,
        food.id,
        700,
        day=months.first,
        deleted_at=datetime.now(UTC),
    )

    body = await _dashboard(api_client, space_id)

    assert body["month_expense_minor"] == 100
    assert _rows(body) == [("Comida", 100, 100)]


async def test_an_expense_registered_deleted_and_restored_through_the_api_follows_the_top(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    created = await api_client.post(
        f"/spaces/{space_id}/transactions",
        json={
            "type": "expense",
            "date": months.first.isoformat(),
            "account_id": str(account.id),
            "category_id": str(food.id),
            "amount_minor": 1_550,
        },
        headers=COOKIE,
    )
    assert created.status_code == 201, created.text
    transaction_url = f"/spaces/{space_id}/transactions/{created.json()['id']}"

    assert _rows(await _dashboard(api_client, space_id)) == [("Comida", 1_550, 100)]

    assert (await api_client.delete(transaction_url, headers=COOKIE)).status_code == 204
    body = await _dashboard(api_client, space_id)
    assert (body["month_expense_minor"], body["top_expense_categories"]) == (0, [])
    assert body["available_minor"] == 0

    restored = await api_client.post(f"{transaction_url}/restore", headers=COOKIE)
    assert restored.status_code == 200, restored.text
    body = await _dashboard(api_client, space_id)
    assert _rows(body) == [("Comida", 1_550, 100)]
    assert body["available_minor"] == -1_550


# access -----------------------------------------------------------------------------------------


async def test_the_dashboard_without_a_session_is_a_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")

    response = await api_client.get(_url(space_id))

    assert (response.status_code, response.json()) == (401, NOT_AUTHENTICATED)
    assert not fake_firebase.called


async def test_user_b_gets_404_on_the_dashboard_of_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a)
    food = await make_category(session, space_a, name="Comida secreta")
    await insert_adjustment(session, space_a, user_a, account.id, 424_242)
    await insert_expense(session, space_a, user_a, account.id, food.id, 31_337, day=months.first)
    _sign_in_as(fake_firebase, "uid-b")

    response = await _get(api_client, space_a)

    assert (response.status_code, response.json()) == (404, SPACE_NOT_FOUND)
    for leak in ("424242", "31337", "Comida secreta"):
        assert leak not in response.text


async def test_the_dashboard_of_a_space_that_does_not_exist_is_the_same_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _get(api_client, uuid.uuid4())

    assert (response.status_code, response.json()) == (404, SPACE_NOT_FOUND)


async def test_the_dashboard_of_user_b_never_includes_the_movements_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    user_b, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    account_b = await make_account(session, space_b)
    food_a = await make_category(session, space_a, name="Comida")
    food_b = await make_category(session, space_b, name="Comida")
    await insert_adjustment(session, space_a, user_a, account_a.id, 5_000)
    await insert_expense(session, space_a, user_a, account_a.id, food_a.id, 900, day=months.first)
    await insert_expense(session, space_b, user_b, account_b.id, food_b.id, 40, day=months.first)
    _sign_in_as(fake_firebase, "uid-b")

    body = await _dashboard(api_client, space_b)

    assert body["month_expense_minor"] == 40
    assert body["available_minor"] == -40
    assert body["top_expense_categories"] == [
        {
            "category_id": str(food_b.id),
            "name": "Comida",
            "icon": "fork-knife",
            "amount_minor": 40,
            "percentage": 100,
        }
    ]


async def test_only_get_is_allowed_on_the_dashboard(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    for method in ("POST", "PUT", "PATCH", "DELETE"):
        response = await api_client.request(method, _url(space_id), headers=COOKIE)
        assert response.status_code == 405, method
        assert response.json()["code"] == "method_not_allowed"


async def test_movements_of_the_next_month_and_of_old_years_do_not_count_in_this_one(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    await insert_expense(session, space_id, user_id, account.id, food.id, 10, day=months.first)
    await insert_expense(
        session, space_id, user_id, account.id, food.id, 999, day=months.next_month
    )
    await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(account.id, -5, food.id)],
        type_="expense",
        day=date(2000, 1, 1),
    )

    body = await _dashboard(api_client, space_id)

    assert body["month_expense_minor"] == 10
