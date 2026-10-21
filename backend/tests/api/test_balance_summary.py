import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import insert_transaction, make_account, make_user_and_space

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
NOT_AUTHENTICATED = {"detail": "Not authenticated", "code": "not_authenticated"}


def _url(space_id: uuid.UUID) -> str:
    return f"/spaces/{space_id}/balance-summary"


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


async def test_the_summary_of_a_space_without_movements_is_all_zeros(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get(_url(space_id), headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == {"available_minor": 0, "card_debt_minor": 0, "net_minor": 0}


async def test_the_summary_splits_available_money_card_debt_and_net(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(bank.id, 100_000, None)])
    await insert_transaction(session, *spec, entries=[(cash.id, 2_500, None)])
    await insert_transaction(session, *spec, entries=[(card.id, -30_000, None)])

    response = await api_client.get(_url(space_id), headers=COOKIE)

    assert response.json() == {
        "available_minor": 102_500,
        "card_debt_minor": 30_000,
        "net_minor": 72_500,
    }


async def test_the_summary_ignores_pending_skipped_and_deleted_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(bank.id, 1_000, None)])
    await insert_transaction(session, *spec, entries=[(bank.id, 7, None)], status="pending")
    await insert_transaction(session, *spec, entries=[(bank.id, 70, None)], status="skipped")
    await insert_transaction(
        session, *spec, entries=[(bank.id, 700, None)], deleted_at=datetime.now(UTC)
    )

    response = await api_client.get(_url(space_id), headers=COOKIE)

    assert response.json() == {"available_minor": 1_000, "card_debt_minor": 0, "net_minor": 1_000}


async def test_the_summary_without_a_session_is_a_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")

    response = await api_client.get(_url(space_id))

    assert (response.status_code, response.json()) == (401, NOT_AUTHENTICATED)
    assert not fake_firebase.called


async def test_user_b_gets_404_on_the_summary_of_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a)
    await insert_transaction(
        session, space_id=space_a, user_id=user_a, entries=[(account.id, 5_000, None)]
    )
    _sign_in_as(fake_firebase, "uid-b")

    response = await api_client.get(_url(space_a), headers=COOKIE)

    assert (response.status_code, response.json()) == (404, SPACE_NOT_FOUND)
    assert "5000" not in response.text


async def test_the_summary_of_user_b_never_includes_the_movements_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    card_a = await make_account(session, space_a, type_="credit_card", name="Visa")
    await insert_transaction(
        session, space_id=space_a, user_id=user_a, entries=[(account_a.id, 5_000, None)]
    )
    await insert_transaction(
        session, space_id=space_a, user_id=user_a, entries=[(card_a.id, -900, None)]
    )
    _sign_in_as(fake_firebase, "uid-b")

    response = await api_client.get(_url(space_b), headers=COOKIE)

    assert response.json() == {"available_minor": 0, "card_debt_minor": 0, "net_minor": 0}
