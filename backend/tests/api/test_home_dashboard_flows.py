"""The home screen (dashboard and series) over a history built only through the API (KAN-85, QA-06).

`test_dashboard.py` and `test_dashboard_series.py` test the two endpoints with data written straight
into the database (adjustments included). These tests build the history with the real endpoints
(accounts with an initial balance, categories with subcategories, movements in past months,
reconciliations, edits and deletes) and then ask the home screen and the screens it leads to.

The router takes the clock itself, so the data is dated relative to the current month of the space
with the `months` fixture (`tests/api/conftest.py`). The exact windows, the timezones and the edges
of the months are covered with an injected clock in `tests/services`.

Money is always an integer in the minor unit of the currency of the space: UYU `1_550` is 15,50 and
CLP `1_500` is 1.500 (exponent 0).

Criterion -> where it is tested
-------------------------------
- Top 5 of the month by main category, adding the subcategories to their main one and leaving out
  adjustments, transfers and deleted movements (BE-21):
  `test_the_top_five_adds_subcategories_cuts_at_five_and_matches_ver_todo` and
  `test_renaming_and_archiving_categories_follow_in_the_top_and_in_the_list` (here), and
  `test_dashboard.py`.
- Neto = Disponible - Deuda tarjetas, also when a card is paid in excess:
  `test_net_is_available_minus_card_debt_through_card_flows_including_an_overpayment` (here).
- The series of the home charts (BE-23): `test_the_series_of_a_history_built_only_through_the_api`
  and `test_the_home_screen_of_a_clp_space_is_in_whole_pesos` (here), and
  `test_dashboard_series.py`. After an edit or a delete: `test_movement_edit_flows.py`.
"""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.fakes import FakeFirebaseAuth
from tests.http_flows import (
    COOKIE,
    Json,
    assert_all_views_agree,
    build_world,
    create_account,
    create_category_http,
    dashboard,
    delete,
    expense_body,
    income_body,
    list_all,
    month_name,
    month_start,
    movements_summary,
    reconcile,
    register,
    restore,
    series,
    sign_in_as,
    transfer_body,
)
from tests.months import Months
from tests.transactions_helpers import make_user_and_space


def _rows(board: Json) -> list[tuple[str, int, int]]:
    return [
        (r["name"], r["amount_minor"], r["percentage"]) for r in board["top_expense_categories"]
    ]


# the top five --------------------------------------------------------------------------------


async def test_the_top_five_adds_subcategories_cuts_at_five_and_matches_ver_todo(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    _, sid = await make_user_and_space(session, "uid-qa-a")
    sign_in_as(fake_firebase, "uid-qa-a")
    bank = (
        await create_account(
            api_client, sid, type="bank", name="Itaú", initial_balance_minor=10_000
        )
    )["id"]
    cash = (await create_account(api_client, sid, type="cash", name="Billetera"))["id"]
    # Seven main categories; the money of two of them is only in subcategories (one archived).
    food = await create_category_http(api_client, sid, "Comida")
    market = await create_category_http(api_client, sid, "Supermercado", parent_id=food)
    restaurants = await create_category_http(api_client, sid, "Restaurantes", parent_id=food)
    transport = await create_category_http(api_client, sid, "Transporte")
    home = await create_category_http(api_client, sid, "Hogar")
    rent = await create_category_http(api_client, sid, "Alquiler", parent_id=home)
    clothes = await create_category_http(api_client, sid, "Ropa")
    shoes = await create_category_http(api_client, sid, "Zapatos", parent_id=clothes)
    leisure = await create_category_http(api_client, sid, "Ocio")
    cinema = await create_category_http(api_client, sid, "Cine", parent_id=leisure)
    health = await create_category_http(api_client, sid, "Salud")
    gifts = await create_category_http(api_client, sid, "Regalos")
    salary = await create_category_http(api_client, sid, "Sueldo", kind="income")
    first = months.first

    for category, amount in (
        (food, 100),
        (market, 200),
        (restaurants, 100),
        (rent, 190),
        (transport, 125),
        (shoes, 120),
        (cinema, 65),
        (health, 60),
        (gifts, 40),
    ):  # 1.000 in all
        await register(api_client, sid, expense_body(bank, category, amount, first))
    archived = await api_client.post(f"/spaces/{sid}/categories/{cinema}/archive", headers=COOKIE)
    assert archived.status_code == 200, archived.text
    # What is not spending of the month: an income, a transfer, a reconciliation (a deleted
    # expense, an expense of last month and one of next month).
    await register(api_client, sid, income_body(bank, salary, 5_000, first))
    await register(api_client, sid, transfer_body(bank, cash, 777, first))
    await reconcile(api_client, sid, cash, 3_000)
    gone = await register(api_client, sid, expense_body(bank, food, 999, first))
    assert (await delete(api_client, sid, gone["id"])).status_code == 204
    await register(api_client, sid, expense_body(bank, health, 5_555, months.last_month))
    await register(api_client, sid, expense_body(bank, gifts, 4_444, months.next_month))

    board = await dashboard(api_client, sid)

    assert board["month_expense_minor"] == 1_000  # all of it, also what is not in the top
    # Comida is 100 + 200 + 100; Ocio is only its archived Cine, and it still beats Salud (60);
    # 125 / 1.000 = 12,5 % goes up to 13 and 65 / 1.000 = 6,5 % to 7.
    assert _rows(board) == [
        ("Comida", 400, 40),
        ("Hogar", 190, 19),
        ("Transporte", 125, 13),
        ("Ropa", 120, 12),
        ("Ocio", 65, 7),
    ]
    assert [r["category_id"] for r in board["top_expense_categories"]] == [
        food,
        home,
        transport,
        clothes,
        leisure,
    ]  # the main category, never the subcategory
    assert all(
        type(r["amount_minor"]) is int and type(r["percentage"]) is int
        for r in board["top_expense_categories"]
    )
    # No row "Otros": the front derives it, and here it is what Salud and Regalos add up to.
    assert (
        board["month_expense_minor"]
        - sum(r["amount_minor"] for r in board["top_expense_categories"])
        == 100
    )
    # "Ver todo" of each row leads to a list that adds up to the row, also for the two that did
    # not make it.
    for category, amount in [
        (r["category_id"], r["amount_minor"]) for r in board["top_expense_categories"]
    ] + [(health, 60), (gifts, 40)]:
        by_category = await movements_summary(
            api_client, sid, month=months.month, category_id=category
        )
        assert by_category["expense_minor"] == amount
    behind_hogar = await list_all(api_client, sid, month=months.month, category_id=home)
    assert [(i["category"]["name"], i["category"]["parent"]["name"]) for i in behind_hogar] == [
        ("Alquiler", "Hogar")
    ]
    await assert_all_views_agree(api_client, sid, months)


async def test_renaming_and_archiving_categories_follow_in_the_top_and_in_the_list(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    world = await build_world(api_client, session, fake_firebase, "uid-qa-a")
    sid = world.space_id
    spent = await register(
        api_client, sid, expense_body(world.bank, world.market, 1_000, months.first)
    )
    assert _rows(await dashboard(api_client, sid)) == [("Comida", 1_000, 100)]

    renamed = await api_client.patch(
        f"/spaces/{sid}/categories/{world.food}",
        json={"name": "Alimentación", "icon": "pizza"},
        headers=COOKIE,
    )
    renamed_sub = await api_client.patch(
        f"/spaces/{sid}/categories/{world.market}", json={"name": "Mercado"}, headers=COOKIE
    )

    assert (renamed.status_code, renamed_sub.status_code) == (200, 200)
    board = await dashboard(api_client, sid)
    assert _rows(board) == [("Alimentación", 1_000, 100)]
    assert board["top_expense_categories"][0]["icon"] == "pizza"
    [item] = await list_all(api_client, sid)
    assert item["category"]["name"] == "Mercado"
    assert item["category"]["parent"] == {"id": world.food, "name": "Alimentación", "icon": "pizza"}

    # Archiving the subcategory keeps the money where it was spent.
    archived_sub = await api_client.post(
        f"/spaces/{sid}/categories/{world.market}/archive", headers=COOKIE
    )
    assert archived_sub.status_code == 200, archived_sub.text
    assert _rows(await dashboard(api_client, sid)) == [("Alimentación", 1_000, 100)]
    assert [i["id"] for i in await list_all(api_client, sid, category_id=world.market)] == [
        spent["id"]
    ]

    # Deleted, the main category is archived; undoing the delete does not look at categories.
    assert (await delete(api_client, sid, spent["id"])).status_code == 204
    archived_main = await api_client.post(
        f"/spaces/{sid}/categories/{world.food}/archive", headers=COOKIE
    )
    assert archived_main.status_code == 200, archived_main.text
    assert _rows(await dashboard(api_client, sid)) == []
    assert (await restore(api_client, sid, spent["id"])).status_code == 200
    assert _rows(await dashboard(api_client, sid)) == [("Alimentación", 1_000, 100)]
    [again] = await list_all(api_client, sid)
    assert again["category"]["name"] == "Mercado"
    await assert_all_views_agree(api_client, sid, months)


# net = available - debt ----------------------------------------------------------------------


async def test_net_is_available_minus_card_debt_through_card_flows_including_an_overpayment(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    world = await build_world(api_client, session, fake_firebase, "uid-qa-a")
    sid, first = world.space_id, months.first
    steps: list[tuple[str, Json, tuple[int, int, int]]] = [
        (
            "income of 1.000,00",
            income_body(world.bank, world.salary, 100_000, first),
            (100_000, 0, 100_000),
        ),
        (
            "a card expense of 300,00",
            expense_body(world.card, world.food, 30_000, first),
            (100_000, 30_000, 70_000),
        ),
        (
            "a payment of 200,00",
            transfer_body(world.bank, world.card, 20_000, first),
            (80_000, 10_000, 70_000),
        ),
        # Paid 150,00 too much: the card is in favour, and the debt is negative, not clamped to 0.
        (
            "a payment of 250,00",
            transfer_body(world.bank, world.card, 25_000, first),
            (55_000, -15_000, 70_000),
        ),
        (
            "a card expense of 50,00",
            expense_body(world.card, world.food, 5_000, first),
            (55_000, -10_000, 65_000),
        ),
        (
            "a cash advance of 120,00",
            transfer_body(world.card, world.cash, 12_000, first),
            (67_000, 2_000, 65_000),
        ),
    ]

    for label, body, (available, debt, net) in steps:
        await register(api_client, sid, body)

        views = await assert_all_views_agree(api_client, sid, months)

        board = views.dashboard
        assert (board["available_minor"], board["card_debt_minor"], board["net_minor"]) == (
            available,
            debt,
            net,
        ), label
        assert board["net_minor"] == board["available_minor"] - board["card_debt_minor"], label
        assert views.points[-1]["net_minor"] == net, label


# the series ---------------------------------------------------------------------------------


async def test_the_series_of_a_history_built_only_through_the_api(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    world = await build_world(api_client, session, fake_firebase, "uid-qa-a")
    sid, first = world.space_id, months.first

    def day(back: int) -> str:
        return month_start(first, back).replace(day=10).isoformat()

    # Four months ago the money comes in; three months ago nothing happens; then the card is used.
    await register(api_client, sid, income_body(world.bank, world.salary, 200_000, day(4)))
    await register(api_client, sid, expense_body(world.bank, world.food, 30_000, day(2)))
    await register(api_client, sid, expense_body(world.card, world.food, 10_000, day(2)))
    await register(api_client, sid, income_body(world.bank, world.salary, 50_000, day(1)))
    await register(api_client, sid, transfer_body(world.bank, world.card, 5_000, day(1)))
    # This month: a new account with money (a step of the net), an expense and a reconciliation
    # (the bank has 213.450 and the real balance is 200.000: an adjustment of -13.450).
    await create_account(
        api_client, sid, type="bank", name="Ahorros", initial_balance_minor=100_000
    )
    await register(api_client, sid, expense_body(world.bank, world.food, 1_550, first))
    await reconcile(api_client, sid, world.bank, 200_000)

    def points_of(n: int) -> list[tuple[str, int, int, int]]:
        """What the series must say for the last `n` months, written by hand below."""
        history = [
            (4, 200_000, 0, 200_000),
            (3, 0, 0, 200_000),  # a month without movements keeps the net of the one before
            (2, 0, 40_000, 160_000),
            (1, 50_000, 0, 210_000),
            (0, 0, 1_550, 295_000),  # the new account and the reconciliation are net, not flows
        ]
        known = {back: (income, expense, net) for back, income, expense, net in history}
        return [
            (month_name(month_start(first, back)), *known.get(back, (0, 0, 0)))
            for back in range(n - 1, -1, -1)
        ]

    for count in (1, 3, 6, 12):
        points = await series(api_client, sid, months=count)

        assert [
            (p["month"], p["income_minor"], p["expense_minor"], p["net_minor"]) for p in points
        ] == points_of(count), count
    # Three months of window: the income of four months ago is in the opening net, not in a flow.
    window = await series(api_client, sid, months=3)
    assert [p["net_minor"] for p in window] == [160_000, 210_000, 295_000]
    # Each flow is the summary of its month, and the last net is the net of the other screens.
    for point in await series(api_client, sid, months=12):
        month = await movements_summary(api_client, sid, month=point["month"])
        assert (month["income_minor"], month["expense_minor"]) == (
            point["income_minor"],
            point["expense_minor"],
        ), point["month"]
    views = await assert_all_views_agree(api_client, sid, months)
    assert views.summary["net_minor"] == 295_000
    assert sorted(views.balances.values()) == [-5_000, 0, 100_000, 200_000]


async def test_the_home_screen_of_a_clp_space_is_in_whole_pesos(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    world = await build_world(
        api_client, session, fake_firebase, "uid-qa-a", currency="CLP", bank_balance=1_000_000
    )
    sid, first = world.space_id, months.first
    await register(api_client, sid, expense_body(world.bank, world.food, 12_345, months.last_month))
    await register(api_client, sid, expense_body(world.bank, world.food, 1_500, first))
    await register(api_client, sid, expense_body(world.bank, world.market, 3_500, first))
    await register(api_client, sid, expense_body(world.bank, world.transport, 1_000, first))

    board = await dashboard(api_client, sid)
    last_two = await series(api_client, sid, months=2)

    # 1.000.000 pesos are 1_000_000, never 100_000_000: 1.000.000 - 12.345 - 6.000.
    assert (board["available_minor"], board["card_debt_minor"], board["net_minor"]) == (
        981_655,
        0,
        981_655,
    )
    assert board["month_expense_minor"] == 6_000
    assert _rows(board) == [("Comida", 5_000, 83), ("Transporte", 1_000, 17)]
    # The initial balance is dated today, so last month closes in debt, below zero.
    assert [(p["income_minor"], p["expense_minor"], p["net_minor"]) for p in last_two] == [
        (0, 12_345, -12_345),
        (0, 6_000, 981_655),
    ]
    await assert_all_views_agree(api_client, sid, months)
