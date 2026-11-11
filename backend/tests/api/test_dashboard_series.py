"""`GET /spaces/{id}/dashboard/series` (KAN-90): income, expense and net per month, for the charts.

The router takes the clock itself (`datetime.now(UTC)`), so the data here is dated relative to the
current month of the space (Montevideo). The `months` fixture reads the clock when each test starts,
not when the module is imported. The exact windows, the timezones and the edges of the months are
covered with an injected clock in `tests/services/test_dashboard_series_service.py`.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import (
    insert_adjustment,
    insert_expense,
    insert_income,
    insert_transfer,
    make_account,
    make_category,
    make_user_and_space,
)

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
NOT_AUTHENTICATED = {"detail": "Not authenticated", "code": "not_authenticated"}


@dataclass(frozen=True)
class Months:
    """The current month of the space and its neighbours, read from the clock once per test."""

    first: date  # the first day of the current month: always inside it
    month: str  # `YYYY-MM` of the current month
    last_month: date  # the last day of the previous month
    last_month_name: str
    two_months_ago: date  # a day of the month before the previous one
    two_months_ago_name: str
    next_month: date  # the first day of the next month


@pytest.fixture
def months() -> Months:
    today = datetime.now(UTC).astimezone(ZoneInfo("America/Montevideo")).date()
    first = today.replace(day=1)
    last_month = first - timedelta(days=1)
    two_months_ago = first - timedelta(days=40)
    return Months(
        first=first,
        month=first.strftime("%Y-%m"),
        last_month=last_month,
        last_month_name=last_month.strftime("%Y-%m"),
        two_months_ago=two_months_ago,
        two_months_ago_name=two_months_ago.strftime("%Y-%m"),
        next_month=(first + timedelta(days=32)).replace(day=1),
    )


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


def _url(space_id: uuid.UUID) -> str:
    return f"/spaces/{space_id}/dashboard/series"


async def _get(client: AsyncClient, space_id: uuid.UUID, **params: Any) -> Response:
    return await client.get(_url(space_id), params=params, headers=COOKIE)


async def _series(client: AsyncClient, space_id: uuid.UUID, **params: Any) -> dict[str, Any]:
    response = await _get(client, space_id, **params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _rows(body: dict[str, Any]) -> list[tuple[str, int, int, int]]:
    return [
        (p["month"], p["income_minor"], p["expense_minor"], p["net_minor"]) for p in body["points"]
    ]


def _issues(response: Response) -> list[tuple[str, list[str]]]:
    assert response.status_code == 422, response.text
    return [(issue["type"], issue["loc"]) for issue in response.json()["detail"]]


# the shape --------------------------------------------------------------------------------------


async def test_a_space_without_movements_gets_six_months_of_zeros_ending_in_the_current_one(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    body = await _series(api_client, space_id)

    assert list(body) == ["points"]
    assert len(body["points"]) == 6
    assert body["points"][-1]["month"] == months.month
    assert all(
        p == {"month": p["month"], "income_minor": 0, "expense_minor": 0, "net_minor": 0}
        for p in body["points"]
    )
    assert [p["month"] for p in body["points"]] == sorted({p["month"] for p in body["points"]})


async def test_the_series_of_a_space_with_movements_over_several_months(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    await insert_adjustment(session, space_id, user_id, bank.id, 100_000, day=months.two_months_ago)
    await insert_income(
        session, space_id, user_id, bank.id, salary.id, 20_000, day=months.last_month
    )
    await insert_expense(session, space_id, user_id, card.id, food.id, 5_000, day=months.last_month)
    await insert_expense(session, space_id, user_id, bank.id, food.id, 3_000, day=months.first)
    await insert_transfer(session, space_id, user_id, bank.id, card.id, 500, day=months.first)

    body = await _series(api_client, space_id)

    rows = _rows(body)
    assert [row[1:] for row in rows[:3]] == [(0, 0, 0)] * 3
    assert rows[3:] == [
        (months.two_months_ago_name, 0, 0, 100_000),
        (months.last_month_name, 20_000, 5_000, 115_000),
        (months.month, 0, 3_000, 112_000),
    ]
    assert all(isinstance(value, int) for p in body["points"] for value in list(p.values())[1:])


@pytest.mark.parametrize("count", [1, 6, 12])
async def test_the_months_parameter_sets_the_number_of_points(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    months: Months,
    count: int,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    body = await _series(api_client, space_id, months=count)

    assert len(body["points"]) == count
    assert body["points"][-1]["month"] == months.month


# the figures match the rest of the API ---------------------------------------------------------


async def test_the_last_point_matches_the_dashboard_the_balance_summary_and_the_movements_summary(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    await insert_adjustment(session, space_id, user_id, bank.id, 80_000, day=months.two_months_ago)
    await insert_income(session, space_id, user_id, bank.id, salary.id, 9_000, day=months.first)
    await insert_expense(session, space_id, user_id, card.id, food.id, 12_345, day=months.first)
    await insert_transfer(session, space_id, user_id, bank.id, card.id, 2_000, day=months.first)

    last = (await _series(api_client, space_id))["points"][-1]

    dashboard = (await api_client.get(f"/spaces/{space_id}/dashboard", headers=COOKIE)).json()
    balances = (await api_client.get(f"/spaces/{space_id}/balance-summary", headers=COOKIE)).json()
    summary = (
        await api_client.get(
            f"/spaces/{space_id}/transactions/summary",
            params={"month": months.month},
            headers=COOKIE,
        )
    ).json()
    assert last["month"] == dashboard["month"] == months.month
    assert last["net_minor"] == dashboard["net_minor"] == balances["net_minor"] == 80_000 - 3_345
    assert last["expense_minor"] == dashboard["month_expense_minor"] == summary["expense_minor"]
    assert last["income_minor"] == summary["income_minor"] == 9_000


async def test_the_net_is_negative_when_the_debt_is_larger_than_what_is_available(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    await insert_adjustment(session, space_id, user_id, bank.id, 1_000, day=months.first)
    await insert_adjustment(session, space_id, user_id, card.id, -6_000, day=months.first)

    body = await _series(api_client, space_id, months=1)

    assert _rows(body) == [(months.month, 0, 0, -5_000)]


async def test_an_expense_registered_deleted_and_restored_through_the_api_follows_the_series(
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

    last = (await _series(api_client, space_id))["points"][-1]
    assert (last["expense_minor"], last["net_minor"]) == (1_550, -1_550)

    assert (await api_client.delete(transaction_url, headers=COOKIE)).status_code == 204
    last = (await _series(api_client, space_id))["points"][-1]
    assert (last["expense_minor"], last["net_minor"]) == (0, 0)

    assert (await api_client.post(f"{transaction_url}/restore", headers=COOKIE)).status_code == 200
    last = (await _series(api_client, space_id))["points"][-1]
    assert (last["expense_minor"], last["net_minor"]) == (1_550, -1_550)


async def test_a_movement_of_the_next_month_is_in_no_flow_but_it_is_in_the_net_of_today(
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

    body = await _series(api_client, space_id, months=2)

    last = body["points"][-1]
    assert (last["expense_minor"], last["net_minor"]) == (10, -1_009)
    balances = (await api_client.get(f"/spaces/{space_id}/balance-summary", headers=COOKIE)).json()
    assert last["net_minor"] == balances["net_minor"]


# bad requests -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"months": 0}, ("greater_than_equal", ["query", "months"])),
        ({"months": -1}, ("greater_than_equal", ["query", "months"])),
        ({"months": 13}, ("less_than_equal", ["query", "months"])),
        ({"months": "abc"}, ("int_parsing", ["query", "months"])),
        ({"months": ""}, ("int_parsing", ["query", "months"])),
        ({"month": "2026-11"}, ("extra_forbidden", ["query", "month"])),
        ({"limit": 5}, ("extra_forbidden", ["query", "limit"])),
    ],
)
async def test_bad_parameters_are_a_422_on_the_parameter(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    params: dict[str, Any],
    expected: tuple[str, list[str]],
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    assert _issues(await _get(api_client, space_id, **params)) == [expected]


# access -----------------------------------------------------------------------------------------


async def test_the_series_without_a_session_is_a_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")

    response = await api_client.get(_url(space_id))

    assert (response.status_code, response.json()) == (401, NOT_AUTHENTICATED)
    assert not fake_firebase.called


async def test_user_b_gets_404_on_the_series_of_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a)
    food = await make_category(session, space_a, name="Comida secreta")
    await insert_adjustment(session, space_a, user_a, account.id, 424_242)
    await insert_expense(session, space_a, user_a, account.id, food.id, 31_337, day=months.first)
    _sign_in_as(fake_firebase, "uid-b")

    for params in ({}, {"months": 12}, {"months": 1}):
        response = await _get(api_client, space_a, **params)

        assert (response.status_code, response.json()) == (404, SPACE_NOT_FOUND)
        for leak in ("424242", "31337", "Comida secreta"):
            assert leak not in response.text


async def test_the_series_of_a_space_that_does_not_exist_is_the_same_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _get(api_client, uuid.uuid4())

    assert (response.status_code, response.json()) == (404, SPACE_NOT_FOUND)


async def test_the_series_of_user_b_never_includes_the_movements_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    user_b, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    account_b = await make_account(session, space_b)
    food_a = await make_category(session, space_a, name="Comida")
    food_b = await make_category(session, space_b, name="Comida")
    await insert_adjustment(session, space_a, user_a, account_a.id, 5_000, day=months.first)
    await insert_expense(session, space_a, user_a, account_a.id, food_a.id, 900, day=months.first)
    await insert_expense(session, space_b, user_b, account_b.id, food_b.id, 40, day=months.first)
    _sign_in_as(fake_firebase, "uid-b")

    body = await _series(api_client, space_b, months=1)

    assert _rows(body) == [(months.month, 0, 40, -40)]


async def test_only_get_is_allowed_on_the_series(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    for method in ("POST", "PUT", "PATCH", "DELETE"):
        response = await api_client.request(method, _url(space_id), headers=COOKIE)
        assert response.status_code == 405, method
        assert response.json()["code"] == "method_not_allowed"
