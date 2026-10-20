import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Category(Base):
    """Principal category (`parent_id` is null) or its subcategory: two levels, no more.

    The database itself enforces the structure with one composite foreign key. A subcategory
    references `(id, space_id, kind, is_main)` of its parent through `(parent_id, space_id, kind,
    has_parent)`, so its parent must be in the same space, have the same kind and be a principal
    category (`is_main`): a third level is rejected. `is_main` and `has_parent` are generated from
    `parent_id` and never written. A principal category has no parent, so the foreign key (MATCH
    SIMPLE) is not checked for it.

    Names are unique among siblings, ignoring case and including the archived ones
    (`uq_categories_main_name`, `uq_categories_sub_name`). Foreign keys to other modules go by
    table name.
    """

    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint("kind IN ('expense', 'income')", name="kind"),
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        CheckConstraint("char_length(name) <= 80", name="name_length"),
        # Only the shape of the key: the list of icons lives in the API (`icons.py`).
        CheckConstraint(
            "icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(icon) <= 40", name="icon_format"
        ),
        # Target of the composite foreign key below (PostgreSQL needs a unique key to point at).
        UniqueConstraint("id", "space_id", "kind", "is_main"),
        ForeignKeyConstraint(
            ["parent_id", "space_id", "kind", "has_parent"],
            ["categories.id", "categories.space_id", "categories.kind", "categories.is_main"],
            ondelete="RESTRICT",
        ),
        Index(
            "uq_categories_main_name",
            "space_id",
            "kind",
            func.lower(text("name")),
            unique=True,
            postgresql_where=text("parent_id IS NULL"),
        ),
        Index(
            "uq_categories_sub_name",
            "parent_id",
            func.lower(text("name")),
            unique=True,
            postgresql_where=text("parent_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    # RESTRICT: a space with categories cannot be deleted by a cascade.
    space_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("spaces.id", ondelete="RESTRICT"), index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column()
    name: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    icon: Mapped[str] = mapped_column(Text)
    is_main: Mapped[bool] = mapped_column(Boolean, Computed("parent_id IS NULL", persisted=True))
    has_parent: Mapped[bool] = mapped_column(
        Boolean, Computed("parent_id IS NOT NULL", persisted=True)
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
