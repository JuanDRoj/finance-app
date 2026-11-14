"""Editing, deleting and restoring a movement, seen from every screen (KAN-85, QA-06).

`test_transactions_mutation.py` tests `PUT`, `DELETE` and `POST .../restore` one by one against the
accounts, the list and the summary. These tests chain the real endpoints the way a person does and
ask all the screens afterwards: the accounts, both summaries, the list with its balance column, the
dashboard and the series (`tests/http_flows.py::assert_all_views_agree` is the oracle). The numbers
of each step are written by hand.

Money is always an integer in the minor unit of the currency of the space: UYU `234_050` is
2.340,50 and CLP `1_500` is 1.500 (exponent 0).

Criterion of the story (HU-12) or of the ticket -> where it is tested
---------------------------------------------------------------------
- Editing the amount, the account, the category, the date or the note recalculates the balances:
  `test_every_view_agrees_after_each_step_of_an_edit_delete_undo_session` (every field, and a change
  of type), `test_changing_the_date_moves_the_movement_between_months_everywhere`,
  `test_a_put_repeated_with_the_same_body_changes_nothing_the_second_time`,
  `test_a_put_that_only_changes_the_note_keeps_every_figure_and_the_place_in_the_list` (here).
- Deleting makes the movement stop counting in balances and reports, and undoing brings it back
  identical (the toast "Eliminaste «Café»" with "Deshacer" is the front's; the API answers 204 and
  `POST .../restore`): the same session test (the detail and the list after the restore are the ones
  from before the delete).
- A movement the system made (an initial balance, a reconciliation) or one that is not confirmed
  cannot be edited, deleted nor restored:
  `test_the_three_operations_refuse_what_the_system_made_with_409_and_change_nothing` (here).
- An account or a category of another space in the body of a `PUT` is a 422 identical to a missing
  one: `test_a_foreign_account_or_category_in_a_put_answers_like_a_missing_one` (here).
- A currency without decimals:
  `test_editing_deleting_and_restoring_in_a_clp_space_stay_in_whole_pesos` (here).
- IDOR (user B asks, edits or deletes a movement of the space of A: 404): `test_new_routes_idor.py`
  (all the routes) and `test_transactions_mutation.py`.
"""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.transactions.models import Entry, Transaction
from tests.fakes import FakeFirebaseAuth
from tests.http_flows import (
    Json,
    World,
    assert_all_views_agree,
    balances,
    build_world,
    dashboard,
    delete,
    detail,
    edit,
    expense_body,
    get_json,
    income_body,
    list_all,
    month_start,
    movements_summary,
    put,
    reconcile,
    register,
    restore,
    series,
    sign_in_as,
    transfer_body,
)
from tests.months import Months
from tests.transactions_helpers import insert_adjustment, insert_transaction

TRANSACTION_NOT_EDITABLE = "transaction_not_editable"


async def _check(
    client: AsyncClient,
    world: World,
    months: Months,
    label: str,
    accounts_now: tuple[int, int, int],
    *,
    expense: int,
    income: int,
    top: list[tuple[str, int, int]],
) -> None:
    """The oracle plus the numbers of the step: (bank, cash, card), the month and its top."""
    views = await assert_all_views_agree(client, world.space_id, months)
    bank, cash, card = accounts_now
    assert views.balances == {world.bank: bank, world.cash: cash, world.card: card}, label
    assert views.summary == {
        "available_minor": bank + cash,
        "card_debt_minor": -card,
        "net_minor": bank + cash + card,
    }, label
    assert views.dashboard["month_expense_minor"] == expense, label
    assert views.points[-1]["income_minor"] == income, label
    rows = views.dashboard["top_expense_categories"]
    assert [(r["name"], r["amount_minor"], r["percentage"]) for r in rows] == top, label


# the whole session --------------------------------------------------------------------------


async def test_every_view_agrees_after_each_step_of_an_edit_delete_undo_session(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    world = await build_world(
        api_client,
        session,
        fake_firebase,
        "uid-qa-a",
        bank_balance=1_000_000,  # Itaú: 10.000,00
        cash_balance=5_000,  # Billetera: 50,00
        card_balance=-300_000,  # Visa: owes 3.000,00
    )
    sid = world.space_id
    first, last_month = months.first, months.last_month

    await _check(
        api_client,
        world,
        months,
        "initial balances",
        (1_000_000, 5_000, -300_000),
        expense=0,
        income=0,
        top=[],
    )
    # Four movements of this month and one of the month before.
    t1 = (await register(api_client, sid, expense_body(world.card, world.food, 234_050, first)))[
        "id"
    ]
    await _check(
        api_client,
        world,
        months,
        "expense of 2.340,50 with the Visa",
        (1_000_000, 5_000, -534_050),
        expense=234_050,
        income=0,
        top=[("Comida", 234_050, 100)],
    )
    await register(api_client, sid, income_body(world.bank, world.salary, 90_000, first))
    await register(api_client, sid, transfer_body(world.bank, world.card, 100_000, first))
    t4 = (
        await register(api_client, sid, expense_body(world.cash, world.restaurants, 1_550, first))
    )["id"]
    await register(api_client, sid, expense_body(world.bank, world.transport, 20_000, last_month))
    await _check(
        api_client,
        world,
        months,
        "income, payment of the Visa, lunch in cash and a taxi last month",
        (970_000, 3_450, -434_050),
        expense=235_600,
        income=90_000,
        top=[("Comida", 235_600, 100)],  # the subcategory is added to its main category
    )

    # Edit the amount, the account, the category and the type of the first expense.
    await edit(api_client, sid, t1, expense_body(world.card, world.food, 200_000, first))
    await _check(
        api_client,
        world,
        months,
        "amount 2.340,50 -> 2.000,00",
        (970_000, 3_450, -400_000),
        expense=201_550,
        income=90_000,
        top=[("Comida", 201_550, 100)],
    )
    await edit(api_client, sid, t1, expense_body(world.bank, world.food, 200_000, first))
    await _check(
        api_client,
        world,
        months,
        "account Visa -> Itaú",
        (770_000, 3_450, -200_000),
        expense=201_550,
        income=90_000,
        top=[("Comida", 201_550, 100)],
    )
    await edit(api_client, sid, t1, expense_body(world.bank, world.market, 200_000, first))
    await _check(
        api_client,
        world,
        months,
        "category Comida -> its subcategory Supermercado",
        (770_000, 3_450, -200_000),
        expense=201_550,
        income=90_000,
        top=[("Comida", 201_550, 100)],
    )
    on_market = await movements_summary(
        api_client, sid, month=months.month, category_id=world.market
    )
    assert on_market["expense_minor"] == 200_000
    await edit(api_client, sid, t1, income_body(world.bank, world.salary, 200_000, first))
    await _check(
        api_client,
        world,
        months,
        "type expense -> income",
        (1_170_000, 3_450, -200_000),
        expense=1_550,
        income=290_000,
        top=[("Comida", 1_550, 100)],
    )
    await edit(api_client, sid, t1, transfer_body(world.bank, world.cash, 50_000, first))
    await _check(
        api_client,
        world,
        months,
        "type income -> transfer from Itaú to Billetera",
        (920_000, 53_450, -200_000),
        expense=1_550,
        income=90_000,
        top=[("Comida", 1_550, 100)],
    )

    # Edit the date and the note of the lunch, after a second expense gives the top two rows.
    t11 = (
        await register(api_client, sid, expense_body(world.bank, world.transport, 3_000, first))
    )["id"]
    await _check(
        api_client,
        world,
        months,
        "a taxi of 30,00",
        (917_000, 53_450, -200_000),
        expense=4_550,
        income=90_000,
        top=[("Transporte", 3_000, 66), ("Comida", 1_550, 34)],
    )
    moved = await edit(
        api_client,
        sid,
        t4,
        expense_body(world.cash, world.restaurants, 1_550, last_month, description="Almuerzo"),
    )
    assert (moved["date"], moved["description"]) == (last_month.isoformat(), "Almuerzo")
    await _check(
        api_client,
        world,
        months,
        "the lunch moves to last month with a note",
        (917_000, 53_450, -200_000),
        expense=3_000,
        income=90_000,
        top=[("Transporte", 3_000, 100)],
    )

    # Delete and undo: what comes back is identical to what was there.
    before = {
        "t1": (await detail(api_client, sid, t1)).json(),
        "t11": (await detail(api_client, sid, t11)).json(),
        "list": await list_all(api_client, sid),
        "bank": await list_all(api_client, sid, account_id=world.bank),
        "month": await movements_summary(api_client, sid, month=months.month),
    }
    assert (await delete(api_client, sid, t11)).status_code == 204
    gone = await detail(api_client, sid, t11)
    assert (gone.status_code, gone.json()["code"]) == (404, "transaction_not_found")
    await _check(
        api_client,
        world,
        months,
        "delete the taxi",
        (920_000, 53_450, -200_000),
        expense=0,
        income=90_000,
        top=[],
    )
    assert (await delete(api_client, sid, t1)).status_code == 204
    await _check(
        api_client,
        world,
        months,
        "delete the transfer: it adds up to zero in the net",
        (970_000, 3_450, -200_000),
        expense=0,
        income=90_000,
        top=[],
    )
    back = await restore(api_client, sid, t11)
    assert (back.status_code, back.json()) == (200, before["t11"])
    await _check(
        api_client,
        world,
        months,
        "undo the delete of the taxi",
        (967_000, 3_450, -200_000),
        expense=3_000,
        income=90_000,
        top=[("Transporte", 3_000, 100)],
    )
    back = await restore(api_client, sid, t1)
    assert (back.status_code, back.json()) == (200, before["t1"])
    await _check(
        api_client,
        world,
        months,
        "undo the delete of the transfer",
        (917_000, 53_450, -200_000),
        expense=3_000,
        income=90_000,
        top=[("Transporte", 3_000, 100)],
    )
    assert (await detail(api_client, sid, t1)).json() == before["t1"]
    assert (await detail(api_client, sid, t11)).json() == before["t11"]
    assert await list_all(api_client, sid) == before["list"]
    assert await list_all(api_client, sid, account_id=world.bank) == before["bank"]
    assert await movements_summary(api_client, sid, month=months.month) == before["month"]


# the date ------------------------------------------------------------------------------------


@pytest.mark.parametrize("target", ["last_month", "next_month"])
async def test_changing_the_date_moves_the_movement_between_months_everywhere(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    months: Months,
    target: str,
) -> None:
    world = await build_world(api_client, session, fake_firebase, "uid-qa-a")
    sid = world.space_id
    last_month_20 = month_start(months.first, 1).replace(day=20)
    last_month_10 = month_start(months.first, 1).replace(day=10)
    await register(
        api_client, sid, income_body(world.bank, world.salary, 100_000, months.two_months_ago)
    )
    older = (
        await register(api_client, sid, expense_body(world.bank, world.food, 1_000, last_month_20))
    )["id"]
    moving = (
        await register(api_client, sid, expense_body(world.bank, world.food, 4_000, months.first))
    )["id"]
    points = await series(api_client, sid, months=3)
    assert [(p["income_minor"], p["expense_minor"], p["net_minor"]) for p in points] == [
        (100_000, 0, 100_000),
        (0, 1_000, 99_000),
        (0, 4_000, 95_000),
    ]
    on_bank = await list_all(api_client, sid, account_id=world.bank)
    assert [i["balance_after_minor"] for i in on_bank] == [95_000, 99_000, 100_000]

    new_day = last_month_10 if target == "last_month" else months.next_month
    edited = await edit(
        api_client, sid, moving, expense_body(world.bank, world.food, 4_000, new_day)
    )

    assert edited["date"] == new_day.isoformat()
    await assert_all_views_agree(api_client, sid, months)
    assert await balances(api_client, sid) == {world.bank: 95_000, world.cash: 0, world.card: 0}
    points = await series(api_client, sid, months=3)
    on_bank = await list_all(api_client, sid, account_id=world.bank)
    board = await dashboard(api_client, sid)
    this_month = await movements_summary(api_client, sid, month=months.month)
    assert (board["month_expense_minor"], board["top_expense_categories"]) == (0, [])
    assert board["net_minor"] == 95_000
    assert this_month["count"] == 0
    assert await list_all(api_client, sid, month=months.month) == []
    if target == "last_month":
        # The close of last month falls by 4.000 and the flow of this month goes to last month.
        assert [(p["income_minor"], p["expense_minor"], p["net_minor"]) for p in points] == [
            (100_000, 0, 100_000),
            (0, 5_000, 95_000),
            (0, 0, 95_000),
        ]
        # It happened before the other expense: that one closes at 95.000 and this one at 96.000.
        assert [(i["id"], i["balance_after_minor"]) for i in on_bank] == [
            (older, 95_000),
            (moving, 96_000),
            (on_bank[2]["id"], 100_000),
        ]
        in_last_month = await list_all(api_client, sid, month=months.last_month_name)
        assert [i["id"] for i in in_last_month] == [older, moving]
        last = await movements_summary(api_client, sid, month=months.last_month_name)
        assert (last["count"], last["expense_minor"]) == (2, 5_000)
    else:
        # A movement of next month is in no flow of the window but it is in the net of today.
        assert [(p["income_minor"], p["expense_minor"], p["net_minor"]) for p in points] == [
            (100_000, 0, 100_000),
            (0, 1_000, 99_000),
            (0, 0, 95_000),
        ]
        assert [(i["id"], i["balance_after_minor"]) for i in on_bank][:2] == [
            (moving, 95_000),
            (older, 99_000),
        ]
        in_next_month = await list_all(api_client, sid, month=months.next_month.strftime("%Y-%m"))
        assert [i["id"] for i in in_next_month] == [moving]
        following = await movements_summary(
            api_client, sid, month=months.next_month.strftime("%Y-%m")
        )
        assert (following["count"], following["expense_minor"]) == (1, 4_000)


# a PUT is a replacement ----------------------------------------------------------------------


async def test_a_put_repeated_with_the_same_body_changes_nothing_the_second_time(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    world = await build_world(api_client, session, fake_firebase, "uid-qa-a", bank_balance=100_000)
    sid = world.space_id
    created = await register(
        api_client,
        sid,
        expense_body(world.bank, world.food, 1_550, months.first, description="Café"),
    )
    body = expense_body(
        world.bank, world.food, 2_300, months.first, description="Café con medialuna"
    )

    first = await edit(api_client, sid, created["id"], body)
    after_first = await assert_all_views_agree(api_client, sid, months)
    list_after_first = await list_all(api_client, sid)
    second = await edit(api_client, sid, created["id"], body)
    after_second = await assert_all_views_agree(api_client, sid, months)

    assert second == first
    assert after_second == after_first
    assert await list_all(api_client, sid) == list_after_first
    assert after_second.balances[world.bank] == 100_000 - 2_300
    transactions = await session.scalar(
        select(func.count()).select_from(Transaction).where(Transaction.type == "expense")
    )
    entries = await session.scalar(
        select(func.count())
        .select_from(Entry)
        .where(Entry.transaction_id == uuid.UUID(first["id"]))
    )
    assert (transactions, entries) == (1, 1)  # the entries were made again, not added


async def test_a_put_that_only_changes_the_note_keeps_every_figure_and_the_place_in_the_list(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    world = await build_world(api_client, session, fake_firebase, "uid-qa-a")
    sid = world.space_id
    a = await register(
        api_client, sid, expense_body(world.bank, world.food, 1_550, months.first, description="A")
    )
    b = await register(api_client, sid, expense_body(world.bank, world.food, 700, months.first))
    c = await register(api_client, sid, income_body(world.bank, world.salary, 9_000, months.first))
    before = await assert_all_views_agree(api_client, sid, months)
    order = [i["id"] for i in await list_all(api_client, sid)]
    assert order == [c["id"], b["id"], a["id"]]

    edited = await edit(
        api_client,
        sid,
        a["id"],
        expense_body(world.bank, world.food, 1_550, months.first, description="Almuerzo"),
    )
    cleared = await edit(
        api_client, sid, b["id"], expense_body(world.bank, world.food, 700, months.first)
    )

    assert edited["description"] == "Almuerzo"
    assert cleared["description"] is None
    assert await assert_all_views_agree(api_client, sid, months) == before
    assert [
        i["id"] for i in await list_all(api_client, sid)
    ] == order  # same date: same id, same place
    found = await list_all(api_client, sid, q="almuerzo")
    assert [i["id"] for i in found] == [a["id"]]


# what the system made or is not confirmed ------------------------------------------------------


@pytest.mark.parametrize("operation", ["put", "delete", "restore"])
@pytest.mark.parametrize(
    "kind", ["initial_balance", "reconciliation", "pending", "skipped", "deleted_adjustment"]
)
async def test_the_three_operations_refuse_what_the_system_made_with_409_and_change_nothing(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    months: Months,
    kind: str,
    operation: str,
) -> None:
    world = await build_world(api_client, session, fake_firebase, "uid-qa-a", bank_balance=50_000)
    sid = world.space_id
    await reconcile(api_client, sid, world.cash, 7_000)  # an adjustment made by the cuadre
    bank, food = uuid.UUID(world.bank), uuid.UUID(world.food)
    target: str
    if kind == "initial_balance":
        [initial] = await list_all(api_client, sid, type="adjustment", account_id=world.bank)
        target = initial["id"]
    elif kind == "reconciliation":
        [cuadre] = await list_all(api_client, sid, type="adjustment", account_id=world.cash)
        target = cuadre["id"]
    elif kind == "deleted_adjustment":
        gone = await insert_adjustment(
            session, sid, world.user_id, bank, 300, day=months.first, deleted_at=datetime.now(UTC)
        )
        target = str(gone.id)
    else:
        stored = await insert_transaction(
            session,
            sid,
            world.user_id,
            entries=[(bank, -100, food)],
            type_="expense",
            status=kind,
            day=months.first,
        )
        target = str(stored.id)
    before = await _everything(api_client, session, world, target)

    if operation == "put":
        response = await put(
            api_client, sid, target, expense_body(world.bank, world.food, 1_550, months.first)
        )
    elif operation == "delete":
        response = await delete(api_client, sid, target)
    else:
        response = await restore(api_client, sid, target)

    # A deleted movement does not exist for a PUT (404, as for the GET); everything else that is
    # not an expense, an income or a transfer made by a person is a 409, also when it is deleted.
    if operation == "put" and kind == "deleted_adjustment":
        assert (response.status_code, response.json()["code"]) == (404, "transaction_not_found")
    else:
        assert (response.status_code, response.json()["code"]) == (409, TRANSACTION_NOT_EDITABLE)
    assert await _everything(api_client, session, world, target) == before


async def _everything(
    client: AsyncClient, session: AsyncSession, world: World, transaction_id: str
) -> Json:
    """What a refused operation must not touch: the figures, the list and the rows themselves."""
    row = (
        await session.execute(
            select(Transaction.status, Transaction.deleted_at, Transaction.updated_at)
            .where(Transaction.id == uuid.UUID(transaction_id))
            .execution_options(populate_existing=True)
        )
    ).one()
    entries = (
        await session.execute(
            select(Entry.account_id, Entry.amount_minor)
            .where(Entry.transaction_id == uuid.UUID(transaction_id))
            .order_by(Entry.id)
        )
    ).all()
    return {
        "balances": await balances(client, world.space_id),
        "list": await list_all(client, world.space_id),
        "summary": await get_json(client, f"/spaces/{world.space_id}/transactions/summary"),
        "row": tuple(row),
        "entries": [tuple(e) for e in entries],
    }


# an id of another space in the body ---------------------------------------------------------


def _shape(response: Response) -> list[Json]:
    """The issues of a 422 without the echoed `input` (it is the id the client sent)."""
    assert response.status_code == 422, response.text
    return [{k: v for k, v in i.items() if k != "input"} for i in response.json()["detail"]]


@pytest.mark.parametrize(
    ("kind", "field", "attribute", "expected_type"),
    [
        ("expense", "account_id", "bank", "account_not_found"),
        ("expense", "category_id", "food", "category_not_found"),
        ("income", "account_id", "bank", "account_not_found"),
        ("income", "category_id", "salary", "category_not_found"),
        ("transfer", "from_account_id", "bank", "account_not_found"),
        ("transfer", "to_account_id", "bank", "account_not_found"),
    ],
    ids=[
        "expense_account",
        "expense_category",
        "income_account",
        "income_category",
        "transfer_origin",
        "transfer_destination",
    ],
)
async def test_a_foreign_account_or_category_in_a_put_answers_like_a_missing_one(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    months: Months,
    kind: str,
    field: str,
    attribute: str,
    expected_type: str,
) -> None:
    theirs = await build_world(api_client, session, fake_firebase, "uid-qa-a", suffix=" de A")
    mine = await build_world(api_client, session, fake_firebase, "uid-qa-b")  # signs in as B
    sid = mine.space_id
    created = await register(
        api_client, sid, expense_body(mine.bank, mine.food, 1_550, months.first, description="Mío")
    )
    bodies = {
        "expense": expense_body(mine.bank, mine.food, 2_000, months.first),
        "income": income_body(mine.bank, mine.salary, 2_000, months.first),
        "transfer": transfer_body(mine.bank, mine.cash, 2_000, months.first),
    }
    before = (await detail(api_client, sid, created["id"])).json(), await balances(api_client, sid)

    foreign = await put(
        api_client, sid, created["id"], bodies[kind] | {field: getattr(theirs, attribute)}
    )
    missing = await put(api_client, sid, created["id"], bodies[kind] | {field: str(uuid.uuid4())})

    assert [(i["type"], i["loc"]) for i in _shape(foreign)] == [
        (expected_type, ["body", kind, field])
    ]
    assert _shape(foreign) == _shape(missing)  # a 404 here would tell B that the id exists
    assert "de A" not in foreign.text
    assert (await detail(api_client, sid, created["id"])).json() == before[0]
    assert await balances(api_client, sid) == before[1]
    sign_in_as(fake_firebase, "uid-qa-a")
    assert set((await balances(api_client, theirs.space_id)).values()) == {0}


# a currency without decimals -----------------------------------------------------------------


async def test_editing_deleting_and_restoring_in_a_clp_space_stay_in_whole_pesos(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    world = await build_world(
        api_client, session, fake_firebase, "uid-qa-a", currency="CLP", bank_balance=150_000
    )
    sid = world.space_id
    assert (await get_json(api_client, f"/spaces/{sid}"))["currency"] == {
        "code": "CLP",
        "exponent": 0,
    }
    first = months.first

    t1 = (await register(api_client, sid, expense_body(world.card, world.food, 1_500, first)))["id"]
    await _check(
        api_client,
        world,
        months,
        "expense of 1.500",
        (150_000, 0, -1_500),
        expense=1_500,
        income=0,
        top=[("Comida", 1_500, 100)],
    )
    edited = await edit(api_client, sid, t1, expense_body(world.card, world.food, 2_500, first))
    assert [i["amount_minor"] for i in await list_all(api_client, sid, type="expense")] == [-2_500]
    assert edited["amount_minor"] == -2_500
    await _check(
        api_client,
        world,
        months,
        "edited to 2.500",
        (150_000, 0, -2_500),
        expense=2_500,
        income=0,
        top=[("Comida", 2_500, 100)],
    )
    await register(api_client, sid, expense_body(world.bank, world.transport, 7_500, first))
    await _check(
        api_client,
        world,
        months,
        "a second expense",
        (142_500, 0, -2_500),
        expense=10_000,
        income=0,
        top=[("Transporte", 7_500, 75), ("Comida", 2_500, 25)],
    )
    assert (await delete(api_client, sid, t1)).status_code == 204
    await _check(
        api_client,
        world,
        months,
        "deleted",
        (142_500, 0, 0),
        expense=7_500,
        income=0,
        top=[("Transporte", 7_500, 100)],
    )
    assert (await restore(api_client, sid, t1)).status_code == 200
    await _check(
        api_client,
        world,
        months,
        "restored",
        (142_500, 0, -2_500),
        expense=10_000,
        income=0,
        top=[("Transporte", 7_500, 75), ("Comida", 2_500, 25)],
    )
    last = (await series(api_client, sid, months=1))[0]
    assert (last["income_minor"], last["expense_minor"], last["net_minor"]) == (0, 10_000, 140_000)
    board = await dashboard(api_client, sid)
    assert (board["available_minor"], board["card_debt_minor"], board["net_minor"]) == (
        142_500,
        2_500,
        140_000,
    )
