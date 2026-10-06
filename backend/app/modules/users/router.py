from fastapi import APIRouter, status

from app.core.errors import ErrorResponse
from app.modules.auth.dependencies import CurrentUser
from app.modules.users.schemas import UserRead

router = APIRouter(tags=["users"], responses={401: {"model": ErrorResponse}})


@router.get("/me", status_code=status.HTTP_200_OK)
async def read_me(user: CurrentUser) -> UserRead:
    """The logged-in user."""
    return user
