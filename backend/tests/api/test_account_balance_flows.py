"""The story "Mis cuentas con su saldo" (KAN-51) as flows through HTTP only.

`test_accounts.py`, `test_balance_summary.py` and `test_spaces.py` test each endpoint on its own and
write most movements straight into the database. These tests chain the real endpoints the way a
person does (create accounts, register movements, reconcile, archive, change the currency) and check
what the next endpoint says. The only rows written outside HTTP are the user and the categories.

Money is always an integer in the minor unit of the currency of the space: UYU `1_000_000` is
10.000,00 and CLP `1_500` is 1.500 (exponent 0).
"""

import uuid
from collections import Counter
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.transactions.models import Entry, Transaction
from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import make_category, make_user_and_space

COOKIE = {"Cookie": "session=valid-cookie"}
DAY = "2026-10-20"


async def _space_of(session: AsyncSession, fake: FakeFirebaseAuth, uid: str) -> uuid.UUID:
    """A user with their personal space (UYU), already signed in."""
    _, space_id = await make_user_and_space(session, uid)
    fake.session_identity = make_identity(uid=uid)
    return space_id


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


async def _summary(client: AsyncClient, space_id: uuid.UUID) -> dict[str, int]:
    response = await client.get(f"/spaces/{space_id}/balance-summary", headers=COOKIE)
    assert response.status_code == 200, response.text
    summary: dict[str, int] = response.json()
    return summary


async def _register(client: AsyncClient, space_id: uuid.UUID, **body: Any) -> dict[str, Any]:
    """Register an expense, an income or a transfer (`POST /transactions`)."""
    response = await client.post(
        f"/spaces/{space_id}/transactions", json={"date": DAY, **body}, headers=COOKIE
    )
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def _reconcile(
    client: AsyncClient, space_id: uuid.UUID, account_id: str, balance_minor: int
) -> dict[str, Any]:
    response = await client.post(
        f"/spaces/{space_id}/accounts/{account_id}/reconcile",
        json={"balance_minor": balance_minor},
        headers=COOKIE,
    )
    assert response.status_code == 200, response.text
    account: dict[str, Any] = response.json()
    return account


def _expense(account_id: str, category_id: uuid.UUID, amount_minor: int) -> dict[str, Any]:
    return {
        "type": "expense",
        "account_id": account_id,
        "category_id": str(category_id),
        "amount_minor": amount_minor,
    }


def _income(account_id: str, category_id: uuid.UUID, amount_minor: int) -> dict[str, Any]:
    return {
        "type": "income",
        "account_id": account_id,
        "category_id": str(category_id),
        "amount_minor": amount_minor,
    }


def _transfer(from_id: str, to_id: str, amount_minor: int) -> dict[str, Any]:
    return {
        "type": "transfer",
        "from_account_id": from_id,
        "to_account_id": to_id,
        "amount_minor": amount_minor,
    }


async def _count_by_type(session: AsyncSession, space_id: uuid.UUID) -> Counter[str]:
    """How many transactions of each type the space has (any status, deleted ones included)."""
    types = await session.scalars(select(Transaction.type).where(Transaction.space_id == space_id))
    return Counter(types)


async def _adjustments(
    session: AsyncSession, space_id: uuid.UUID
) -> list[tuple[str, str, str | None, int, uuid.UUID | None]]:
    """`(type, status, description, amount, category)` of each adjustment entry, by amount."""
    rows = await session.execute(
        select(
            Transaction.type,
            Transaction.status,
            Transaction.description,
            Entry.amount_minor,
            Entry.category_id,
        )
        .join(Entry, Entry.transaction_id == Transaction.id)
        .where(Transaction.space_id == space_id, Transaction.type == "adjustment")
        .order_by(Entry.amount_minor)
    )
    return [(t, s, d, amount, category) for t, s, d, amount, category in rows]


# F1: the first accounts of a space -------------------------------------------------------------


async def test_first_accounts_flow_matches_the_numbers_of_the_story(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _space_of(session, fake_firebase, "uid-qa-a")

    # Without accounts: an empty list and a summary in zeros (the screen invites to create one).
    assert await _accounts(api_client, space_id) == []
    assert await _summary(api_client, space_id) == {
        "available_minor": 0,
        "card_debt_minor": 0,
        "net_minor": 0,
    }

    # "Itaú" (bank) with 10.000 and "Visa" (card) with a debt of 3.000, closing 5 and due 12.
    itau = await _create_account(
        api_client, space_id, type="bank", name="Itaú", initial_balance_minor=1_000_000
    )
    visa = await _create_account(
        api_client,
        space_id,
        type="credit_card",
        name="Visa",
        closing_day=5,
        due_day=12,
        initial_balance_minor=-300_000,
    )

    assert (itau["balance_minor"], visa["balance_minor"]) == (1_000_000, -300_000)
    listed = await _accounts(api_client, space_id)
    assert [
        (a["name"], a["type"], a["closing_day"], a["due_day"], a["balance_minor"]) for a in listed
    ] == [
        ("Itaú", "bank", None, None, 1_000_000),
        ("Visa", "credit_card", 5, 12, -300_000),
    ]
    assert await _summary(api_client, space_id) == {
        "available_minor": 1_000_000,
        "card_debt_minor": 300_000,
        "net_minor": 700_000,
    }

    # The initial balances are adjustments: confirmed, without category or description, and the
    # space has no income and no expense.
    assert await _adjustments(session, space_id) == [
        ("adjustment", "confirmed", None, -300_000, None),
        ("adjustment", "confirmed", None, 1_000_000, None),
    ]
    assert await _count_by_type(session, space_id) == Counter({"adjustment": 2})


# F2: reconcile after real movements -----------------------------------------------------------


async def test_reconcile_after_real_movements_leaves_the_balance_at_the_real_one(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _space_of(session, fake_firebase, "uid-qa-a")
    food = await make_category(session, space_id, kind="expense", name="Comida")
    salary = await make_category(session, space_id, kind="income", name="Sueldo")
    itau = await _create_account(
        api_client, space_id, type="bank", name="Itaú", initial_balance_minor=1_000_000
    )
    await _register(api_client, space_id, **_expense(itau["id"], food.id, 155_000))
    await _register(api_client, space_id, **_income(itau["id"], salary.id, 50_000))
    assert (await _accounts(api_client, space_id))[0]["balance_minor"] == 895_000

    # The bank says 900.000: the app registers the difference as an adjustment.
    up = await _reconcile(api_client, space_id, itau["id"], 900_000)

    assert up["balance_minor"] == 900_000
    assert (await _accounts(api_client, space_id))[0]["balance_minor"] == 900_000
    assert await _summary(api_client, space_id) == {
        "available_minor": 900_000,
        "card_debt_minor": 0,
        "net_minor": 900_000,
    }
    assert [a[3] for a in await _adjustments(session, space_id)] == [5_000, 1_000_000]

    # Reconciling again to the same balance writes nothing.
    again = await _reconcile(api_client, space_id, itau["id"], 900_000)

    assert again == up
    assert await _count_by_type(session, space_id) == Counter(
        {"adjustment": 2, "expense": 1, "income": 1}
    )

    # The bank now says 800.000: a negative adjustment.
    down = await _reconcile(api_client, space_id, itau["id"], 800_000)

    assert down["balance_minor"] == 800_000
    assert await _adjustments(session, space_id) == [
        ("adjustment", "confirmed", None, -100_000, None),
        ("adjustment", "confirmed", None, 5_000, None),
        ("adjustment", "confirmed", None, 1_000_000, None),
    ]
    assert await _count_by_type(session, space_id) == Counter(
        {"adjustment": 3, "expense": 1, "income": 1}
    )
    assert (await _summary(api_client, space_id))["net_minor"] == 800_000


# F3: archive an account that had movements --------------------------------------------------


async def test_archive_flow_after_real_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _space_of(session, fake_firebase, "uid-qa-a")
    food = await make_category(session, space_id, kind="expense", name="Comida")
    salary = await make_category(session, space_id, kind="income", name="Sueldo")
    cash = await _create_account(api_client, space_id, type="cash", name="Billetera")
    url = f"/spaces/{space_id}/accounts/{cash['id']}"
    await _register(api_client, space_id, **_income(cash["id"], salary.id, 2_500))

    # With money in it, it cannot be archived, and the answer says why.
    refused = await api_client.post(f"{url}/archive", headers=COOKIE)

    assert refused.status_code == 409
    assert refused.json()["code"] == "account_has_balance"
    assert refused.json()["detail"]
    assert [a["id"] for a in await _accounts(api_client, space_id)] == [cash["id"]]

    # Spending it all leaves the balance at zero, and then it can be archived.
    await _register(api_client, space_id, **_expense(cash["id"], food.id, 2_500))
    archived = await api_client.post(f"{url}/archive", headers=COOKIE)

    assert archived.status_code == 200
    assert archived.json()["balance_minor"] == 0
    assert archived.json()["archived_at"] is not None

    # It leaves the list, but its history is still there on request.
    assert await _accounts(api_client, space_id) == []
    everything = await _accounts(api_client, space_id, include_archived=True)
    assert [(a["id"], a["archived_at"] is not None) for a in everything] == [(cash["id"], True)]

    # And it is not offered when registering: a movement on it is a 422 on the account.
    refused_movement = await api_client.post(
        f"/spaces/{space_id}/transactions",
        json={"date": DAY, **_expense(cash["id"], food.id, 100)},
        headers=COOKIE,
    )
    assert refused_movement.status_code == 422
    assert [(e["type"], e["loc"]) for e in refused_movement.json()["detail"]] == [
        ("account_archived", ["body", "expense", "account_id"])
    ]

    # Bringing it back puts it in the list again, with its balance.
    restored = await api_client.post(f"{url}/unarchive", headers=COOKIE)

    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None
    assert [(a["id"], a["balance_minor"]) for a in await _accounts(api_client, space_id)] == [
        (cash["id"], 0)
    ]


# F4: the currency, with a currency without decimals -------------------------------------------


async def test_currency_choice_flow_with_a_currency_without_decimals(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _space_of(session, fake_firebase, "uid-qa-a")
    space_url = f"/spaces/{space_id}"
    catalog = (await api_client.get("/currencies", headers=COOKIE)).json()
    assert {"code": "CLP", "exponent": 0} in catalog

    # Without movements the currency can be chosen: CLP has exponent 0.
    chosen = await api_client.patch(space_url, json={"currency": "CLP"}, headers=COOKIE)

    assert chosen.status_code == 200
    assert chosen.json()["currency"] == {"code": "CLP", "exponent": 0}
    assert chosen.json()["currency_locked"] is False

    # 1.500 pesos are stored as 1_500, not as 150_000.
    cash = await _create_account(
        api_client, space_id, type="cash", name="Efectivo", initial_balance_minor=1_500
    )

    assert cash["balance_minor"] == 1_500
    assert (await _summary(api_client, space_id))["available_minor"] == 1_500
    space = (await api_client.get(space_url, headers=COOKIE)).json()
    assert space["currency"] == {"code": "CLP", "exponent": 0}
    assert space["currency_locked"] is True

    # With a movement (the initial balance is one) it can no longer change, and it says why.
    refused = await api_client.patch(space_url, json={"currency": "USD"}, headers=COOKIE)

    assert refused.status_code == 409
    assert refused.json()["code"] == "space_has_transactions"
    assert refused.json()["detail"]
    after = (await api_client.get(space_url, headers=COOKIE)).json()
    assert after["currency"] == {"code": "CLP", "exponent": 0}
    assert (await _accounts(api_client, space_id))[0]["balance_minor"] == 1_500

    # Choosing the one it already has is not a change.
    same = await api_client.patch(space_url, json={"currency": "CLP"}, headers=COOKIE)

    assert same.status_code == 200
    assert same.json()["currency"] == {"code": "CLP", "exponent": 0}


# F5: available, debt and net against the balances ---------------------------------------------


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


async def test_available_debt_and_net_agree_with_the_balances_through_a_card_flow(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _space_of(session, fake_firebase, "uid-qa-a")
    food = await make_category(session, space_id, kind="expense", name="Comida")
    itau = await _create_account(
        api_client, space_id, type="bank", name="Itaú", initial_balance_minor=1_000_000
    )
    await _create_account(
        api_client, space_id, type="cash", name="Billetera", initial_balance_minor=2_500
    )
    visa = await _create_account(
        api_client,
        space_id,
        type="credit_card",
        name="Visa",
        closing_day=5,
        due_day=12,
        initial_balance_minor=-300_000,
    )
    assert await _assert_summary_matches_the_accounts(api_client, space_id) == {
        "available_minor": 1_002_500,
        "card_debt_minor": 300_000,
        "net_minor": 702_500,
    }

    # Paying part of the card is a transfer: the debt goes down, the net does not move.
    await _register(api_client, space_id, **_transfer(itau["id"], visa["id"], 100_000))
    assert await _assert_summary_matches_the_accounts(api_client, space_id) == {
        "available_minor": 902_500,
        "card_debt_minor": 200_000,
        "net_minor": 702_500,
    }

    # Paying more than the debt: the card ends in favour, and the debt is negative, not clipped.
    await _register(api_client, space_id, **_transfer(itau["id"], visa["id"], 250_000))
    assert await _assert_summary_matches_the_accounts(api_client, space_id) == {
        "available_minor": 652_500,
        "card_debt_minor": -50_000,
        "net_minor": 702_500,
    }

    # The bank says the card owes 2.500: reconcile it (a debt is a negative balance).
    reconciled = await _reconcile(api_client, space_id, visa["id"], -250_000)
    assert reconciled["balance_minor"] == -250_000
    assert await _assert_summary_matches_the_accounts(api_client, space_id) == {
        "available_minor": 652_500,
        "card_debt_minor": 250_000,
        "net_minor": 402_500,
    }

    # An expense bigger than the balance of the bank leaves it negative; nothing is hidden.
    await _register(api_client, space_id, **_expense(itau["id"], food.id, 700_000))
    balances = {a["name"]: a["balance_minor"] for a in await _accounts(api_client, space_id)}
    assert balances == {"Itaú": -50_000, "Billetera": 2_500, "Visa": -250_000}
    assert await _assert_summary_matches_the_accounts(api_client, space_id) == {
        "available_minor": -47_500,
        "card_debt_minor": 250_000,
        "net_minor": -297_500,
    }
