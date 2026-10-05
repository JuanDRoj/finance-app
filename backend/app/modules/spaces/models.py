import uuid
from datetime import datetime

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Space(Base):
    """Owner of all the data. Foreign keys to other modules go by table name."""

    __tablename__ = "spaces"
    __table_args__ = (
        CheckConstraint("type IN ('personal', 'household')", name="type"),
        # At most one personal space per creator ("Mi espacio"); households are unlimited.
        Index(
            "uq_spaces_created_by_personal",
            "created_by",
            unique=True,
            postgresql_where=text("type = 'personal'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    name: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(
        CHAR(3), ForeignKey("currencies.code", ondelete="RESTRICT")
    )
    timezone: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SpaceMember(Base):
    """Who can access which space (one owner per space in v1)."""

    __tablename__ = "space_members"
    __table_args__ = (CheckConstraint("role IN ('owner', 'member')", name="role"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    space_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
