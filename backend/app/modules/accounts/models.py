import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    SmallInteger,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Account(Base):
    """Bank, cash or credit card of a space. Foreign keys to other modules go by table name.

    The balance is not stored: it is the sum of the entries of the account (module `transactions`).
    `closing_day` and `due_day` exist only on credit cards, and both are required there.
    """

    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint("type IN ('bank', 'cash', 'credit_card')", name="type"),
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        CheckConstraint("char_length(name) <= 80", name="name_length"),
        # NULL passes a range check; `card_days` is what decides when the days must be present.
        CheckConstraint("closing_day BETWEEN 1 AND 31", name="closing_day_range"),
        CheckConstraint("due_day BETWEEN 1 AND 31", name="due_day_range"),
        CheckConstraint(
            "(type = 'credit_card' AND closing_day IS NOT NULL AND due_day IS NOT NULL) "
            "OR (type <> 'credit_card' AND closing_day IS NULL AND due_day IS NULL)",
            name="card_days",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    # RESTRICT: money data must never disappear through a cascade from its space.
    space_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("spaces.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text)
    closing_day: Mapped[int | None] = mapped_column(SmallInteger)
    due_day: Mapped[int | None] = mapped_column(SmallInteger)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
