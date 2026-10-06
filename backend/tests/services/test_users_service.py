import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users import service
from app.modules.users.models import User
from app.modules.users.schemas import UserRead


async def _count(session: AsyncSession, firebase_uid: str) -> int:
    stmt = select(func.count()).select_from(User).where(User.firebase_uid == firebase_uid)
    return (await session.scalar(stmt)) or 0


async def test_a_new_user_is_created_with_the_token_data(session: AsyncSession) -> None:
    user = await service.upsert_user(
        session, firebase_uid="uid-new", email="ana@example.com", display_name="Ana"
    )

    assert isinstance(user, UserRead)
    assert isinstance(user.id, uuid.UUID)
    assert (user.email, user.display_name) == ("ana@example.com", "Ana")
    assert await _count(session, "uid-new") == 1


async def test_the_same_firebase_uid_returns_the_same_user(session: AsyncSession) -> None:
    first = await service.upsert_user(
        session, firebase_uid="uid-same", email="a@example.com", display_name=None
    )
    second = await service.upsert_user(
        session, firebase_uid="uid-same", email="a@example.com", display_name=None
    )

    assert second.id == first.id
    assert await _count(session, "uid-same") == 1


async def test_a_later_login_refreshes_the_email(session: AsyncSession) -> None:
    first = await service.upsert_user(
        session, firebase_uid="uid-mail", email="old@example.com", display_name=None
    )

    second = await service.upsert_user(
        session, firebase_uid="uid-mail", email="new@example.com", display_name=None
    )

    assert second.id == first.id
    assert second.email == "new@example.com"
    row = await session.scalar(select(User.email).where(User.id == first.id))
    assert row == "new@example.com"


async def test_a_later_login_never_changes_the_display_name(session: AsyncSession) -> None:
    await service.upsert_user(
        session, firebase_uid="uid-name", email="a@example.com", display_name="Chosen name"
    )

    again = await service.upsert_user(
        session, firebase_uid="uid-name", email="a@example.com", display_name="Google name"
    )
    without_name = await service.upsert_user(
        session, firebase_uid="uid-name", email="a@example.com", display_name=None
    )

    assert again.display_name == "Chosen name"
    assert without_name.display_name == "Chosen name"


async def test_a_user_created_without_a_name_keeps_it_empty(session: AsyncSession) -> None:
    await service.upsert_user(
        session, firebase_uid="uid-noname", email="a@example.com", display_name=None
    )

    again = await service.upsert_user(
        session, firebase_uid="uid-noname", email="a@example.com", display_name="Later name"
    )

    assert again.display_name is None


async def test_different_firebase_uids_are_different_users(session: AsyncSession) -> None:
    one = await service.upsert_user(
        session, firebase_uid="uid-1x", email="same@example.com", display_name=None
    )
    two = await service.upsert_user(
        session, firebase_uid="uid-2x", email="same@example.com", display_name=None
    )

    assert one.id != two.id


async def test_get_by_firebase_uid_returns_the_user(session: AsyncSession) -> None:
    created = await service.upsert_user(
        session, firebase_uid="uid-get", email="g@example.com", display_name="G"
    )

    found = await service.get_by_firebase_uid(session, "uid-get")

    assert found == created


async def test_get_by_firebase_uid_returns_none_for_an_unknown_uid(session: AsyncSession) -> None:
    assert await service.get_by_firebase_uid(session, "uid-nobody") is None
