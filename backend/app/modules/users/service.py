from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users import repository
from app.modules.users.schemas import UserRead


async def upsert_user(
    session: AsyncSession, *, firebase_uid: str, email: str, display_name: str | None
) -> UserRead:
    """The user of a Firebase account, created on the first login.

    Later logins refresh the email (it may change in Firebase) and nothing else.
    """
    row = await repository.upsert_by_firebase_uid(
        session, firebase_uid=firebase_uid, email=email, display_name=display_name
    )
    return UserRead.model_validate(row)


async def get_by_firebase_uid(session: AsyncSession, firebase_uid: str) -> UserRead | None:
    """The user of a Firebase account, or None if they never logged in."""
    row = await repository.get_by_firebase_uid(session, firebase_uid)
    return None if row is None else UserRead.model_validate(row)
