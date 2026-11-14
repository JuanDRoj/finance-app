"""Shared pieces of the flow tests of the movements, the home screen and the IDOR matrix (KAN-85).

The flow tests (`tests/api/test_movement_listing_flows.py`, `test_movement_edit_flows.py`,
`test_home_dashboard_flows.py` and `test_new_routes_idor.py`) chain the real endpoints the way a
person does and then ask every screen the same question. What they share lives here: a signed-in
user with their space (`World`, the accounts go through HTTP, the categories are written directly),
short wrappers over the endpoints, `list_all` (follows the cursor) and `assert_all_views_agree`,
the oracle that says whether the lists, the summaries, the accounts, the dashboard and the series
tell the same story.

Money is always an integer in the minor unit of the currency of the space: UYU `234_050` is
2.340,50 and CLP `1_500` is 1.500 (exponent 0).
"""

import uuid
from dataclasses import dataclass
from datetime import date
from itertools import pairwise
from typing import Any

from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from tests.fakes import FakeFirebaseAuth, make_identity
from tests.months import Months
from tests.transactions_helpers import make_category, make_user_and_space

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
TRANSACTION_NOT_FOUND = {"detail": "Transaction not found", "code": "transaction_not_found"}

Json = dict[str, Any]


def sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


# the dates -----------------------------------------------------------------------------------


def month_start(first: date, back: int) -> date:
    """The first day of the month `back` months before the month of `first` (negative: after)."""
    index = first.year * 12 + (first.month - 1) - back
    return date(index // 12, index % 12 + 1, 1)


def month_name(day: date) -> str:
    """`YYYY-MM`, the way the filters and the dashboard name a month."""
    return day.strftime("%Y-%m")


# the world -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class World:
    """A signed-in user with their space: three accounts and the categories of the examples.

    `market` and `restaurants` are subcategories of `food`; `salary` is the income category.
    """

    uid: str
    user_id: uuid.UUID
    space_id: uuid.UUID
    bank: str
    cash: str
    card: str
    food: str
    market: str
    restaurants: str
    transport: str
    salary: str


async def create_account(client: AsyncClient, space_id: uuid.UUID, **body: Any) -> Json:
    response = await client.post(f"/spaces/{space_id}/accounts", json=body, headers=COOKIE)
    assert response.status_code == 201, response.text
    created: Json = response.json()
    return created


async def build_world(
    client: AsyncClient,
    session: AsyncSession,
    fake: FakeFirebaseAuth,
    uid: str,
    *,
    suffix: str = "",
    currency: str | None = None,
    bank_balance: int = 0,
    cash_balance: int = 0,
    card_balance: int = 0,
) -> World:
    """The user, the space and the categories are written directly; the accounts go through HTTP.

    Leaves `uid` signed in. The balances are the initial balances of the accounts: a nonzero one
    writes an adjustment dated today (a world with all zeros has no transaction at all, so the
    currency can still be chosen: `currency` is set before anything is written). `suffix` makes the
    names of two worlds different, to look for leaks between them.
    """
    user_id, space_id = await make_user_and_space(session, uid)
    sign_in_as(fake, uid)
    if currency is not None:
        chosen = await client.patch(
            f"/spaces/{space_id}", json={"currency": currency}, headers=COOKIE
        )
        assert chosen.status_code == 200, chosen.text
    bank = await create_account(
        client, space_id, type="bank", name=f"Itaú{suffix}", initial_balance_minor=bank_balance
    )
    cash = await create_account(
        client, space_id, type="cash", name=f"Billetera{suffix}", initial_balance_minor=cash_balance
    )
    card = await create_account(
        client,
        space_id,
        type="credit_card",
        name=f"Visa{suffix}",
        closing_day=5,
        due_day=12,
        initial_balance_minor=card_balance,
    )
    food = await make_category(session, space_id, kind="expense", name=f"Comida{suffix}")
    market = await make_category(session, space_id, name=f"Supermercado{suffix}", parent_id=food.id)
    restaurants = await make_category(
        session, space_id, name=f"Restaurantes{suffix}", parent_id=food.id
    )
    transport = await make_category(session, space_id, kind="expense", name=f"Transporte{suffix}")
    salary = await make_category(session, space_id, kind="income", name=f"Sueldo{suffix}")
    return World(
        uid=uid,
        user_id=user_id,
        space_id=space_id,
        bank=bank["id"],
        cash=cash["id"],
        card=card["id"],
        food=str(food.id),
        market=str(market.id),
        restaurants=str(restaurants.id),
        transport=str(transport.id),
        salary=str(salary.id),
    )


# the bodies of a movement -----------------------------------------------------------------------


def _day(day: date | str) -> str:
    return day if isinstance(day, str) else day.isoformat()


def expense_body(
    account_id: str, category_id: str, amount_minor: int, day: date | str, **fields: Any
) -> Json:
    return {
        "type": "expense",
        "date": _day(day),
        "account_id": account_id,
        "category_id": category_id,
        "amount_minor": amount_minor,
        **fields,
    }


def income_body(
    account_id: str, category_id: str, amount_minor: int, day: date | str, **fields: Any
) -> Json:
    return {**expense_body(account_id, category_id, amount_minor, day, **fields), "type": "income"}


def transfer_body(
    from_id: str, to_id: str, amount_minor: int, day: date | str, **fields: Any
) -> Json:
    return {
        "type": "transfer",
        "date": _day(day),
        "from_account_id": from_id,
        "to_account_id": to_id,
        "amount_minor": amount_minor,
        **fields,
    }


# the endpoints -------------------------------------------------------------------------------


async def register(client: AsyncClient, space_id: uuid.UUID, body: Json) -> Json:
    """`POST /spaces/{id}/transactions`; returns the 201."""
    response = await client.post(f"/spaces/{space_id}/transactions", json=body, headers=COOKIE)
    assert response.status_code == 201, response.text
    created: Json = response.json()
    return created


def _transaction_url(space_id: uuid.UUID, transaction_id: uuid.UUID | str, tail: str = "") -> str:
    return f"/spaces/{space_id}/transactions/{transaction_id}{tail}"


async def put(
    client: AsyncClient, space_id: uuid.UUID, transaction_id: uuid.UUID | str, body: Json
) -> Response:
    return await client.put(_transaction_url(space_id, transaction_id), json=body, headers=COOKIE)


async def edit(
    client: AsyncClient, space_id: uuid.UUID, transaction_id: uuid.UUID | str, body: Json
) -> Json:
    """A `PUT` that has to work: returns the 200."""
    response = await put(client, space_id, transaction_id, body)
    assert response.status_code == 200, response.text
    edited: Json = response.json()
    return edited


async def delete(
    client: AsyncClient, space_id: uuid.UUID, transaction_id: uuid.UUID | str
) -> Response:
    return await client.delete(_transaction_url(space_id, transaction_id), headers=COOKIE)


async def restore(
    client: AsyncClient, space_id: uuid.UUID, transaction_id: uuid.UUID | str
) -> Response:
    return await client.post(_transaction_url(space_id, transaction_id, "/restore"), headers=COOKIE)


async def detail(
    client: AsyncClient, space_id: uuid.UUID, transaction_id: uuid.UUID | str
) -> Response:
    return await client.get(_transaction_url(space_id, transaction_id), headers=COOKIE)


async def get_json(client: AsyncClient, url: str, **params: Any) -> Any:
    response = await client.get(url, params=params, headers=COOKIE)
    assert response.status_code == 200, f"{url} {params}: {response.text}"
    return response.json()


async def accounts(
    client: AsyncClient, space_id: uuid.UUID, *, include_archived: bool = True
) -> list[Json]:
    found: list[Json] = await get_json(
        client, f"/spaces/{space_id}/accounts", include_archived=str(include_archived).lower()
    )
    return found


async def balances(client: AsyncClient, space_id: uuid.UUID) -> dict[str, int]:
    """`{account id: balance}` of every account of the space, archived ones included."""
    return {a["id"]: a["balance_minor"] for a in await accounts(client, space_id)}


async def reconcile(
    client: AsyncClient, space_id: uuid.UUID, account_id: str, balance_minor: int
) -> Json:
    response = await client.post(
        f"/spaces/{space_id}/accounts/{account_id}/reconcile",
        json={"balance_minor": balance_minor},
        headers=COOKIE,
    )
    assert response.status_code == 200, response.text
    reconciled: Json = response.json()
    return reconciled


async def create_category_http(
    client: AsyncClient,
    space_id: uuid.UUID,
    name: str,
    *,
    kind: str = "expense",
    parent_id: str | None = None,
    icon: str = "fork-knife",
) -> str:
    response = await client.post(
        f"/spaces/{space_id}/categories",
        json={"name": name, "kind": kind, "icon": icon, "parent_id": parent_id},
        headers=COOKIE,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def balance_summary(client: AsyncClient, space_id: uuid.UUID) -> Json:
    summary: Json = await get_json(client, f"/spaces/{space_id}/balance-summary")
    return summary


async def movements_summary(client: AsyncClient, space_id: uuid.UUID, **params: Any) -> Json:
    summary: Json = await get_json(client, f"/spaces/{space_id}/transactions/summary", **params)
    return summary


async def dashboard(client: AsyncClient, space_id: uuid.UUID) -> Json:
    body: Json = await get_json(client, f"/spaces/{space_id}/dashboard")
    return body


async def series(client: AsyncClient, space_id: uuid.UUID, **params: Any) -> list[Json]:
    body: Json = await get_json(client, f"/spaces/{space_id}/dashboard/series", **params)
    points: list[Json] = body["points"]
    return points


async def list_page(client: AsyncClient, space_id: uuid.UUID, **params: Any) -> Json:
    page: Json = await get_json(client, f"/spaces/{space_id}/transactions", **params)
    return page


async def list_all(client: AsyncClient, space_id: uuid.UUID, **params: Any) -> list[Json]:
    """Every item of the list for those filters: the pages are followed with the cursor.

    The size of the page is `limit` (100 by default). Only the first page can be empty.
    """
    query: Json = {"limit": 100, **params}
    items: list[Json] = []
    for _ in range(1_000):
        page = await list_page(client, space_id, **query)
        if items:
            assert page["items"], "a page after the first one cannot be empty"
        items += page["items"]
        if page["next_cursor"] is None:
            return items
        query["cursor"] = page["next_cursor"]
    raise AssertionError("the cursor never ended")


# what a movement does to an account -------------------------------------------------------------


def effect_on(item: Json, account_id: str) -> int:
    """How the movement moved the balance of the account, as the front derives it from the item.

    A transfer has no sign: it comes out of `from_account` and goes into `to_account`.
    """
    if item["type"] == "transfer":
        outgoing = item["from_account"]["id"] == account_id
        amount: int = item["amount_minor"]
        return -amount if outgoing else amount
    effect: int = item["amount_minor"]
    return effect


# the oracle ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Views:
    """What every endpoint said in one round, for the test to compare with its own numbers."""

    balances: dict[str, int]
    summary: Json  # balance-summary
    dashboard: Json
    points: list[Json]  # the last two months of the series
    month: Json  # movements summary of the current month
    last_month: Json  # movements summary of the previous month


async def assert_all_views_agree(client: AsyncClient, space_id: uuid.UUID, months: Months) -> Views:
    """The accounts, both summaries, the list, the dashboard and the series tell the same story.

    Nothing here knows what the test did: each figure is compared with the same figure obtained
    from another endpoint (the accounts are the oracle of the summaries, the summaries of the
    dashboard and the series, the list of the balances). The test checks the numbers it expects
    on top of this.
    """
    found = await accounts(client, space_id)
    in_hand = sum(a["balance_minor"] for a in found if a["type"] != "credit_card")
    on_cards = sum(a["balance_minor"] for a in found if a["type"] == "credit_card")
    summary = await balance_summary(client, space_id)
    assert summary == {
        "available_minor": in_hand,
        "card_debt_minor": -on_cards,
        "net_minor": in_hand + on_cards,
    }
    assert summary["net_minor"] == summary["available_minor"] - summary["card_debt_minor"]

    board = await dashboard(client, space_id)
    assert board["month"] == months.month
    for key in ("available_minor", "card_debt_minor", "net_minor"):
        assert board[key] == summary[key], key

    points = await series(client, space_id, months=2)
    assert [p["month"] for p in points] == [months.last_month_name, months.month]
    month = await movements_summary(client, space_id, month=months.month)
    last_month = await movements_summary(client, space_id, month=months.last_month_name)
    current, previous = points[-1], points[-2]
    assert current["net_minor"] == summary["net_minor"]
    assert (current["income_minor"], current["expense_minor"]) == (
        month["income_minor"],
        month["expense_minor"],
    )
    assert (previous["income_minor"], previous["expense_minor"]) == (
        last_month["income_minor"],
        last_month["expense_minor"],
    )
    assert board["month_expense_minor"] == month["expense_minor"]

    rows = board["top_expense_categories"]
    assert len(rows) <= 5
    assert sum(row["amount_minor"] for row in rows) <= board["month_expense_minor"]
    for row in rows:
        by_category = await movements_summary(
            client, space_id, month=months.month, category_id=row["category_id"]
        )
        assert row["amount_minor"] == by_category["expense_minor"], row["name"]

    for label, expected in (("month", month), ("last month", last_month)):
        name = months.month if label == "month" else months.last_month_name
        listed = await list_all(client, space_id, month=name)
        assert expected["count"] == len(listed), label

    for account in found:
        await _assert_balance_after_chain(client, space_id, account)

    return Views(
        balances={a["id"]: a["balance_minor"] for a in found},
        summary=summary,
        dashboard=board,
        points=points,
        month=month,
        last_month=last_month,
    )


async def _assert_balance_after_chain(
    client: AsyncClient, space_id: uuid.UUID, account: Json
) -> None:
    """The list of an account walks its balance: from 0 up to the balance of the account."""
    items = await list_all(client, space_id, account_id=account["id"])
    counted = [item for item in items if item["status"] == "confirmed"]
    for item in items:
        if item["status"] != "confirmed":
            assert item["balance_after_minor"] is None
    if not counted:
        assert account["balance_minor"] == 0
        return
    assert counted[0]["balance_after_minor"] == account["balance_minor"], account["name"]
    for newer, older in pairwise(counted):
        step = newer["balance_after_minor"] - older["balance_after_minor"]
        assert step == effect_on(newer, account["id"]), (account["name"], newer["id"])
    assert counted[-1]["balance_after_minor"] == effect_on(counted[-1], account["id"])
