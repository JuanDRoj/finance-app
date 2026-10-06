import uuid

from sqlalchemy import Row, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.models import User


async def upsert_by_firebase_uid(
    session: AsyncSession, *, firebase_uid: str, email: str, display_name: str | None
) -> Row[uuid.UUID, str, str | None]:
    """Insert the user, or refresh the email of the one that already has this `firebase_uid`.

    `display_name` is only written on insert: a later login must not undo a name the user chose.
    `updated_at` is set here because the ORM's `onupdate` does not apply to ON CONFLICT. The
    conflicting row is locked until the transaction ends, so two first logins of the same user at
    once serialise and both get the same id.
    """
    new_row = insert(User).values(firebase_uid=firebase_uid, email=email, display_name=display_name)
    stmt = new_row.on_conflict_do_update(
        index_elements=[User.firebase_uid],
        set_={"email": new_row.excluded.email, "updated_at": func.now()},
    ).returning(User.id, User.email, User.display_name)
    return (await session.execute(stmt)).one()
