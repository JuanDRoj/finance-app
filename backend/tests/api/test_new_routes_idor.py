"""IDOR of every route of the movements and the home screen, in one matrix (KAN-85, QA-06).

Every route of KAN-74, KAN-79, KAN-80, KAN-81 and KAN-90 already has its own IDOR test (in
`test_transactions.py`, `test_transactions_list.py`, `test_transactions_mutation.py`,
`test_dashboard.py` and `test_dashboard_series.py`), each with its own assertions. Here user B, who
has a space and data of their own, asks every route with real ids of user A (a movement of A, an
account and a category of A, a body that would be valid in the space of A) and the answer must be
the same everywhere: a 404 with the same body, nothing of A in it, and nothing of A changed.

`test_every_route_of_the_stories_is_in_the_idor_matrix` reads the OpenAPI schema: a new route under
`/transactions`, `/balance-summary` or `/dashboard` fails it until it is added to `ROUTES`.

Criterion -> where it is tested
-------------------------------
- Dado el usuario B, cuando pide, edita o borra un movimiento del espacio de A, entonces recibe 404
  (HU-12): `test_user_b_gets_404_on_every_route_of_the_space_of_user_a` (the space of A) and
  `test_user_b_gets_404_transaction_not_found_in_their_own_space_for_a_movement_of_user_a` (the
  movement of A asked from the space of B).
- A route that nobody put in the matrix: `test_every_route_of_the_stories_is_in_the_idor_matrix`.
- Without a session and without membership, for every route of every space:
  `test_routing.py`.
"""

import uuid
from dataclasses import dataclass

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import create_app
from tests.fakes import FakeFirebaseAuth
from tests.http_flows import (
    COOKIE,
    SPACE_NOT_FOUND,
    TRANSACTION_NOT_FOUND,
    Json,
    World,
    balance_summary,
    balances,
    build_world,
    dashboard,
    delete,
    detail,
    expense_body,
    list_all,
    movements_summary,
    register,
    series,
    sign_in_as,
)
from tests.months import Months


@dataclass(frozen=True)
class Route:
    name: str
    method: str
    template: str  # the path as OpenAPI names it
    with_transaction: bool = False  # it has `{transaction_id}`
    with_body: bool = False


TRANSACTIONS = "/spaces/{space_id}/transactions"
ROUTES = [
    Route("create", "POST", TRANSACTIONS, with_body=True),
    Route("list", "GET", TRANSACTIONS),
    Route("summary", "GET", f"{TRANSACTIONS}/summary"),
    Route("detail", "GET", f"{TRANSACTIONS}/{{transaction_id}}", with_transaction=True),
    Route("edit", "PUT", f"{TRANSACTIONS}/{{transaction_id}}", True, True),
    Route("delete", "DELETE", f"{TRANSACTIONS}/{{transaction_id}}", with_transaction=True),
    Route("restore", "POST", f"{TRANSACTIONS}/{{transaction_id}}/restore", with_transaction=True),
    Route("balance_summary", "GET", "/spaces/{space_id}/balance-summary"),
    Route("dashboard", "GET", "/spaces/{space_id}/dashboard"),
    Route("series", "GET", "/spaces/{space_id}/dashboard/series"),
]
PREFIXES = (TRANSACTIONS, "/spaces/{space_id}/balance-summary", "/spaces/{space_id}/dashboard")

# What must never be in an answer to B: names, notes and amounts (as digits) of the world of A.
LEAKS = ("de A", "Secreto", "424242", "31337", "5151")


def test_every_route_of_the_stories_is_in_the_idor_matrix() -> None:
    paths = create_app().openapi()["paths"]
    served = {
        (method.upper(), path)
        for path, operations in paths.items()
        for method in operations
        if path.startswith(PREFIXES)
    }

    assert served == {(route.method, route.template) for route in ROUTES}


async def _send(
    client: AsyncClient,
    route: Route,
    space_id: uuid.UUID,
    transaction_id: str | uuid.UUID | None,
    body: Json,
) -> Response:
    url = route.template.format(space_id=space_id, transaction_id=transaction_id)
    return await client.request(
        route.method, url, json=body if route.with_body else None, headers=COOKIE
    )


async def _everything_of(client: AsyncClient, world: World, months: Months, ids: list[str]) -> Json:
    """What the user of `world` sees: if B changed anything of A, it shows here."""
    sid = world.space_id
    return {
        "balances": await balances(client, sid),
        "balance_summary": await balance_summary(client, sid),
        "list": await list_all(client, sid),
        "summary": await movements_summary(client, sid, month=months.month),
        "dashboard": await dashboard(client, sid),
        "series": await series(client, sid, months=3),
        "details": [(i, (await detail(client, sid, i)).status_code) for i in ids],
    }


async def test_user_b_gets_404_on_every_route_of_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, months: Months
) -> None:
    a = await build_world(
        api_client, session, fake_firebase, "uid-qa-a", suffix=" de A", bank_balance=424_242
    )
    secret = await register(
        api_client,
        a.space_id,
        expense_body(a.bank, a.food, 31_337, months.first, description="Secreto"),
    )
    removed = await register(
        api_client, a.space_id, expense_body(a.bank, a.food, 5_151, months.first)
    )
    assert (await delete(api_client, a.space_id, removed["id"])).status_code == 204
    ids = [secret["id"], removed["id"]]
    before = await _everything_of(api_client, a, months, ids)
    b = await build_world(api_client, session, fake_firebase, "uid-qa-b")  # signs in as B
    mine = await register(api_client, b.space_id, expense_body(b.bank, b.food, 777, months.first))
    # A body that would be valid in the space of A: real ids of A.
    body = expense_body(a.bank, a.food, 9_999, months.first)

    refused: list[str] = []
    for route in ROUTES:
        whose = (
            [
                ("movement of A", secret["id"]),
                ("deleted one of A", removed["id"]),
                ("of B", mine["id"]),
            ]
            if route.with_transaction
            else [("", None)]
        )
        for label, transaction_id in whose:
            response = await _send(api_client, route, a.space_id, transaction_id, body)
            leaked = [text for text in LEAKS if text in response.text]
            # The status goes first: a route that answers without a body (a 204) is refused here
            # with its status and not with a JSONDecodeError that ends the loop.
            if response.status_code != 404 or response.json() != SPACE_NOT_FOUND or leaked:
                refused.append(f"{route.name} {label}: {response.status_code} {response.text}")

    assert refused == []
    sign_in_as(fake_firebase, "uid-qa-a")
    assert await _everything_of(api_client, a, months, ids) == before
    assert before["details"] == [(secret["id"], 200), (removed["id"], 404)]


@pytest.mark.parametrize("state", ["active", "deleted"])
async def test_user_b_gets_404_transaction_not_found_in_their_own_space_for_a_movement_of_user_a(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    months: Months,
    state: str,
) -> None:
    a = await build_world(
        api_client, session, fake_firebase, "uid-qa-a", suffix=" de A", bank_balance=424_242
    )
    theirs = await register(
        api_client,
        a.space_id,
        expense_body(a.bank, a.food, 31_337, months.first, description="Secreto"),
    )
    if state == "deleted":
        assert (await delete(api_client, a.space_id, theirs["id"])).status_code == 204
    before = await _everything_of(api_client, a, months, [theirs["id"]])
    b = await build_world(api_client, session, fake_firebase, "uid-qa-b")  # signs in as B
    body = expense_body(b.bank, b.food, 9_999, months.first)  # valid in the space of B
    unknown = uuid.uuid4()

    refused: list[str] = []
    for route in (r for r in ROUTES if r.with_transaction):
        foreign = await _send(api_client, route, b.space_id, theirs["id"], body)
        missing = await _send(api_client, route, b.space_id, unknown, body)
        leaked = [text for text in LEAKS if text in foreign.text]
        # The status goes first: an answer without a body (a 204) is refused here with its status
        # and text and not with a JSONDecodeError that ends the loop.
        if (
            foreign.status_code != 404
            or foreign.json() != TRANSACTION_NOT_FOUND
            or missing.status_code != 404
            or foreign.json() != missing.json()  # the same body as an id that does not exist
            or leaked
        ):
            refused.append(
                f"{route.name}: {foreign.status_code} {foreign.text}"
                f" (unknown id: {missing.status_code} {missing.text})"
            )

    assert refused == []
    assert set((await balances(api_client, b.space_id)).values()) == {0}
    sign_in_as(fake_firebase, "uid-qa-a")
    assert await _everything_of(api_client, a, months, [theirs["id"]]) == before
    assert before["details"] == [(theirs["id"], 200 if state == "active" else 404)]
