import uuid
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.modules.spaces import service
from app.modules.spaces.models import Space, SpaceMember
from app.modules.users import service as users_service


async def _make_user(session: AsyncSession, uid: str) -> UUID:
    user = await users_service.upsert_user(
        session, firebase_uid=uid, email=f"{uid}@example.com", display_name=None
    )
    return user.id


async def _spaces_of(session: AsyncSession, user_id: UUID) -> list[Space]:
    rows = await session.scalars(select(Space).where(Space.created_by == user_id))
    return list(rows)


async def test_first_call_creates_the_personal_space_with_an_owner_membership(
    session: AsyncSession,
) -> None:
    user_id = await _make_user(session, "uid-space-1")

    created = await service.ensure_personal_space(session, user_id, "America/Montevideo")

    assert created is True
    [space] = await _spaces_of(session, user_id)
    assert (space.name, space.type, space.currency) == ("Mi espacio", "personal", "UYU")
    assert space.timezone == "America/Montevideo"
    members = list(
        await session.scalars(select(SpaceMember).where(SpaceMember.space_id == space.id))
    )
    assert [(m.user_id, m.role) for m in members] == [(user_id, "owner")]


async def test_second_call_changes_nothing_and_keeps_the_original_timezone(
    session: AsyncSession,
) -> None:
    user_id = await _make_user(session, "uid-space-2")
    await service.ensure_personal_space(session, user_id, "America/Montevideo")

    created = await service.ensure_personal_space(session, user_id, "Asia/Tokyo")

    assert created is False
    [space] = await _spaces_of(session, user_id)
    assert space.timezone == "America/Montevideo"
    members = list(
        await session.scalars(select(SpaceMember).where(SpaceMember.space_id == space.id))
    )
    assert len(members) == 1


async def test_each_user_gets_their_own_personal_space(session: AsyncSession) -> None:
    one = await _make_user(session, "uid-space-3a")
    two = await _make_user(session, "uid-space-3b")

    assert await service.ensure_personal_space(session, one, "UTC") is True
    assert await service.ensure_personal_space(session, two, "UTC") is True

    [space_one] = await _spaces_of(session, one)
    [space_two] = await _spaces_of(session, two)
    assert space_one.id != space_two.id


async def test_a_household_space_does_not_count_as_the_personal_one(session: AsyncSession) -> None:
    user_id = await _make_user(session, "uid-space-4")
    session.add(
        Space(
            id=uuid.uuid7(),
            name="Hogar",
            type="household",
            currency="UYU",
            timezone="UTC",
            created_by=user_id,
        )
    )
    await session.flush()

    created = await service.ensure_personal_space(session, user_id, "UTC")

    assert created is True
    assert sorted(s.type for s in await _spaces_of(session, user_id)) == ["household", "personal"]


async def _personal_space_id(session: AsyncSession, user_id: UUID) -> UUID:
    await service.ensure_personal_space(session, user_id, "America/Montevideo")
    return (await _spaces_of(session, user_id))[0].id


async def test_require_member_returns_the_membership_of_the_owner(session: AsyncSession) -> None:
    user_id = await _make_user(session, "uid-member-1")
    space_id = await _personal_space_id(session, user_id)

    member = await service.require_member(session, space_id, user_id)

    assert (member.space_id, member.user_id, member.role) == (space_id, user_id, "owner")


async def test_require_member_gives_404_to_a_user_who_is_not_a_member(
    session: AsyncSession,
) -> None:
    owner_id = await _make_user(session, "uid-member-a")
    other_id = await _make_user(session, "uid-member-b")
    space_id = await _personal_space_id(session, owner_id)

    with pytest.raises(NotFoundError) as exc:
        await service.require_member(session, space_id, other_id)

    assert exc.value.code == "space_not_found"


async def test_require_member_gives_the_same_error_for_a_space_that_does_not_exist(
    session: AsyncSession,
) -> None:
    user_id = await _make_user(session, "uid-member-c")

    with pytest.raises(NotFoundError) as exc:
        await service.require_member(session, uuid.uuid7(), user_id)

    assert (exc.value.code, exc.value.detail) == ("space_not_found", "Space not found")
