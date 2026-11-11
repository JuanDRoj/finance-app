"""`balance_change_minor` of `GET /spaces/{id}/transactions/summary` (KAN-100): over HTTP.

With `account_id`, the summary says how much the balance of that account moved in the month: the
signed sum of everything that counts for its balance. It is the same rule (and sign) as
`balance_after_minor` of the list, so the two always agree.
"""

import uuid
from datetime import UTC, date, datetime
from typing import Any

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
OCT = "2026-10"


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


async def _summary(client: AsyncClient, space_id: uuid.UUID, **params: Any) -> Response:
    return await client.get(
        f"/spaces/{space_id}/transactions/summary", params=params, headers=COOKIE
    )


async def _change(client: AsyncClient, space_id: uuid.UUID, **params: Any) -> int | None:
    response = await _summary(client, space_id, **params)
    assert response.status_code == 200, response.text
    change: int | None = response.json()["balance_change_minor"]
    return change


async def _listing(client: AsyncClient, space_id: uuid.UUID, **params: Any) -> list[dict[str, Any]]:
    response = await client.get(
        f"/spaces/{space_id}/transactions", params={"limit": 100, **params}, headers=COOKIE
    )
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


def _day(month: int, day: int) -> date:
    return date(2026, month, day)


# the example of the design canvas ---------------------------------------------------------------


async def test_the_net_movement_of_the_canvas_example_is_the_change_of_the_balance(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    """Itaú: salary +68.000, Uber -380, paying the Visa -18.500, UTE -2.150 and Antel -1.620."""
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    itau = await make_account(session, space_id, name="Itaú")
    visa = await make_account(session, space_id, name="Visa", type_="credit_card")
    pay = await make_category(session, space_id, kind="income", name="Sueldo")
    transport = await make_category(session, space_id, name="Transporte")
    bills = await make_category(session, space_id, name="Servicios")
    await insert_income(session, space_id, user_id, itau.id, pay.id, 6_800_000, day=_day(10, 1))
    await insert_expense(session, space_id, user_id, itau.id, transport.id, 38_000, day=_day(10, 3))
    await insert_transfer(
        session,
        space_id,
        user_id,
        itau.id,
        visa.id,
        1_850_000,
        day=_day(10, 5),
        description="Pago de Visa",
    )
    await insert_expense(session, space_id, user_id, itau.id, bills.id, 215_000, day=_day(10, 8))
    await insert_expense(session, space_id, user_id, itau.id, bills.id, 162_000, day=_day(10, 9))

    response = await _summary(api_client, space_id, account_id=str(itau.id), month=OCT)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "count": 5,
        "income_minor": 6_800_000,
        "expense_minor": 415_000,
        # What is left of income minus expense is NOT what the account moved: the transfer counts
        # for the account (+45.350) and not for "te quedan" (+63.850).
        "remaining_minor": 6_385_000,
        "balance_change_minor": 4_535_000,
    }


async def test_a_card_change_is_positive_when_the_debt_goes_down_and_negative_when_it_grows(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    itau = await make_account(session, space_id, name="Itaú")
    visa = await make_account(session, space_id, name="Visa", type_="credit_card")
    food = await make_category(session, space_id)
    await insert_expense(session, space_id, user_id, visa.id, food.id, 300_000, day=_day(10, 2))

    # Only consumption: the debt grew, the change is negative.
    assert await _change(api_client, space_id, account_id=str(visa.id), month=OCT) == -300_000
    # The consumption is also what the summary calls the expense of the card.
    expense = (await _summary(api_client, space_id, account_id=str(visa.id), month=OCT)).json()
    assert expense["expense_minor"] == 300_000

    await insert_transfer(session, space_id, user_id, itau.id, visa.id, 1_850_000, day=_day(10, 5))

    # Paying the card (a transfer in) lowers the debt: 18.500 in, 3.000 of consumption.
    assert await _change(api_client, space_id, account_id=str(visa.id), month=OCT) == 1_550_000
    assert await _change(api_client, space_id, account_id=str(itau.id), month=OCT) == -1_850_000


async def test_transfers_in_both_directions_add_up_on_the_same_account(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id, name="Itaú")
    cash = await make_account(session, space_id, name="Efectivo", type_="cash")
    await insert_transfer(session, space_id, user_id, bank.id, cash.id, 5_000, day=_day(10, 3))
    await insert_transfer(session, space_id, user_id, cash.id, bank.id, 2_000, day=_day(10, 4))
    await insert_transfer(session, space_id, user_id, cash.id, bank.id, 700, day=_day(10, 6))

    assert await _change(api_client, space_id, account_id=str(bank.id), month=OCT) == -5_000 + 2_700
    assert await _change(api_client, space_id, account_id=str(cash.id), month=OCT) == 5_000 - 2_700
    # A transfer is neither income nor expense.
    totals = (await _summary(api_client, space_id, account_id=str(bank.id), month=OCT)).json()
    assert (totals["income_minor"], totals["expense_minor"]) == (0, 0)


async def test_adjustments_count_with_their_sign(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, name="Visa", type_="credit_card")
    await insert_adjustment(session, space_id, user_id, bank.id, 10_000, day=_day(10, 2))
    await insert_adjustment(session, space_id, user_id, bank.id, -2_500, day=_day(10, 3))
    await insert_adjustment(session, space_id, user_id, card.id, -300_000, day=_day(10, 3))

    assert await _change(api_client, space_id, account_id=str(bank.id), month=OCT) == 7_500
    assert await _change(api_client, space_id, account_id=str(card.id), month=OCT) == -300_000
    # An adjustment is neither income nor expense: it moves the balance and nothing else.
    totals = (await _summary(api_client, space_id, account_id=str(bank.id), month=OCT)).json()
    assert (totals["income_minor"], totals["expense_minor"], totals["remaining_minor"]) == (0, 0, 0)


# what counts ------------------------------------------------------------------------------------


async def test_pending_skipped_and_deleted_movements_do_not_count(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, name="Efectivo", type_="cash")
    food = await make_category(session, space_id)
    await insert_adjustment(session, space_id, user_id, bank.id, 1_000, day=_day(10, 1))
    await insert_expense(
        session, space_id, user_id, bank.id, food.id, 10, status="pending", day=_day(10, 2)
    )
    await insert_expense(
        session, space_id, user_id, bank.id, food.id, 20, status="skipped", day=_day(10, 3)
    )
    await insert_transfer(
        session, space_id, user_id, bank.id, cash.id, 40, status="pending", day=_day(10, 4)
    )
    await insert_expense(
        session,
        space_id,
        user_id,
        bank.id,
        food.id,
        80,
        deleted_at=datetime.now(UTC),
        day=_day(10, 5),
    )

    assert await _change(api_client, space_id, account_id=str(bank.id), month=OCT) == 1_000
    assert await _change(api_client, space_id, account_id=str(cash.id), month=OCT) == 0


async def test_deleting_a_movement_removes_it_and_restoring_it_brings_it_back(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, name="Efectivo", type_="cash")
    food = await make_category(session, space_id)
    await insert_adjustment(session, space_id, user_id, bank.id, 10_000, day=_day(10, 1))
    expense = await insert_expense(
        session, space_id, user_id, bank.id, food.id, 1_550, day=_day(10, 2)
    )
    transfer = await insert_transfer(
        session, space_id, user_id, bank.id, cash.id, 3_000, day=_day(10, 3)
    )

    async def changes() -> tuple[int | None, int | None]:
        return (
            await _change(api_client, space_id, account_id=str(bank.id), month=OCT),
            await _change(api_client, space_id, account_id=str(cash.id), month=OCT),
        )

    assert await changes() == (10_000 - 1_550 - 3_000, 3_000)
    base = f"/spaces/{space_id}/transactions"

    deleted = await api_client.delete(f"{base}/{expense.id}", headers=COOKIE)
    assert deleted.status_code == 204
    assert await changes() == (10_000 - 3_000, 3_000)
    deleted = await api_client.delete(f"{base}/{transfer.id}", headers=COOKIE)
    assert deleted.status_code == 204
    assert await changes() == (10_000, 0)

    for restored_id in (expense.id, transfer.id):
        restored = await api_client.post(f"{base}/{restored_id}/restore", headers=COOKIE)
        assert restored.status_code == 200, restored.text
    assert await changes() == (10_000 - 1_550 - 3_000, 3_000)


async def test_an_archived_account_keeps_its_change(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    old = await make_account(session, space_id, name="Vieja", archived=True)
    food = await make_category(session, space_id)
    await insert_adjustment(session, space_id, user_id, old.id, 5_000, day=_day(10, 1))
    await insert_expense(session, space_id, user_id, old.id, food.id, 1_200, day=_day(10, 2))

    assert await _change(api_client, space_id, account_id=str(old.id), month=OCT) == 3_800


# the month --------------------------------------------------------------------------------------


async def test_only_the_dates_of_the_month_count_and_both_edges_are_in(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id)
    for day, amount in (
        (date(2026, 9, 30), 1),  # the day before
        (date(2026, 10, 1), 10),  # first day: in
        (date(2026, 10, 31), 100),  # last day: in
        (date(2026, 11, 1), 1_000),  # the day after
        (date(2026, 11, 30), 10_000),
        (date(2026, 12, 1), 100_000),
        (date(2026, 12, 31), 1_000_000),
        (date(2027, 1, 1), 10_000_000),
    ):
        await insert_expense(session, space_id, user_id, account.id, food.id, amount, day=day)
    owner = str(account.id)

    assert await _change(api_client, space_id, account_id=owner, month=OCT) == -110
    assert await _change(api_client, space_id, account_id=owner, month="2026-11") == -11_000
    # December: its first and last day are in, and the year turning is not a problem.
    assert await _change(api_client, space_id, account_id=owner, month="2026-12") == -1_100_000
    assert await _change(api_client, space_id, account_id=owner, month="2027-01") == -10_000_000
    assert await _change(api_client, space_id, account_id=owner, month="2026-08") == 0


async def test_without_a_month_the_change_is_the_whole_history_which_is_the_balance(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, name="Efectivo", type_="cash")
    food = await make_category(session, space_id)
    await insert_adjustment(session, space_id, user_id, bank.id, 50_000, day=_day(8, 15))
    await insert_expense(session, space_id, user_id, bank.id, food.id, 1_550, day=_day(9, 2))
    await insert_transfer(session, space_id, user_id, bank.id, cash.id, 3_000, day=_day(10, 3))

    response = await api_client.get(f"/spaces/{space_id}/accounts/{bank.id}", headers=COOKIE)
    balance = response.json()["balance_minor"]

    assert balance == 50_000 - 1_550 - 3_000
    assert await _change(api_client, space_id, account_id=str(bank.id)) == balance


# it agrees with the list ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "month",
    ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"],
    ids=["before-it-all", "first-month", "second", "with-transfers", "a-gap", "after-the-gap"],
)
async def test_the_change_is_the_balance_after_of_the_month_minus_the_one_before(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, month: str
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id, name="Itaú", type_="bank")
    other = await make_account(session, space_id, name="Efectivo", type_="cash")
    pay = await make_category(session, space_id, kind="income", name="Sueldo")
    food = await make_category(session, space_id)
    # August is the first month; November has nothing; December has the last movements.
    await insert_adjustment(session, space_id, user_id, account.id, 20_000, day=_day(8, 20))
    await insert_expense(session, space_id, user_id, account.id, food.id, 1_100, day=_day(8, 31))
    await insert_income(session, space_id, user_id, account.id, pay.id, 90_000, day=_day(9, 1))
    await insert_expense(session, space_id, user_id, account.id, food.id, 4_700, day=_day(9, 30))
    await insert_transfer(session, space_id, user_id, account.id, other.id, 3_000, day=_day(10, 1))
    await insert_transfer(session, space_id, user_id, other.id, account.id, 800, day=_day(10, 15))
    await insert_expense(session, space_id, user_id, account.id, food.id, 250, day=_day(10, 15))
    await insert_adjustment(session, space_id, user_id, account.id, -600, day=_day(10, 31))
    # The last movement of October is pending: it has no balance_after and must not count.
    await insert_expense(
        session, space_id, user_id, account.id, food.id, 9_999, status="pending", day=_day(10, 31)
    )
    await insert_income(session, space_id, user_id, account.id, pay.id, 5_000, day=_day(12, 1))
    await insert_expense(session, space_id, user_id, account.id, food.id, 70, day=_day(12, 24))

    items = await _listing(api_client, space_id, account_id=str(account.id))
    counted = [item for item in items if item["balance_after_minor"] is not None]
    first_day = f"{month}-01"
    last_day = f"{month}-31"  # the strings compare as dates; no month has a 32nd
    in_month = [item for item in counted if first_day <= item["date"] <= last_day]
    before = [item for item in counted if item["date"] < first_day]
    # The list is newest first: the first of each group is its last movement.
    closing = in_month[0]["balance_after_minor"] if in_month else None
    opening = before[0]["balance_after_minor"] if before else 0
    expected = 0 if closing is None else closing - opening

    assert await _change(api_client, space_id, account_id=str(account.id), month=month) == expected
    if month == "2026-10":
        assert expected == -3_000 + 800 - 250 - 600  # a guard: the case is the one we think
    if month == "2026-11":
        assert expected == 0


# the other filters ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "extra",
    [
        {"type": "expense"},
        {"type": "income"},
        {"type": "transfer"},
        {"type": "adjustment"},
        {"q": "cafe"},
        {"q": "nothing matches this"},
        {"type": "expense", "q": "cafe"},
    ],
)
async def test_the_type_and_the_search_do_not_change_the_change_of_the_balance(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    extra: dict[str, str],
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, name="Efectivo", type_="cash")
    pay = await make_category(session, space_id, kind="income", name="Sueldo")
    food = await make_category(session, space_id)
    home = await make_category(session, space_id, name="Hogar")
    await insert_income(session, space_id, user_id, bank.id, pay.id, 10_000, day=_day(10, 1))
    await insert_expense(
        session, space_id, user_id, bank.id, food.id, 3_000, description="Café", day=_day(10, 2)
    )
    await insert_expense(session, space_id, user_id, bank.id, home.id, 2_000, day=_day(10, 3))
    await insert_transfer(session, space_id, user_id, bank.id, cash.id, 1_000, day=_day(10, 4))
    await insert_adjustment(session, space_id, user_id, bank.id, 500, day=_day(10, 5))
    params: dict[str, Any] = {"account_id": str(bank.id), "month": OCT, **extra}

    body = (await _summary(api_client, space_id, **params)).json()

    # The whole month moved the balance by this much, whatever the table is showing.
    assert body["balance_change_minor"] == 10_000 - 3_000 - 2_000 - 1_000 + 500
    # ... while the rest of the summary does follow the filter (it matches the table).
    unfiltered = (await _summary(api_client, space_id, account_id=str(bank.id), month=OCT)).json()
    assert (unfiltered["count"], unfiltered["income_minor"], unfiltered["expense_minor"]) == (
        5,
        10_000,
        5_000,
    )
    assert (body["count"], body["income_minor"], body["expense_minor"]) != (5, 10_000, 5_000)


async def test_a_category_filter_does_not_change_the_change_of_the_balance(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id)
    home = await make_category(session, space_id, name="Hogar")
    await insert_expense(session, space_id, user_id, bank.id, food.id, 3_000, day=_day(10, 2))
    await insert_expense(session, space_id, user_id, bank.id, home.id, 2_000, day=_day(10, 3))

    body = (
        await _summary(
            api_client, space_id, account_id=str(bank.id), month=OCT, category_id=str(food.id)
        )
    ).json()

    assert body["balance_change_minor"] == -5_000
    assert body["expense_minor"] == 3_000  # the rest of the summary does follow the category


# without an account -----------------------------------------------------------------------------


@pytest.mark.parametrize("params", [{}, {"month": OCT}, {"type": "expense"}, {"q": "cafe"}])
async def test_without_an_account_the_field_is_there_and_null(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    params: dict[str, str],
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id)
    await insert_expense(session, space_id, user_id, account.id, food.id, 100, description="Café")

    response = await _summary(api_client, space_id, **params)

    assert response.status_code == 200, response.text
    assert "balance_change_minor" in response.json()
    assert response.json()["balance_change_minor"] is None


async def test_a_category_alone_does_not_bring_a_change_either(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id)
    await insert_expense(session, space_id, user_id, account.id, food.id, 100)

    assert await _change(api_client, space_id, category_id=str(food.id), month=OCT) is None


# IDOR -------------------------------------------------------------------------------------------


async def test_another_user_gets_404_asking_for_the_change_of_an_account_of_a_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a)
    food = await make_category(session, space_a)
    await insert_expense(session, space_a, user_a, account.id, food.id, 100)
    _sign_in_as(fake_firebase, "uid-b")

    response = await _summary(api_client, space_a, account_id=str(account.id), month=OCT)

    assert response.status_code == 404
    assert response.json() == SPACE_NOT_FOUND


async def test_an_account_of_another_space_or_unknown_has_no_change_and_looks_the_same(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    theirs = await make_account(session, space_a)
    food = await make_category(session, space_a)
    await insert_expense(session, space_a, user_a, theirs.id, food.id, 100, day=_day(10, 2))
    _sign_in_as(fake_firebase, "uid-b")

    foreign = await _summary(api_client, space_b, account_id=str(theirs.id), month=OCT)
    unknown = await _summary(api_client, space_b, account_id=str(uuid.uuid4()), month=OCT)

    assert foreign.status_code == unknown.status_code == 200
    assert foreign.json() == unknown.json()
    assert foreign.json() == {
        "count": 0,
        "income_minor": 0,
        "expense_minor": 0,
        "remaining_minor": 0,
        "balance_change_minor": 0,
    }
