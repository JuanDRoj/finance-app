from sqlalchemy import CHAR, CheckConstraint, SmallInteger
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Currency(Base):
    """A supported currency and its ISO 4217 exponent (the minor unit is 10^-exponent)."""

    __tablename__ = "currencies"
    __table_args__ = (
        CheckConstraint("code ~ '^[A-Z]{3}$'", name="code_format"),
        CheckConstraint("exponent BETWEEN 0 AND 4", name="exponent_range"),
    )

    code: Mapped[str] = mapped_column(CHAR(3), primary_key=True)
    exponent: Mapped[int] = mapped_column(SmallInteger)
