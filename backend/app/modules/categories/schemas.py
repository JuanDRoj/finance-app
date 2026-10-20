import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import StringConstraints

from app.core.schemas import InputModel, PatchModel, ReadModel, unset
from app.modules.categories.icons import CategoryIcon

CategoryKind = Literal["expense", "income"]

# Trimmed before the length check, so a name of only spaces is as empty as "". The 80 is also a
# CHECK in the database (`ck_categories_name_length`).
CategoryName = Annotated[
    str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=80)
]

# Stable error types raised by the service: the frontend translates them.
CATEGORY_PARENT_NOT_FOUND = "category_parent_not_found"
CATEGORY_PARENT_NOT_MAIN = "category_parent_not_main"
CATEGORY_PARENT_ARCHIVED = "category_parent_archived"
CATEGORY_KIND_MISMATCH = "category_kind_mismatch"


class CategoryCreate(InputModel):
    """A principal category, or a subcategory when `parent_id` is sent.

    A subcategory must have the kind of its principal category, which cannot itself be a
    subcategory. Those rules depend on stored data, so the service checks them.
    """

    name: CategoryName
    kind: CategoryKind
    icon: CategoryIcon
    parent_id: uuid.UUID | None = None


class CategoryUpdate(PatchModel):
    """Fields to change: only the ones sent are updated. The kind and the parent never change."""

    # Neither field can be cleared, so none is `| None`; read this model with
    # `model_dump(exclude_unset=True)` (see `PatchModel`).
    name: CategoryName = unset()
    icon: CategoryIcon = unset()


class CategoryRead(ReadModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    kind: CategoryKind
    icon: CategoryIcon
    archived_at: datetime | None
