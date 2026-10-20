import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.categories import service
from app.modules.categories.models import Category
from app.modules.categories.schemas import CategoryCreate, CategoryRead, CategoryUpdate
from app.modules.spaces.dependencies import require_space_member

router = APIRouter(
    prefix="/spaces/{space_id}/categories",
    tags=["categories"],
    dependencies=[Depends(require_space_member)],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)


@router.get("", status_code=status.HTTP_200_OK, response_model=list[CategoryRead])
async def list_categories(
    space_id: uuid.UUID,
    session: DbSession,
    include_archived: Annotated[bool, Query()] = False,
) -> list[Category]:
    """The categories of the space, principal and sub, flat, in creation order.

    The archived ones only with `include_archived`. A subcategory points at its principal with
    `parent_id`.
    """
    return await service.list_categories(session, space_id, include_archived=include_archived)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=CategoryRead,
    responses={409: {"model": ErrorResponse}},
)
async def create_category(
    space_id: uuid.UUID, data: CategoryCreate, session: DbSession
) -> Category:
    """Create a principal category, or a subcategory when `parent_id` is sent.

    A subcategory has the kind of its principal category, which must be active and cannot be a
    subcategory itself (422). The name must be new among its siblings, archived ones included
    (409).
    """
    return await service.create_category(session, space_id, data)


@router.patch(
    "/{category_id}",
    status_code=status.HTTP_200_OK,
    response_model=CategoryRead,
    responses={409: {"model": ErrorResponse}},
)
async def update_category(
    space_id: uuid.UUID, category_id: uuid.UUID, data: CategoryUpdate, session: DbSession
) -> Category:
    """Rename a category or change its icon. The kind and the parent cannot be changed."""
    return await service.update_category(session, space_id, category_id, data)


@router.post("/{category_id}/archive", status_code=status.HTTP_200_OK, response_model=CategoryRead)
async def archive_category(
    space_id: uuid.UUID, category_id: uuid.UUID, session: DbSession
) -> Category:
    """Archive a category, and with it the active subcategories of a principal one.

    It is no longer offered for new movements; the old ones keep it. Archiving an archived
    category changes nothing.
    """
    return await service.archive_category(session, space_id, category_id)


@router.post(
    "/{category_id}/unarchive",
    status_code=status.HTTP_200_OK,
    response_model=CategoryRead,
    responses={409: {"model": ErrorResponse}},
)
async def unarchive_category(
    space_id: uuid.UUID, category_id: uuid.UUID, session: DbSession
) -> Category:
    """Make a category active again, and the subcategories that were archived with a principal one.

    A subcategory whose principal category is archived cannot be unarchived (409).
    """
    return await service.unarchive_category(session, space_id, category_id)
