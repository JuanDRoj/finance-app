"""The movements list, its filters and its totals as flows over HTTP (KAN-85, QA-06).

`test_transactions_list.py` and `test_transactions_balance_change.py` test each parameter of
`GET /spaces/{id}/transactions` and of `.../summary` on its own, and `tests/services` tests the
keyset and the criteria with direct calls. These tests ask the two endpoints the same question the
way the Movimientos screen does and compare them with each other and with the accounts.

Money is always an integer in the minor unit of the currency of the space: UYU `1_550` is 15,50
and CLP `1_500` is 1.500 (exponent 0). The dates are fixed (the filters name their month).

Criterion -> where it is tested
-------------------------------
- Movimientos shows a month, newest first, with what was spent and what came in, and can be
  filtered by Todos, Gastos, Ingresos or Transferencias (HU-12; grouping by day and "the current
  month" are the front's job, the API gives dates and takes a `month`):
  `test_the_list_and_its_summary_agree_for_every_combination_of_filters` (here).
- A long list loads more as you scroll (cursor pagination):
  `test_following_the_cursor_over_a_long_history_gives_each_movement_once_in_order` (here).
- Account, category, search, totals of the period and balance after each movement (BE-19, BE-25):
  `test_the_list_and_its_summary_agree_for_every_combination_of_filters`,
  `test_adjustments_made_by_the_api_are_listed_filtered_and_kept_out_of_income_and_expense`,
  `test_balance_after_walks_the_balance_of_each_account_across_pages`,
  `test_the_search_survives_the_query_string`,
  `test_a_clp_space_lists_and_adds_up_in_whole_pesos` (here).
- An empty month answers 200 with an empty list and zeros (the empty state of the screen):
  the empty cases of the first test above.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from itertools import pairwise
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.fakes import FakeFirebaseAuth
from tests.http_flows import (
    balances,
    build_world,
    dashboard,
    effect_on,
    expense_body,
    get_json,
    income_body,
    list_all,
    list_page,
    movements_summary,
    reconcile,
    register,
    series,
    sign_in_as,
    transfer_body,
)
from tests.months import Months
from tests.transactions_helpers import (
    insert_adjustment,
    insert_expense,
    insert_income,
    insert_transfer,
    make_account,
    make_category,
    make_user_and_space,
)

OCT = "2026-10"


def _oct(day: int) -> date:
    return date(2026, 10, day)


# pagination ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("limit", "sizes"),
    [(None, [50, 50, 20]), (40, [40, 40, 40]), (100, [100, 20])],
    ids=["default_of_fifty", "exact_multiple_of_the_limit", "limit_of_a_hundred"],
)
async def test_following_the_cursor_over_a_long_history_gives_each_movement_once_in_order(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    limit: int | None,
    sizes: list[int],
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-qa-a")
    sign_in_as(fake_firebase, "uid-qa-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    days: dict[str, date] = {}
    for i in range(
        120
    ):  # nine dates for 120 movements: many share a date and the id breaks the tie
        day = date(2026, 8, 1) + timedelta(days=i % 9)
        created = await insert_expense(
            session, space_id, user_id, account.id, category.id, 100 + i, day=day
        )
        days[str(created.id)] = day
    newest_first = [i for i, _ in sorted(days.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)]

    found: list[int] = []
    seen: list[str] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {} if limit is None else {"limit": limit}
        if cursor is not None:
            params["cursor"] = cursor
        page = await list_page(api_client, space_id, **params)
        found.append(len(page["items"]))
        seen += [item["id"] for item in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
        assert len(found) < 10

    # The last page has a null `next_cursor`: a multiple of the limit leaves no empty page.
    assert found == sizes
    assert seen == newest_first
    summary = await movements_summary(api_client, space_id)
    assert summary["count"] == 120  # the "m" of "Mostrando n de m"


# the filters, the list and the summary ---------------------------------------------------------


@dataclass(frozen=True)
class October:
    """A mixed month: every type and status, the first and last day, and the days next to it."""

    space_id: uuid.UUID
    ids: dict[str, str]
    accounts: dict[str, str]
    categories: dict[str, str]


async def _build_october(session: AsyncSession, fake: FakeFirebaseAuth) -> October:
    user_id, space_id = await make_user_and_space(session, "uid-qa-a")
    sign_in_as(fake, "uid-qa-a")
    bank = await make_account(session, space_id, name="Itaú")
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id, name="Comida")
    market = await make_category(session, space_id, name="Supermercado", parent_id=food.id)
    restaurants = await make_category(session, space_id, name="Restaurantes", parent_id=food.id)
    bakery = await make_category(
        session, space_id, name="Panadería", parent_id=food.id, archived=True
    )
    transport = await make_category(session, space_id, name="Transporte")
    salary = await make_category(session, space_id, kind="income", name="Sueldo")
    ids: dict[str, str] = {}

    async def expense(
        name: str, account: Any, category: Any, amount: int, day: date, description: str, **f: Any
    ) -> None:
        ids[name] = str(
            (
                await insert_expense(
                    session,
                    space_id,
                    user_id,
                    account.id,
                    category.id,
                    amount,
                    day=day,
                    description=description,
                    **f,
                )
            ).id
        )

    await expense("m1", bank, market, 1_550, _oct(1), "Café con leche")  # the first day
    await expense("m2", cash, restaurants, 2_300, _oct(5), "Almuerzo")
    await expense("m3", card, transport, 10_000, _oct(10), "Taxi 100%")
    ids["m4"] = str(
        (
            await insert_income(
                session,
                space_id,
                user_id,
                bank.id,
                salary.id,
                90_000,
                day=_oct(15),
                description="Sueldo octubre",
            )
        ).id
    )
    ids["m5"] = str(
        (
            await insert_transfer(
                session,
                space_id,
                user_id,
                bank.id,
                card.id,
                20_000,
                day=_oct(20),
                description="Pago de Visa",
            )
        ).id
    )
    ids["m6"] = str(
        (await insert_adjustment(session, space_id, user_id, bank.id, 500, day=_oct(25))).id
    )
    await expense("m7", bank, bakery, 700, _oct(31), "Pan integral")  # the last day, archived sub
    await expense("m8", bank, food, 3_000, _oct(12), "Café del centro")  # the main category itself
    await expense("pe", bank, market, 9_999, _oct(18), "Café pendiente", status="pending")
    await expense("sk", bank, market, 8_888, _oct(19), "Café saltado", status="skipped")
    await expense("dl", bank, market, 7_777, _oct(21), "Café borrado", deleted_at=datetime.now(UTC))
    await expense("n1", bank, market, 22, date(2026, 11, 1), "Café de noviembre")
    await expense("s1", bank, market, 11, date(2026, 9, 30), "Café de septiembre")
    return October(
        space_id=space_id,
        ids=ids,
        accounts={"bank": str(bank.id), "cash": str(cash.id), "card": str(card.id)},
        categories={
            "food": str(food.id),
            "market": str(market.id),
            "bakery": str(bakery.id),
            "transport": str(transport.id),
        },
    )


# `account` and `category` name one of the October ones; the numbers are written by hand.
# (filters, ids newest first, income, expense, change of the balance of the account)
COMBINATIONS: list[tuple[dict[str, str], list[str], int, int, int | None]] = [
    (
        {},
        ["n1", "m7", "m6", "m5", "sk", "pe", "m4", "m8", "m3", "m2", "m1", "s1"],
        90_000,
        17_583,
        None,
    ),
    (
        {"month": OCT},
        ["m7", "m6", "m5", "sk", "pe", "m4", "m8", "m3", "m2", "m1"],
        90_000,
        17_550,
        None,
    ),
    (
        {"month": OCT, "type": "expense"},
        ["m7", "sk", "pe", "m8", "m3", "m2", "m1"],
        0,
        17_550,
        None,
    ),
    ({"month": OCT, "type": "income"}, ["m4"], 90_000, 0, None),
    ({"month": OCT, "type": "transfer"}, ["m5"], 0, 0, None),
    ({"month": OCT, "type": "adjustment"}, ["m6"], 0, 0, None),
    (
        {"month": OCT, "account": "bank"},
        ["m7", "m6", "m5", "sk", "pe", "m4", "m8", "m1"],
        90_000,
        5_250,
        65_250,
    ),
    (
        {"month": OCT, "account": "card"},
        ["m5", "m3"],
        0,
        10_000,
        10_000,
    ),  # a transfer in + a charge
    ({"month": OCT, "account": "cash"}, ["m2"], 0, 2_300, -2_300),
    (
        {"month": OCT, "category": "food"},  # the main category brings its subcategories
        ["m7", "sk", "pe", "m8", "m2", "m1"],
        0,
        7_550,
        None,
    ),
    ({"month": OCT, "category": "market"}, ["sk", "pe", "m1"], 0, 1_550, None),
    ({"month": OCT, "category": "bakery"}, ["m7"], 0, 700, None),  # an archived subcategory
    ({"month": OCT, "q": "cafe"}, ["sk", "pe", "m8", "m1"], 0, 4_550, None),
    ({"q": "CAFÉ"}, ["n1", "sk", "pe", "m8", "m1", "s1"], 0, 4_583, None),
    (
        # The balance of the account does not follow `type` nor `q`: what they hide still moved it.
        {"month": OCT, "type": "expense", "account": "bank", "q": "CAFE"},
        ["sk", "pe", "m8", "m1"],
        0,
        4_550,
        65_250,
    ),
    ({"month": "2026-08"}, [], 0, 0, None),
    ({"month": OCT, "q": "no existe"}, [], 0, 0, None),
    (
        # The category does not narrow the change of the balance either (the bank still moved).
        {"month": OCT, "category": "transport", "account": "bank"},
        [],
        0,
        0,
        65_250,
    ),
]


@pytest.mark.parametrize(
    ("filters", "expected", "income", "expense", "change"),
    COMBINATIONS,
    ids=[
        "everything",
        "month",
        "expenses",
        "incomes",
        "transfers",
        "adjustments",
        "bank",
        "card",
        "cash",
        "main_category",
        "subcategory",
        "archived_subcategory",
        "search_month",
        "search_accents_and_case",
        "all_filters",
        "month_without_movements",
        "search_without_matches",
        "account_and_category_without_movements",
    ],
)
async def test_the_list_and_its_summary_agree_for_every_combination_of_filters(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    filters: dict[str, str],
    expected: list[str],
    income: int,
    expense: int,
    change: int | None,
) -> None:
    october = await _build_october(session, fake_firebase)
    params = {k: v for k, v in filters.items() if k not in ("account", "category")}
    if "account" in filters:
        params["account_id"] = october.accounts[filters["account"]]
    if "category" in filters:
        params["category_id"] = october.categories[filters["category"]]

    # Small pages on purpose: the list is followed with the cursor.
    items = await list_all(api_client, october.space_id, limit=3, **params)
    summary = await movements_summary(api_client, october.space_id, **params)

    assert [item["id"] for item in items] == [october.ids[name] for name in expected]
    assert summary == {
        "count": len(expected),
        "income_minor": income,
        "expense_minor": expense,
        "remaining_minor": income - expense,
        "balance_change_minor": change,
    }
    # The same figures, derived from what the table shows: confirmed incomes and expenses only.
    confirmed = [item for item in items if item["status"] == "confirmed"]
    assert income == sum(i["amount_minor"] for i in confirmed if i["type"] == "income")
    assert expense == -sum(i["amount_minor"] for i in confirmed if i["type"] == "expense")


async def test_the_status_of_pending_and_skipped_movements_is_shown_and_they_do_not_add_up(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    october = await _build_october(session, fake_firebase)

    items = await list_all(api_client, october.space_id, month=OCT, type="expense")

    by_id = {item["id"]: item for item in items}
    assert by_id[october.ids["pe"]]["status"] == "pending"
    assert by_id[october.ids["sk"]]["status"] == "skipped"
    assert october.ids["dl"] not in by_id  # deleted: not listed
    assert {
        i["status"] for i in items if i["id"] not in (october.ids["pe"], october.ids["sk"])
    } == {"confirmed"}


# the adjustments made by the API ---------------------------------------------------------------


async def test_adjustments_made_by_the_api_are_listed_filtered_and_kept_out_of_income_and_expense(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    world = await build_world(
        api_client, session, fake_firebase, "uid-qa-a", bank_balance=50_000, card_balance=-30_000
    )
    await register(
        api_client, world.space_id, expense_body(world.bank, world.food, 1_000, months.first)
    )
    # The bank has 49.000 now: the real balance is 62.000, so the adjustment is +13.000.
    await reconcile(api_client, world.space_id, world.bank, 62_000)
    await reconcile(api_client, world.space_id, world.cash, 7_000)

    adjustments = await list_all(api_client, world.space_id, type="adjustment", month=months.month)
    in_the_month = await list_all(api_client, world.space_id, month=months.month)

    assert sorted(a["amount_minor"] for a in adjustments) == [-30_000, 7_000, 13_000, 50_000]
    for item in adjustments:
        assert item["type"] == "adjustment"
        assert item["status"] == "confirmed"
        assert item["category"] is None
        assert item["description"] is None
        assert (item["from_account"], item["to_account"]) == (None, None)
        assert item["account"]["id"] in (world.bank, world.cash, world.card)
        assert item["date"].startswith(months.month)
    assert len(in_the_month) == 5  # the four adjustments and the expense
    assert await movements_summary(api_client, world.space_id, month=months.month) == {
        "count": 5,
        "income_minor": 0,
        "expense_minor": 1_000,
        "remaining_minor": -1_000,
        "balance_change_minor": None,
    }
    assert await movements_summary(
        api_client, world.space_id, month=months.month, type="adjustment"
    ) == {
        "count": 4,
        "income_minor": 0,
        "expense_minor": 0,
        "remaining_minor": 0,
        "balance_change_minor": None,
    }
    # The adjustments are balance: the bank moved by its whole balance (50.000 - 1.000 + 13.000).
    on_bank = await movements_summary(
        api_client, world.space_id, month=months.month, account_id=world.bank
    )
    assert (on_bank["count"], on_bank["balance_change_minor"]) == (3, 62_000)
    on_card = await movements_summary(
        api_client, world.space_id, month=months.month, account_id=world.card
    )
    assert (on_card["count"], on_card["balance_change_minor"]) == (1, -30_000)
    assert await balances(api_client, world.space_id) == {
        world.bank: 62_000,
        world.cash: 7_000,
        world.card: -30_000,
    }
    # And the home screen: the adjustments are neither spending nor income, but they are net.
    board = await dashboard(api_client, world.space_id)
    assert board["month_expense_minor"] == 1_000
    last = (await series(api_client, world.space_id, months=1))[0]
    assert (last["income_minor"], last["expense_minor"], last["net_minor"]) == (0, 1_000, 39_000)


# the balance after each movement ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("account", "expected", "balance"),
    [
        (
            "bank",
            [
                ("expense", None),  # the pending one: it does not count for the balance
                ("transfer", 63_000),
                ("transfer", 83_000),
                ("expense", 88_000),
                ("income", 100_000),
            ],
            63_000,
        ),
        ("cash", [("transfer", 5_500), ("expense", 3_500), ("transfer", 5_000)], 5_500),
        ("card", [("transfer", -12_000), ("transfer", -10_000), ("expense", -30_000)], -12_000),
    ],
)
async def test_balance_after_walks_the_balance_of_each_account_across_pages(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    account: str,
    expected: list[tuple[str, int | None]],
    balance: int,
) -> None:
    world = await build_world(api_client, session, fake_firebase, "uid-qa-a")
    sid = world.space_id
    await register(
        api_client, sid, income_body(world.bank, world.salary, 100_000, date(2026, 9, 28))
    )
    await register(api_client, sid, expense_body(world.bank, world.food, 12_000, _oct(2)))
    await register(api_client, sid, expense_body(world.card, world.food, 30_000, _oct(3)))
    await register(api_client, sid, transfer_body(world.bank, world.cash, 5_000, _oct(4)))
    await register(api_client, sid, transfer_body(world.bank, world.card, 20_000, _oct(5)))
    await register(api_client, sid, expense_body(world.cash, world.food, 1_500, _oct(7)))
    await register(api_client, sid, transfer_body(world.card, world.cash, 2_000, _oct(9)))
    await insert_expense(
        session,
        sid,
        world.user_id,
        uuid.UUID(world.bank),
        uuid.UUID(world.food),
        777,
        day=_oct(10),
        status="pending",
    )
    account_id = {"bank": world.bank, "cash": world.cash, "card": world.card}[account]

    items = await list_all(api_client, sid, account_id=account_id, limit=2)

    assert [(i["type"], i["balance_after_minor"]) for i in items] == expected
    assert (await balances(api_client, sid))[account_id] == balance
    # Each step between two neighbours is what the movement did to this account, and the oldest one
    # starts from zero: this is how the screen draws the column "Saldo".
    counted = [i for i in items if i["status"] == "confirmed"]
    for newer, older in pairwise(counted):
        assert newer["balance_after_minor"] - older["balance_after_minor"] == effect_on(
            newer, account_id
        )
    assert counted[-1]["balance_after_minor"] == effect_on(counted[-1], account_id)
    # The balance does not depend on the other filters: October alone shows the same numbers.
    in_october = await list_all(api_client, sid, account_id=account_id, month=OCT, limit=2)
    by_id = {i["id"]: i["balance_after_minor"] for i in items}
    assert in_october
    assert all(by_id[i["id"]] == i["balance_after_minor"] for i in in_october)


# the search through the query string ---------------------------------------------------------


@pytest.mark.parametrize(
    ("q", "expected"),
    [
        ("cafe", {"Café con leche", "CAFÉ DOBLE", "Cafe"}),
        ("CAFÉ", {"Café con leche", "CAFÉ DOBLE", "Cafe"}),
        ("  café  ", {"Café con leche", "CAFÉ DOBLE", "Cafe"}),
        ("LECHE", {"Café con leche"}),
        ("100%", {"100% jugo"}),  # `%` is a character, not a wildcard (it would match "100 jugos")
        ("n_i", {"pan_integral"}),  # `_` is a character (it would match "panXintegral")
        ("\\", {"ruta\\4"}),
        ("a" * 100, set()),  # the longest search is accepted
    ],
    ids=[
        "without_accent",
        "with_accent_and_capitals",
        "trimmed",
        "other_word",
        "percent",
        "underscore",
        "backslash",
        "a_hundred_characters",
    ],
)
async def test_the_search_survives_the_query_string(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    q: str,
    expected: set[str],
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-qa-a")
    sign_in_as(fake_firebase, "uid-qa-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    for description in (
        "Café con leche",
        "CAFÉ DOBLE",
        "Cafe",
        "100% jugo",
        "100 jugos",
        "pan_integral",
        "panXintegral",
        "ruta\\4",
        "Almuerzo",
    ):
        await insert_expense(
            session, space_id, user_id, account.id, category.id, 100, description=description
        )

    items = await list_all(api_client, space_id, q=q)
    summary = await movements_summary(api_client, space_id, q=q)

    assert {item["description"] for item in items} == expected
    assert summary["count"] == len(expected)


async def test_a_search_of_a_hundred_and_one_characters_is_a_422_on_the_search(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-qa-a")
    sign_in_as(fake_firebase, "uid-qa-a")

    for url in (f"/spaces/{space_id}/transactions", f"/spaces/{space_id}/transactions/summary"):
        response = await api_client.get(
            url, params={"q": "a" * 101}, headers={"Cookie": "session=valid-cookie"}
        )

        assert response.status_code == 422, response.text
        assert [(i["type"], i["loc"]) for i in response.json()["detail"]] == [
            ("string_too_long", ["query", "q"])
        ]


# a currency without decimals -----------------------------------------------------------------


async def test_a_clp_space_lists_and_adds_up_in_whole_pesos(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await build_world(api_client, session, fake_firebase, "uid-qa-a", currency="CLP")
    sid = world.space_id
    assert (await get_json(api_client, f"/spaces/{sid}"))["currency"] == {
        "code": "CLP",
        "exponent": 0,
    }
    await register(api_client, sid, income_body(world.bank, world.salary, 150_000, _oct(1)))
    await register(api_client, sid, expense_body(world.card, world.food, 1_500, _oct(3)))
    await register(api_client, sid, transfer_body(world.bank, world.cash, 20_000, _oct(5)))
    await register(api_client, sid, expense_body(world.cash, world.food, 800, _oct(6)))

    on_bank = await list_all(api_client, sid, account_id=world.bank)
    on_cash = await list_all(api_client, sid, account_id=world.cash)
    on_card = await list_all(api_client, sid, account_id=world.card)

    # 150.000 pesos are 150_000, never 15_000_000.
    assert [(i["amount_minor"], i["balance_after_minor"]) for i in on_bank] == [
        (20_000, 130_000),
        (150_000, 150_000),
    ]
    assert [(i["amount_minor"], i["balance_after_minor"]) for i in on_cash] == [
        (-800, 19_200),
        (20_000, 20_000),
    ]
    assert [(i["amount_minor"], i["balance_after_minor"]) for i in on_card] == [(-1_500, -1_500)]
    assert await movements_summary(api_client, sid, month=OCT) == {
        "count": 4,
        "income_minor": 150_000,
        "expense_minor": 2_300,
        "remaining_minor": 147_700,
        "balance_change_minor": None,
    }
    for account_id, change in ((world.bank, 130_000), (world.cash, 19_200), (world.card, -1_500)):
        summary = await movements_summary(api_client, sid, month=OCT, account_id=account_id)
        assert summary["balance_change_minor"] == change
