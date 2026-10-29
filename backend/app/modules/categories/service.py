import uuid
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InvalidFieldError, NotFoundError
from app.modules.categories import repository
from app.modules.categories.defaults import DEFAULT_CATEGORIES
from app.modules.categories.models import Category
from app.modules.categories.schemas import (
    CATEGORY_KIND_MISMATCH,
    CATEGORY_PARENT_ARCHIVED,
    CATEGORY_PARENT_NOT_FOUND,
    CATEGORY_PARENT_NOT_MAIN,
    CategoryCreate,
    CategoryRead,
    CategoryUpdate,
)

# Names of the unique indexes behind "this name is already taken among its siblings".
NAME_TAKEN_CONSTRAINTS = frozenset({"uq_categories_main_name", "uq_categories_sub_name"})

# Callers (the router) are already known to belong to the space: `require_space_member` ran first.
# Every query still filters by `space_id`, so an id from another space is a plain "not found".


async def seed_default_categories(session: AsyncSession, space_id: uuid.UUID) -> bool:
    """Give a new space its predefined categories; True if this call wrote them.

    Idempotent. A space that already has any category, archived or not, is left alone (nothing is
    ever deleted, so "none" means it was never seeded). If two seeds of the same space overlap,
    the unique name indexes make the second one skip every row, and it attaches the subcategories
    to the principal categories that are really there, so there are no duplicates and no broken
    parents. Ids are generated in list order: that is the order the API lists them in.
    """
    if await repository.has_any(session, space_id=space_id):
        return False
    mains = [
        {
            "id": uuid.uuid7(),
            "space_id": space_id,
            "parent_id": None,
            "name": main.name,
            "kind": main.kind,
            "icon": main.icon,
        }
        for main in DEFAULT_CATEGORIES
    ]
    inserted = await repository.insert_ignoring_duplicates(session, mains)
    parent_ids = await repository.main_ids_by_kind_and_name(session, space_id=space_id)
    subs = [
        {
            "id": uuid.uuid7(),
            "space_id": space_id,
            "parent_id": parent_ids[(main.kind, main.name.lower())],
            "name": sub.name,
            "kind": main.kind,
            "icon": sub.icon,
        }
        for main in DEFAULT_CATEGORIES
        for sub in main.children
    ]
    await repository.insert_ignoring_duplicates(session, subs)
    return inserted > 0


async def list_categories(
    session: AsyncSession, space_id: uuid.UUID, *, include_archived: bool = False
) -> list[Category]:
    """The categories of the space in creation order. Archived ones only with `include_archived`."""
    return await repository.list_for_space(
        session, space_id=space_id, include_archived=include_archived
    )


async def list_category_reads(
    session: AsyncSession, space_id: uuid.UUID, *, include_archived: bool = False
) -> list[CategoryRead]:
    """Like `list_categories`, as schemas: what other modules use (never ORM objects)."""
    categories = await list_categories(session, space_id, include_archived=include_archived)
    return [CategoryRead.model_validate(c) for c in categories]


async def category_ids_with_subcategories(
    session: AsyncSession, space_id: uuid.UUID, category_id: uuid.UUID
) -> list[uuid.UUID]:
    """The ids that "this category" stands for in a filter: itself and, if it is a main category,
    its subcategories (archived ones too: old movements keep their category).

    Empty if the category does not exist or is in another space, so a filter on it matches
    nothing instead of failing.
    """
    return await repository.ids_with_subcategories(
        session, space_id=space_id, category_id=category_id
    )


async def create_category(
    session: AsyncSession, space_id: uuid.UUID, data: CategoryCreate
) -> Category:
    """Create a principal category, or a subcategory when `data.parent_id` is set.

    The parent must be an active principal category of the same space and kind (so there is no
    third level); the database enforces the same structure with a composite foreign key. A parent
    from another space gives the same error as one that does not exist. The parent is read
    `FOR SHARE`, so an archive of it running at the same time cannot leave this subcategory active
    under an archived principal (see `archive_category`).
    """
    if data.parent_id is not None:
        await _check_parent(session, space_id, data.parent_id, data.kind)
    category = Category(
        space_id=space_id,
        parent_id=data.parent_id,
        name=data.name,
        kind=data.kind,
        icon=data.icon,
    )
    # RETURNING loads the id and the server defaults; the commit happens when the request ends.
    await _flush_checking_the_name(session, category)
    return category


async def update_category(
    session: AsyncSession, space_id: uuid.UUID, category_id: uuid.UUID, data: CategoryUpdate
) -> Category:
    """Apply only the fields that were sent. The kind and the parent cannot change."""
    category = await _get_or_raise(session, space_id, category_id)
    changes = data.model_dump(exclude_unset=True)
    if not changes:
        return category
    # The UPDATE leaves `updated_at` (its `onupdate`) expired. `CategoryRead` does not expose it; if
    # it ever does, reading it in async raises MissingGreenlet, so use `eager_defaults=True` on
    # the model or `session.refresh(category)` here.
    await _flush_checking_the_name(session, category, changes)
    return category


async def archive_category(
    session: AsyncSession, space_id: uuid.UUID, category_id: uuid.UUID
) -> Category:
    """Archive a category. A principal one takes its active subcategories with it.

    All of them get the same `archived_at`, which is how `unarchive_category` later tells the
    subcategories archived together from the ones archived on their own. Archiving an archived
    category changes nothing. Old transactions keep their category: it is only hidden from new ones.

    Order matters. The principal row is updated (flushed) **before** the cascade: that UPDATE takes
    the row lock that `create_category` and `unarchive_category` wait for when they read the
    principal `FOR SHARE`. They either finish first, and the cascade (a later statement, so in READ
    COMMITTED it sees their commit) archives their subcategory too, or they wait for this archive
    and then see the principal archived and refuse. Either way no subcategory stays active under an
    archived principal.

    The category is read `FOR NO KEY UPDATE` (the lock its own UPDATE takes anyway), so two archives
    of the same category at the same time (a double tap) are serialised: the second one waits, finds
    it archived and returns it as it is. Without the lock it would overwrite `archived_at` with its
    own moment while the subcategories keep the first one, and unarchiving the principal would no
    longer bring them back.
    """
    category = await _get_for_update_or_raise(session, space_id, category_id)
    if category.archived_at is not None:
        return category
    moment = datetime.now(UTC)
    category.archived_at = moment
    await session.flush()  # first the principal, then the cascade: see the docstring
    if category.parent_id is None:
        await repository.archive_active_subcategories(
            session, space_id=space_id, parent_id=category.id, archived_at=moment
        )
    return category


async def unarchive_category(
    session: AsyncSession, space_id: uuid.UUID, category_id: uuid.UUID
) -> Category:
    """Make a category active again. A principal one restores the subcategories archived with it.

    A subcategory cannot come back while its principal category is archived (409). The principal
    is read `FOR SHARE`, so an archive of it running at the same time either waits for this
    unarchive (and its cascade then archives the subcategory again) or goes first (and this one
    gets the 409). Unarchiving an active category changes nothing.
    """
    category = await _get_or_raise(session, space_id, category_id)
    moment = category.archived_at
    if moment is None:
        return category
    if category.parent_id is not None:
        parent = await repository.get_for_share(
            session, space_id=space_id, category_id=category.parent_id
        )
        if parent is None:  # not reachable: the composite foreign key guarantees the parent
            raise NotFoundError("category_not_found", "Category not found")
        if parent.archived_at is not None:
            raise ConflictError(CATEGORY_PARENT_ARCHIVED, "The parent category is archived")
    category.archived_at = None
    await session.flush()
    if category.parent_id is None:
        await repository.unarchive_subcategories_archived_at(
            session, space_id=space_id, parent_id=category.id, archived_at=moment
        )
    return category


async def get_category(
    session: AsyncSession, space_id: uuid.UUID, category_id: uuid.UUID
) -> CategoryRead:
    """For the router and other modules: a schema, never the ORM object. Archived ones too."""
    return CategoryRead.model_validate(await _get_or_raise(session, space_id, category_id))


async def _get_or_raise(
    session: AsyncSession, space_id: uuid.UUID, category_id: uuid.UUID
) -> Category:
    category = await repository.get(session, space_id=space_id, category_id=category_id)
    if category is None:
        raise NotFoundError("category_not_found", "Category not found")
    return category


async def _get_for_update_or_raise(
    session: AsyncSession, space_id: uuid.UUID, category_id: uuid.UUID
) -> Category:
    category = await repository.get_for_update(session, space_id=space_id, category_id=category_id)
    if category is None:
        raise NotFoundError("category_not_found", "Category not found")
    return category


async def _check_parent(
    session: AsyncSession, space_id: uuid.UUID, parent_id: uuid.UUID, kind: str
) -> None:
    # FOR SHARE: the check "is the parent active?" must still hold when the subcategory is written.
    parent = await repository.get_for_share(session, space_id=space_id, category_id=parent_id)
    if parent is None:
        raise InvalidFieldError(
            ("body", "parent_id"), CATEGORY_PARENT_NOT_FOUND, "Parent category not found"
        )
    if parent.parent_id is not None:
        raise InvalidFieldError(
            ("body", "parent_id"),
            CATEGORY_PARENT_NOT_MAIN,
            "A subcategory cannot have subcategories",
        )
    if parent.kind != kind:
        raise InvalidFieldError(
            ("body", "kind"),
            CATEGORY_KIND_MISMATCH,
            "A subcategory must have the same kind as its parent",
        )
    if parent.archived_at is not None:
        raise InvalidFieldError(
            ("body", "parent_id"), CATEGORY_PARENT_ARCHIVED, "The parent category is archived"
        )


async def _flush_checking_the_name(
    session: AsyncSession, category: Category, changes: dict[str, object] | None = None
) -> None:
    """Write the new or changed category; a taken name becomes a `ConflictError` (409).

    It runs in a savepoint so a clash leaves the request's transaction (and the session) usable:
    the savepoint rollback also drops the new object, or reloads the changed one.
    """
    try:
        async with session.begin_nested():
            if changes is None:
                session.add(category)
            else:
                for field, value in changes.items():
                    setattr(category, field, value)
            await session.flush()
    except IntegrityError as exc:
        if _violated_constraint(exc) in NAME_TAKEN_CONSTRAINTS:
            raise ConflictError(
                "category_name_taken", "A category with this name already exists"
            ) from exc
        raise


def _violated_constraint(exc: IntegrityError) -> str | None:
    """The name of the constraint a database error violated (asyncpg keeps it on the error)."""
    for error in (exc.orig, getattr(exc.orig, "__cause__", None)):
        name = getattr(error, "constraint_name", None)
        if isinstance(name, str):
            return name
    return None
