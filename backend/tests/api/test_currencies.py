from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import UnauthenticatedError
from app.modules.users import service as users_service
from tests.fakes import FakeFirebaseAuth, make_identity

COOKIE = {"Cookie": "session=valid-cookie"}


async def _sign_in(session: AsyncSession, fake: FakeFirebaseAuth, uid: str = "uid-a") -> None:
    await users_service.upsert_user(
        session, firebase_uid=uid, email=f"{uid}@example.com", display_name=None
    )
    fake.session_identity = make_identity(uid=uid)


async def test_the_catalog_lists_every_supported_currency_sorted_by_code(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await _sign_in(session, fake_firebase)

    response = await api_client.get("/currencies", headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == [
        {"code": "ARS", "exponent": 2},
        {"code": "BRL", "exponent": 2},
        {"code": "CLP", "exponent": 0},
        {"code": "COP", "exponent": 2},
        {"code": "EUR", "exponent": 2},
        {"code": "PYG", "exponent": 0},
        {"code": "USD", "exponent": 2},
        {"code": "UYU", "exponent": 2},
    ]


async def test_the_catalog_gives_exponent_zero_to_the_currencies_without_decimals(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await _sign_in(session, fake_firebase)

    exponents = {
        c["code"]: c["exponent"]
        for c in (await api_client.get("/currencies", headers=COOKIE)).json()
    }

    assert (exponents["CLP"], exponents["PYG"], exponents["UYU"]) == (0, 0, 2)


async def test_the_catalog_is_the_same_for_every_user(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await _sign_in(session, fake_firebase, "uid-a")
    first = await api_client.get("/currencies", headers=COOKIE)
    await _sign_in(session, fake_firebase, "uid-b")

    second = await api_client.get("/currencies", headers=COOKIE)

    assert first.json() == second.json()


async def test_the_catalog_without_a_session_is_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    response = await api_client.get("/currencies")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated", "code": "not_authenticated"}


async def test_the_catalog_with_a_cookie_rejected_by_firebase_is_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    fake_firebase.session_error = UnauthenticatedError("invalid_session", "Invalid session")

    response = await api_client.get("/currencies", headers=COOKIE)

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid session", "code": "invalid_session"}


async def test_the_catalog_with_a_trailing_slash_is_a_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await _sign_in(session, fake_firebase)

    response = await api_client.get("/currencies/", headers=COOKIE)

    assert response.status_code == 404
