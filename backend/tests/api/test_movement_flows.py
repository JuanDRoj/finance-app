"""The story "Registrar un movimiento" (KAN-53) as flows through HTTP only (KAN-78, QA-05).

`test_transactions.py` and `test_transactions_idempotency.py` test `POST /spaces/{id}/transactions`
field by field and write most of their data straight into the database. These tests chain the real
endpoints the way a person does (create accounts, register expenses, incomes and transfers, archive
things, read the balances back) and check what the next endpoint says. The only rows written outside
HTTP are the users and the categories.

Money is always an integer in the minor unit of the currency of the space: UYU `234_050` is
2.340,50 and CLP `1_500` is 1.500 (exponent 0).

Criterion of the story or of the ticket -> where it is tested
-------------------------------------------------------------
- Expense of 2.340,50 in Comida with the Visa raises the debt of the Visa:
  `test_the_expense_of_the_story_raises_the_debt_of_the_visa` (here) and
  `test_an_expense_on_a_credit_card_raises_the_debt` (test_transactions.py).
- Transfer of 12.000 from the bank to the Visa: the bank and the debt go down by the same amount,
  it adds up to zero, it has no category and it is not an expense:
  `test_the_transfer_of_the_story_lowers_the_bank_and_the_debt_by_the_same_amount`,
  `test_a_mix_of_the_three_types_keeps_every_balance_and_the_net_consistent` (here) and
  `test_a_transfer_from_a_bank_to_a_credit_card_lowers_the_debt_and_keeps_the_net`,
  `test_create_a_transfer_adds_up_to_zero_and_has_no_category` (test_transactions.py).
- Amount in zero or negative, with decimals, or an expense without a category is a 422:
  `test_an_amount_must_be_a_positive_integer_within_the_safe_limit`,
  `test_an_expense_and_an_income_need_a_category` (test_transactions.py),
  `test_in_a_clp_space_an_amount_with_decimals_is_a_422` and
  `test_every_refused_movement_leaves_balances_rows_and_currency_lock_untouched` (here).
  The API only takes integers in the minor unit: turning "1.500,50" into an amount is the UI's job.
- Category of the other kind, transfer to the same account, archived account or category is a 422:
  `test_the_kind_of_the_category_must_match_the_type`,
  `test_a_transfer_between_the_same_account_is_a_422_on_the_destination`,
  `test_an_archived_account_is_a_422_on_the_account`,
  `test_an_archived_category_is_a_422_on_the_category` (test_transactions.py),
  `test_every_refused_movement_leaves_balances_rows_and_currency_lock_untouched` and
  `test_archiving_and_unarchiving_accounts_and_categories_through_the_api_gates_movements` (here).
- Balances after each type, with a currency without decimals:
  `test_a_clp_space_stores_whole_pesos_for_each_type` (here).
- IDOR: user B in the space of user A is a 404 `space_not_found`:
  `test_user_b_gets_404_when_registering_in_the_space_of_user_a` (here, every type, with and
  without `Idempotency-Key`) and
  `test_user_b_gets_404_when_creating_a_movement_in_the_space_of_user_a` (test_transactions.py).
  An account or a category of another space in the body is a 422 `account_not_found` /
  `category_not_found`, identical to an id that does not exist (the 404 is only for the space of
  the route, see `docs/arquitectura-backend.md` section 6):
  `test_a_foreign_category_or_account_answers_exactly_like_a_missing_one` (here) and
  `test_a_movement_cannot_use_an_account_of_another_space`,
  `test_a_movement_cannot_use_a_category_of_another_space` (test_transactions.py).
- Without a session it is a 401: `test_creating_a_movement_without_a_session_is_a_401`
  (test_transactions.py) and `tests/api/test_routing.py` for every route of a space.
- `Idempotency-Key` (KAN-93) with income and transfer, which test_transactions_idempotency.py does
  not drive through HTTP: `test_a_double_tap_creates_one_movement_and_changes_the_balances_once` and
  `test_the_same_key_with_the_accounts_of_a_transfer_swapped_is_a_409` (here).
- The shape of the 201 for every type:
  `test_the_201_body_has_exactly_the_documented_fields_for_every_type` (here).
- Not tested here, on purpose: the default date "today" in the timezone of the space. The API takes
  `date` as a required field (`test_a_missing_required_field_is_a_422_on_that_field`); the default
  lives in the frontend (`todayInTimezone`, `frontend/src/lib/core/dates.ts`).
"""

import uuid
from collections import Counter
from dataclasses import dataclass
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.transactions.models import Entry, IdempotencyKey, Transaction
from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import make_category, make_user_and_space

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
HEADER = "Idempotency-Key"
KEY = "0199a000-0000-4000-8000-0000000000a1"
DAY = "2026-10-20"


# helpers -------------------------------------------------------------------------------------


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


async def _create_account(client: AsyncClient, space_id: uuid.UUID, **body: Any) -> dict[str, Any]:
    response = await client.post(f"/spaces/{space_id}/accounts", json=body, headers=COOKIE)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def _accounts(
    client: AsyncClient, space_id: uuid.UUID, *, include_archived: bool = False
) -> list[dict[str, Any]]:
    response = await client.get(
        f"/spaces/{space_id}/accounts",
        params={"include_archived": str(include_archived).lower()},
        headers=COOKIE,
    )
    assert response.status_code == 200, response.text
    accounts: list[dict[str, Any]] = response.json()
    return accounts


async def _balances(client: AsyncClient, space_id: uuid.UUID) -> dict[str, int]:
    """`{account id: balance}` of every account of the space, archived ones included."""
    accounts = await _accounts(client, space_id, include_archived=True)
    return {a["id"]: a["balance_minor"] for a in accounts}


async def _summary(client: AsyncClient, space_id: uuid.UUID) -> dict[str, int]:
    response = await client.get(f"/spaces/{space_id}/balance-summary", headers=COOKIE)
    assert response.status_code == 200, response.text
    summary: dict[str, int] = response.json()
    return summary


async def _space(client: AsyncClient, space_id: uuid.UUID) -> dict[str, Any]:
    response = await client.get(f"/spaces/{space_id}", headers=COOKIE)
    assert response.status_code == 200, response.text
    space: dict[str, Any] = response.json()
    return space


async def _post(
    client: AsyncClient, space_id: uuid.UUID, body: dict[str, Any], key: str | None = None
) -> Response:
    headers = dict(COOKIE) if key is None else {**COOKIE, HEADER: key}
    return await client.post(f"/spaces/{space_id}/transactions", json=body, headers=headers)


async def _register(
    client: AsyncClient, space_id: uuid.UUID, body: dict[str, Any], key: str | None = None
) -> dict[str, Any]:
    response = await _post(client, space_id, body, key)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def _issues(response: Response) -> list[tuple[str, list[str]]]:
    """`(type, loc)` of each 422 issue: what the frontend maps to a field of the form."""
    assert response.status_code == 422, response.text
    return [(issue["type"], issue["loc"]) for issue in response.json()["detail"]]


def _shape(response: Response) -> list[dict[str, Any]]:
    """The issues of a 422 without the echoed `input` (it is the id the client sent)."""
    assert response.status_code == 422, response.text
    return [{k: v for k, v in i.items() if k != "input"} for i in response.json()["detail"]]


def _expense(account_id: str, category_id: str, amount_minor: int, **fields: Any) -> dict[str, Any]:
    return {
        "type": "expense",
        "date": DAY,
        "account_id": account_id,
        "category_id": category_id,
        "amount_minor": amount_minor,
        **fields,
    }


def _income(account_id: str, category_id: str, amount_minor: int, **fields: Any) -> dict[str, Any]:
    return {
        "type": "income",
        "date": DAY,
        "account_id": account_id,
        "category_id": category_id,
        "amount_minor": amount_minor,
        **fields,
    }


def _transfer(from_id: str, to_id: str, amount_minor: int, **fields: Any) -> dict[str, Any]:
    return {
        "type": "transfer",
        "date": DAY,
        "from_account_id": from_id,
        "to_account_id": to_id,
        "amount_minor": amount_minor,
        **fields,
    }


async def _count(session: AsyncSession, model: type[Any]) -> int:
    return await session.scalar(select(func.count()).select_from(model)) or 0


async def _written(session: AsyncSession) -> tuple[int, int, int]:
    """Transactions, entries and idempotency keys: what a request may have left behind."""
    return (
        await _count(session, Transaction),
        await _count(session, Entry),
        await _count(session, IdempotencyKey),
    )


async def _count_by_type(session: AsyncSession, space_id: uuid.UUID) -> Counter[str]:
    """How many transactions of each type the space has (any status, deleted ones included)."""
    types = await session.scalars(select(Transaction.type).where(Transaction.space_id == space_id))
    return Counter(types)


@dataclass(frozen=True)
class World:
    """A signed-in user with their space: three accounts and one category of each kind."""

    uid: str
    space_id: uuid.UUID
    bank: str
    cash: str
    card: str
    food: str  # expense category
    salary: str  # income category


async def _build_world(
    client: AsyncClient,
    session: AsyncSession,
    fake: FakeFirebaseAuth,
    uid: str,
    *,
    suffix: str = "",
    bank_balance: int = 0,
    cash_balance: int = 0,
    card_balance: int = 0,
) -> World:
    """The user, the space and the categories are written directly; the accounts go through HTTP.

    Leaves `uid` signed in. The balances are the initial balances of the accounts (0 writes
    nothing, so a world with all zeros has no transaction at all). `suffix` makes the names of two
    worlds different, to look for leaks between them.
    """
    _, space_id = await make_user_and_space(session, uid)
    _sign_in_as(fake, uid)
    bank = await _create_account(
        client, space_id, type="bank", name=f"Itaú{suffix}", initial_balance_minor=bank_balance
    )
    cash = await _create_account(
        client, space_id, type="cash", name=f"Billetera{suffix}", initial_balance_minor=cash_balance
    )
    card = await _create_account(
        client,
        space_id,
        type="credit_card",
        name=f"Visa{suffix}",
        closing_day=5,
        due_day=12,
        initial_balance_minor=card_balance,
    )
    food = await make_category(session, space_id, kind="expense", name=f"Comida{suffix}")
    salary = await make_category(session, space_id, kind="income", name=f"Sueldo{suffix}")
    return World(uid, space_id, bank["id"], cash["id"], card["id"], str(food.id), str(salary.id))


def _movement(kind: str, world: World, amount_minor: int = 1_550, **fields: Any) -> dict[str, Any]:
    """A valid movement of each type: expense and income on the bank, transfer bank -> cash."""
    if kind == "expense":
        return _expense(world.bank, world.food, amount_minor, **fields)
    if kind == "income":
        return _income(world.bank, world.salary, amount_minor, **fields)
    if kind == "transfer":
        return _transfer(world.bank, world.cash, amount_minor, **fields)
    raise ValueError(kind)


async def _assert_summary_matches_the_accounts(
    client: AsyncClient, space_id: uuid.UUID
) -> dict[str, int]:
    """The summary must agree with the balances the account list shows, whatever the steps were.

    The oracle is the list (a different endpoint): available = banks + cash, debt = the opposite
    of the cards, net = available - debt = the sum of every balance.
    """
    accounts = await _accounts(client, space_id, include_archived=True)
    money = sum(a["balance_minor"] for a in accounts if a["type"] in ("bank", "cash"))
    cards = sum(a["balance_minor"] for a in accounts if a["type"] == "credit_card")
    summary = await _summary(client, space_id)
    assert summary == {
        "available_minor": money,
        "card_debt_minor": -cards,
        "net_minor": money + cards,
    }
    assert summary["net_minor"] == summary["available_minor"] - summary["card_debt_minor"]
    return summary


# A: the numbers of the story ---------------------------------------------------------------------


async def test_the_expense_of_the_story_raises_the_debt_of_the_visa(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _build_world(
        api_client,
        session,
        fake_firebase,
        "uid-qa-a",
        bank_balance=5_000_000,  # Itaú: 50.000,00
        card_balance=-300_000,  # Visa: owes 3.000,00
    )
    assert await _summary(api_client, world.space_id) == {
        "available_minor": 5_000_000,
        "card_debt_minor": 300_000,
        "net_minor": 4_700_000,
    }

    # An expense of 2.340,50 in Comida with the Visa.
    created = await _register(api_client, world.space_id, _expense(world.card, world.food, 234_050))

    [entry] = created["entries"]
    assert (entry["account_id"], entry["amount_minor"], entry["category_id"]) == (
        world.card,
        -234_050,
        world.food,
    )
    assert await _balances(api_client, world.space_id) == {
        world.bank: 5_000_000,
        world.cash: 0,
        world.card: -534_050,  # negative = you owe: 3.000,00 + 2.340,50
    }
    assert await _assert_summary_matches_the_accounts(api_client, world.space_id) == {
        "available_minor": 5_000_000,
        "card_debt_minor": 534_050,
        "net_minor": 4_465_950,
    }
    assert await _count_by_type(session, world.space_id) == Counter({"adjustment": 2, "expense": 1})


async def test_the_transfer_of_the_story_lowers_the_bank_and_the_debt_by_the_same_amount(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _build_world(
        api_client,
        session,
        fake_firebase,
        "uid-qa-a",
        bank_balance=5_000_000,  # Itaú: 50.000,00
        card_balance=-3_234_050,  # Visa: owes 32.340,50
    )
    before = await _assert_summary_matches_the_accounts(api_client, world.space_id)
    assert before == {
        "available_minor": 5_000_000,
        "card_debt_minor": 3_234_050,
        "net_minor": 1_765_950,
    }

    # Paying the Visa with 12.000,00 from Itaú.
    created = await _register(
        api_client, world.space_id, _transfer(world.bank, world.card, 1_200_000)
    )

    assert await _balances(api_client, world.space_id) == {
        world.bank: 3_800_000,
        world.cash: 0,
        world.card: -2_034_050,
    }
    after = await _assert_summary_matches_the_accounts(api_client, world.space_id)
    assert after == {
        "available_minor": 3_800_000,
        "card_debt_minor": 2_034_050,
        "net_minor": 1_765_950,  # a transfer never changes the net
    }
    # The bank goes down and the debt goes down by the same amount.
    assert before["available_minor"] - after["available_minor"] == 1_200_000
    assert before["card_debt_minor"] - after["card_debt_minor"] == 1_200_000
    assert after["net_minor"] == before["net_minor"]

    # Two entries that add up to zero, without a category, and not an expense.
    rows = (
        await session.execute(
            select(Entry.account_id, Entry.amount_minor, Entry.category_id).where(
                Entry.transaction_id == uuid.UUID(created["id"])
            )
        )
    ).all()
    assert sorted((str(account), amount, category) for account, amount, category in rows) == sorted(
        [(world.bank, -1_200_000, None), (world.card, 1_200_000, None)]
    )
    assert sum(amount for _, amount, _ in rows) == 0
    assert await _count_by_type(session, world.space_id) == Counter(
        {"adjustment": 2, "transfer": 1}
    )
    with_category = await session.scalar(
        select(func.count())
        .select_from(Entry)
        .where(Entry.space_id == world.space_id, Entry.category_id.is_not(None))
    )
    assert with_category == 0  # nothing in the space is classified, so nothing counts as spending


async def test_a_mix_of_the_three_types_keeps_every_balance_and_the_net_consistent(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _build_world(
        api_client,
        session,
        fake_firebase,
        "uid-qa-a",
        bank_balance=1_000_000,
        cash_balance=2_500,
        card_balance=-300_000,
    )
    assert await _assert_summary_matches_the_accounts(api_client, world.space_id) == {
        "available_minor": 1_002_500,
        "card_debt_minor": 300_000,
        "net_minor": 702_500,
    }
    steps: list[tuple[str, dict[str, Any], dict[str, int]]] = [
        (
            "income of 900,00 in the bank",
            _income(world.bank, world.salary, 90_000),
            {"available_minor": 1_092_500, "card_debt_minor": 300_000, "net_minor": 792_500},
        ),
        (
            "expense of 15,50 in cash",
            _expense(world.cash, world.food, 1_550),
            {"available_minor": 1_090_950, "card_debt_minor": 300_000, "net_minor": 790_950},
        ),
        (
            "expense of 2.340,50 with the card",
            _expense(world.card, world.food, 234_050),
            {"available_minor": 1_090_950, "card_debt_minor": 534_050, "net_minor": 556_900},
        ),
        (
            "bank pays 1.000,00 of the card",
            _transfer(world.bank, world.card, 100_000),
            {"available_minor": 990_950, "card_debt_minor": 434_050, "net_minor": 556_900},
        ),
        (
            "cash goes to the bank",
            _transfer(world.cash, world.bank, 500),
            {"available_minor": 990_950, "card_debt_minor": 434_050, "net_minor": 556_900},
        ),
        (
            "cash advance from the card",
            _transfer(world.card, world.cash, 10_000),
            {"available_minor": 1_000_950, "card_debt_minor": 444_050, "net_minor": 556_900},
        ),
    ]

    for label, body, expected in steps:
        await _register(api_client, world.space_id, body)
        assert await _assert_summary_matches_the_accounts(api_client, world.space_id) == expected, (
            label
        )

    assert await _balances(api_client, world.space_id) == {
        world.bank: 990_500,
        world.cash: 10_450,
        world.card: -444_050,
    }
    assert await _count_by_type(session, world.space_id) == Counter(
        {"adjustment": 3, "income": 1, "expense": 2, "transfer": 3}
    )
    # In the database: every transfer has two entries that add up to zero, and the whole space adds
    # up to the net of the summary.
    per_transaction = await session.execute(
        select(Transaction.type, func.count(Entry.id), func.sum(Entry.amount_minor))
        .join(Entry, Entry.transaction_id == Transaction.id)
        .where(Transaction.space_id == world.space_id)
        .group_by(Transaction.id, Transaction.type)
    )
    transfers = [
        (count, int(total)) for kind, count, total in per_transaction if kind == "transfer"
    ]
    assert transfers == [(2, 0)] * 3
    everything = await session.scalar(
        select(func.sum(Entry.amount_minor)).where(Entry.space_id == world.space_id)
    )
    assert everything == 556_900


# B: a currency without decimals ------------------------------------------------------------------


async def test_a_clp_space_stores_whole_pesos_for_each_type(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-qa-a")
    _sign_in_as(fake_firebase, "uid-qa-a")
    chosen = await api_client.patch(f"/spaces/{space_id}", json={"currency": "CLP"}, headers=COOKIE)
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["currency"] == {"code": "CLP", "exponent": 0}
    bank = await _create_account(api_client, space_id, type="bank", name="Banco")
    cash = await _create_account(api_client, space_id, type="cash", name="Efectivo")
    card = await _create_account(
        api_client, space_id, type="credit_card", name="Visa", closing_day=5, due_day=12
    )
    food = await make_category(session, space_id, kind="expense", name="Comida")
    salary = await make_category(session, space_id, kind="income", name="Sueldo")

    # 150.000 pesos are stored as 150_000, not as 15_000_000.
    income = await _register(api_client, space_id, _income(bank["id"], str(salary.id), 150_000))
    expense = await _register(api_client, space_id, _expense(card["id"], str(food.id), 1_500))
    to_cash = await _register(api_client, space_id, _transfer(bank["id"], cash["id"], 20_000))
    paid = await _register(api_client, space_id, _transfer(bank["id"], card["id"], 1_500))

    assert [e["amount_minor"] for e in income["entries"]] == [150_000]
    assert [e["amount_minor"] for e in expense["entries"]] == [-1_500]
    assert [e["amount_minor"] for e in to_cash["entries"]] == [-20_000, 20_000]
    assert [e["amount_minor"] for e in paid["entries"]] == [-1_500, 1_500]
    assert await _balances(api_client, space_id) == {
        bank["id"]: 128_500,
        cash["id"]: 20_000,
        card["id"]: 0,
    }
    assert await _assert_summary_matches_the_accounts(api_client, space_id) == {
        "available_minor": 148_500,
        "card_debt_minor": 0,
        "net_minor": 148_500,
    }
    space = await _space(api_client, space_id)
    assert (space["currency"], space["currency_locked"]) == (
        {"code": "CLP", "exponent": 0},
        True,
    )


@pytest.mark.parametrize("amount", [1500.5, 1500.0, "1500,50"], ids=["half", "float", "text"])
async def test_in_a_clp_space_an_amount_with_decimals_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, amount: object
) -> None:
    _, space_id = await make_user_and_space(session, "uid-qa-a")
    _sign_in_as(fake_firebase, "uid-qa-a")
    await api_client.patch(f"/spaces/{space_id}", json={"currency": "CLP"}, headers=COOKIE)
    bank = await _create_account(api_client, space_id, type="bank", name="Banco")
    food = await make_category(session, space_id, kind="expense", name="Comida")
    body = _expense(bank["id"], str(food.id), 1_500)

    # Only the amount is wrong: the same movement with 1.500 whole pesos is accepted.
    refused = await _post(api_client, space_id, {**body, "amount_minor": amount})

    [(_, loc)] = _issues(refused)
    assert loc == ["body", "expense", "amount_minor"]
    assert await _written(session) == (0, 0, 0)
    assert await _balances(api_client, space_id) == {bank["id"]: 0}
    accepted = await _post(api_client, space_id, body)
    assert accepted.status_code == 201
    assert await _balances(api_client, space_id) == {bank["id"]: -1_500}


# C: refused movements as a flow ------------------------------------------------------------------


async def test_every_refused_movement_leaves_balances_rows_and_currency_lock_untouched(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    theirs = await _build_world(api_client, session, fake_firebase, "uid-qa-b", suffix=" de B")
    world = await _build_world(api_client, session, fake_firebase, "uid-qa-a")
    old_account = await _create_account(api_client, world.space_id, type="bank", name="Vieja")
    archived = await api_client.post(
        f"/spaces/{world.space_id}/accounts/{old_account['id']}/archive", headers=COOKIE
    )
    assert archived.status_code == 200, archived.text
    old_category = await make_category(
        session, world.space_id, kind="expense", name="Vieja", archived=True
    )
    # A world with every balance at zero has no transaction: the currency can still be chosen.
    balances = await _balances(api_client, world.space_id)
    assert await _written(session) == (0, 0, 0)
    assert (await _space(api_client, world.space_id))["currency_locked"] is False

    old = old_account["id"]
    refusals: list[tuple[str, dict[str, Any], list[tuple[str, list[str]]]]] = [
        ("expense of 0", _expense(world.bank, world.food, 0), [("greater_than", ["amount_minor"])]),
        (
            "expense < 0",
            _expense(world.bank, world.food, -1_550),
            [("greater_than", ["amount_minor"])],
        ),
        ("income of 0", _income(world.bank, world.salary, 0), [("greater_than", ["amount_minor"])]),
        (
            "transfer < 0",
            _transfer(world.bank, world.cash, -1),
            [("greater_than", ["amount_minor"])],
        ),
        (
            "expense without category",
            {
                k: v
                for k, v in _expense(world.bank, world.food, 1_550).items()
                if k != "category_id"
            },
            [("missing", ["category_id"])],
        ),
        (
            "expense in an income category",
            _expense(world.bank, world.salary, 1_550),
            [("transaction_category_kind_mismatch", ["category_id"])],
        ),
        (
            "income in an expense category",
            _income(world.bank, world.food, 1_550),
            [("transaction_category_kind_mismatch", ["category_id"])],
        ),
        (
            "transfer to the same account",
            _transfer(world.bank, world.bank, 1_550),
            [("transfer_same_account", ["to_account_id"])],
        ),
        (
            "expense on an archived account",
            _expense(old, world.food, 1_550),
            [("account_archived", ["account_id"])],
        ),
        (
            "transfer to an archived account",
            _transfer(world.bank, old, 1_550),
            [("account_archived", ["to_account_id"])],
        ),
        (
            "expense in an archived category",
            _expense(world.bank, str(old_category.id), 1_550),
            [("category_archived", ["category_id"])],
        ),
        (
            "expense on an account of another space",
            _expense(theirs.bank, world.food, 1_550),
            [("account_not_found", ["account_id"])],
        ),
        (
            "expense in a category of another space",
            _expense(world.bank, theirs.food, 1_550),
            [("category_not_found", ["category_id"])],
        ),
        (
            "transfer from an account of another space",
            _transfer(theirs.bank, world.cash, 1_550),
            [("account_not_found", ["from_account_id"])],
        ),
    ]

    for label, body, expected in refusals:
        response = await _post(api_client, world.space_id, body)

        assert _issues(response) == [
            (kind, ["body", body["type"], *loc]) for kind, loc in expected
        ], label

    assert await _written(session) == (0, 0, 0)
    assert await _balances(api_client, world.space_id) == balances
    assert await _summary(api_client, world.space_id) == {
        "available_minor": 0,
        "card_debt_minor": 0,
        "net_minor": 0,
    }
    assert (await _space(api_client, world.space_id))["currency_locked"] is False
    # The same space accepts a valid movement afterwards, and only now the currency is locked.
    await _register(api_client, world.space_id, _expense(world.bank, world.food, 1_550))
    assert (await _space(api_client, world.space_id))["currency_locked"] is True


async def test_archiving_and_unarchiving_accounts_and_categories_through_the_api_gates_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _build_world(api_client, session, fake_firebase, "uid-qa-a", bank_balance=100_000)
    space = f"/spaces/{world.space_id}"
    first = await _register(api_client, world.space_id, _expense(world.bank, world.food, 1_000))

    # An archived category is not offered: a movement in it is a 422 on the category.
    archived_category = await api_client.post(
        f"{space}/categories/{world.food}/archive", headers=COOKIE
    )
    assert archived_category.status_code == 200, archived_category.text
    refused = await _post(api_client, world.space_id, _expense(world.bank, world.food, 2_000))
    assert _issues(refused) == [("category_archived", ["body", "expense", "category_id"])]
    # The movement it already had keeps its category.
    kept = await session.scalar(
        select(Entry.category_id).where(Entry.transaction_id == uuid.UUID(first["id"]))
    )
    assert str(kept) == world.food
    assert (await _balances(api_client, world.space_id))[world.bank] == 99_000

    # Unarchived, it takes movements again.
    restored_category = await api_client.post(
        f"{space}/categories/{world.food}/unarchive", headers=COOKIE
    )
    assert restored_category.status_code == 200, restored_category.text
    await _register(api_client, world.space_id, _expense(world.bank, world.food, 2_000))
    assert (await _balances(api_client, world.space_id))[world.bank] == 97_000

    # An account with a zero balance can be archived; then every role it can play is refused.
    archived_account = await api_client.post(
        f"{space}/accounts/{world.cash}/archive", headers=COOKIE
    )
    assert archived_account.status_code == 200, archived_account.text
    refusals = [
        (_expense(world.cash, world.food, 500), "account_id"),
        (_transfer(world.bank, world.cash, 500), "to_account_id"),
        (_transfer(world.cash, world.bank, 500), "from_account_id"),
    ]
    for body, field in refusals:
        response = await _post(api_client, world.space_id, body)

        assert _issues(response) == [("account_archived", ["body", body["type"], field])]
    assert (await _balances(api_client, world.space_id))[world.cash] == 0

    # Unarchived, it takes movements again, as origin and as destination.
    restored_account = await api_client.post(
        f"{space}/accounts/{world.cash}/unarchive", headers=COOKIE
    )
    assert restored_account.status_code == 200, restored_account.text
    await _register(api_client, world.space_id, _transfer(world.bank, world.cash, 500))
    await _register(api_client, world.space_id, _transfer(world.cash, world.bank, 200))
    assert await _balances(api_client, world.space_id) == {
        world.bank: 96_700,
        world.cash: 300,
        world.card: 0,
    }


# D: IDOR -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("key", [None, KEY], ids=["without_key", "with_key"])
@pytest.mark.parametrize("kind", ["expense", "income", "transfer"])
async def test_user_b_gets_404_when_registering_in_the_space_of_user_a(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    kind: str,
    key: str | None,
) -> None:
    world = await _build_world(api_client, session, fake_firebase, "uid-qa-a", suffix=" de A")
    balances = await _balances(api_client, world.space_id)
    await make_user_and_space(session, "uid-qa-b")
    _sign_in_as(fake_firebase, "uid-qa-b")

    # A valid body made of real ids of the space of A.
    response = await _post(api_client, world.space_id, _movement(kind, world), key)

    assert (response.status_code, response.json()) == (404, SPACE_NOT_FOUND)
    assert "de A" not in response.text
    assert await _written(session) == (0, 0, 0)
    _sign_in_as(fake_firebase, "uid-qa-a")
    assert await _balances(api_client, world.space_id) == balances
    assert await _summary(api_client, world.space_id) == {
        "available_minor": 0,
        "card_debt_minor": 0,
        "net_minor": 0,
    }


@pytest.mark.parametrize(
    ("kind", "field", "attribute", "expected_type"),
    [
        ("expense", "category_id", "food", "category_not_found"),
        ("income", "category_id", "salary", "category_not_found"),
        ("transfer", "from_account_id", "bank", "account_not_found"),
        ("transfer", "to_account_id", "bank", "account_not_found"),
    ],
    ids=["expense_category", "income_category", "transfer_origin", "transfer_destination"],
)
async def test_a_foreign_category_or_account_answers_exactly_like_a_missing_one(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    kind: str,
    field: str,
    attribute: str,
    expected_type: str,
) -> None:
    theirs = await _build_world(api_client, session, fake_firebase, "uid-qa-a", suffix=" de A")
    mine = await _build_world(api_client, session, fake_firebase, "uid-qa-b")  # signs in as B
    foreign_id = getattr(theirs, attribute)

    foreign = await _post(api_client, mine.space_id, _movement(kind, mine) | {field: foreign_id})
    missing = await _post(
        api_client, mine.space_id, _movement(kind, mine) | {field: str(uuid.uuid4())}
    )

    assert _issues(foreign) == [(expected_type, ["body", kind, field])]
    assert _shape(foreign) == _shape(missing)  # a 404 here would tell B that the id exists
    assert "de A" not in foreign.text
    assert await _written(session) == (0, 0, 0)
    assert await _balances(api_client, mine.space_id) == {mine.bank: 0, mine.cash: 0, mine.card: 0}
    _sign_in_as(fake_firebase, "uid-qa-a")
    assert await _balances(api_client, theirs.space_id) == {
        theirs.bank: 0,
        theirs.cash: 0,
        theirs.card: 0,
    }


# E: Idempotency-Key with every type --------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "deltas", "entries"),
    [
        ("expense", {"bank": -1_550}, 1),
        ("income", {"bank": 1_550}, 1),
        ("transfer", {"bank": -1_550, "cash": 1_550}, 2),
    ],
)
async def test_a_double_tap_creates_one_movement_and_changes_the_balances_once(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    kind: str,
    deltas: dict[str, int],
    entries: int,
) -> None:
    world = await _build_world(api_client, session, fake_firebase, "uid-qa-a")
    expected = {world.bank: 0, world.cash: 0, world.card: 0}
    for attribute, delta in deltas.items():
        expected[getattr(world, attribute)] += delta

    first = await _post(api_client, world.space_id, _movement(kind, world), KEY)
    second = await _post(api_client, world.space_id, _movement(kind, world), KEY)

    assert (first.status_code, second.status_code) == (201, 201)
    assert second.json() == first.json()
    assert first.json()["type"] == kind
    assert await _written(session) == (1, entries, 1)
    assert await _balances(api_client, world.space_id) == expected


async def test_the_same_key_with_the_accounts_of_a_transfer_swapped_is_a_409(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _build_world(api_client, session, fake_firebase, "uid-qa-a")
    first = await _post(api_client, world.space_id, _transfer(world.bank, world.card, 3_000), KEY)

    swapped = await _post(api_client, world.space_id, _transfer(world.card, world.bank, 3_000), KEY)

    assert first.status_code == 201
    assert swapped.status_code == 409
    assert swapped.json()["code"] == "idempotency_key_reused"
    assert await _written(session) == (1, 2, 1)
    assert await _balances(api_client, world.space_id) == {
        world.bank: -3_000,
        world.cash: 0,
        world.card: 3_000,
    }
    # The original request still replays after the refusal.
    again = await _post(api_client, world.space_id, _transfer(world.bank, world.card, 3_000), KEY)
    assert (again.status_code, again.json()) == (201, first.json())


# F: the shape of the 201 -------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["expense", "income", "transfer"])
async def test_the_201_body_has_exactly_the_documented_fields_for_every_type(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, kind: str
) -> None:
    world = await _build_world(api_client, session, fake_firebase, "uid-qa-a")
    all_entries: dict[str, list[tuple[str, int, str | None]]] = {
        "expense": [(world.bank, -1_550, world.food)],
        "income": [(world.bank, 1_550, world.salary)],
        "transfer": [(world.bank, -1_550, None), (world.cash, 1_550, None)],
    }
    expected_entries = all_entries[kind]

    response = await _post(
        api_client, world.space_id, _movement(kind, world, description=" Con descripción ")
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"id", "type", "status", "date", "description", "entries"}
    assert uuid.UUID(body["id"]).version == 7
    assert len(body["entries"]) == len(expected_entries)
    for entry in body["entries"]:
        assert set(entry) == {"id", "account_id", "amount_minor", "category_id"}
        assert uuid.UUID(entry.pop("id")).version == 7
    assert {key: body[key] for key in ("type", "status", "date", "description")} == {
        "type": kind,
        "status": "confirmed",
        "date": DAY,
        "description": "Con descripción",
    }
    assert [
        (e["account_id"], e["amount_minor"], e["category_id"]) for e in body["entries"]
    ] == expected_entries
