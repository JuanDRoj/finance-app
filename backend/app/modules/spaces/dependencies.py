import uuid
from typing import Annotated

from fastapi import Depends

from app.core.db import DbSession
from app.modules.auth.dependencies import CurrentUser
from app.modules.spaces import service
from app.modules.spaces.schemas import SpaceMemberRead


async def require_space_member(
    space_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> SpaceMemberRead:
    """404 unless the logged-in user belongs to the space of the path (never 403).

    Declare it on the `APIRouter` of every `/spaces/{space_id}/...` route. An endpoint that needs
    the role declares it again as a parameter (`SpaceMember`); FastAPI resolves it once.
    """
    return await service.require_member(session, space_id, user.id)


SpaceMember = Annotated[SpaceMemberRead, Depends(require_space_member)]
