import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response, status

from app.core.config import SettingsDep
from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.auth import service
from app.modules.auth.cookies import (
    clear_session_cookie,
    read_session_cookie,
    set_session_cookie,
)
from app.modules.auth.dependencies import FirebaseDep, require_allowed_origin
from app.modules.auth.schemas import SessionCreate
from app.modules.spaces import service as spaces_service
from app.modules.users import service as users_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/auth",
    tags=["auth"],
    dependencies=[Depends(require_allowed_origin)],
    responses={403: {"model": ErrorResponse}},
)


@router.post(
    "/session",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: {"model": ErrorResponse}},
)
async def create_session(
    data: SessionCreate,
    response: Response,
    session: DbSession,
    settings: SettingsDep,
    firebase: FirebaseDep,
) -> None:
    """Exchange a Firebase ID token (signed in less than 5 minutes ago) for the session cookie.

    The cookie is HttpOnly and lasts 14 days. The first login also creates the user and their
    personal space "Mi espacio" (UYU, in the given timezone).
    """
    # The router composes `auth`, `users` and `spaces` (a service cannot call a later module).
    # Firebase goes first, so no connection of the small pool is held while waiting for Google.
    # It is all one transaction: if anything fails after the cookie was built, the rollback leaves
    # no user behind and no `Set-Cookie` goes out.
    new = await service.create_session(firebase, data.id_token, now=datetime.now(UTC))
    user = await users_service.upsert_user(
        session, firebase_uid=new.firebase_uid, email=new.email, display_name=new.display_name
    )
    created = await spaces_service.ensure_personal_space(session, user.id, data.timezone)
    set_session_cookie(response, settings, new.cookie)
    logger.info(
        "session_created", extra={"user_id": str(user.id), "personal_space_created": created}
    )


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    request: Request, response: Response, settings: SettingsDep, firebase: FirebaseDep
) -> None:
    """Log out everywhere: revoke the user's sessions in Firebase and clear the cookie.

    Every device of the user is logged out, not only this one. Always 204, even if there was no
    session, the cookie was not valid or Firebase could not be reached (that failure is logged as
    an error): the cookie is cleared in every case, so logging out never leaves the user stuck.
    """
    # No database session on purpose: logging out holds no connection of the small pool.
    await service.end_session(firebase, read_session_cookie(request, settings))
    clear_session_cookie(response, settings)
