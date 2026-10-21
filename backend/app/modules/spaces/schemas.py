import uuid
from typing import Literal

from app.core.schemas import PatchModel, ReadModel, unset
from app.modules.currencies.schemas import CurrencyCode, CurrencyRead


class SpaceMemberRead(ReadModel):
    space_id: uuid.UUID
    user_id: uuid.UUID
    role: Literal["owner", "member"]


class SpaceBase(ReadModel):
    """A space as the service of `spaces` knows it, for the router and for other modules.

    It has no `currency_locked`: whether the space has transactions belongs to `transactions`, a
    later module, so the router adds it and answers with `SpaceRead`.
    """

    id: uuid.UUID
    name: str
    type: Literal["personal", "household"]
    currency: CurrencyRead
    timezone: str


class SpaceRead(SpaceBase):
    """What the API answers: the space and whether its currency can still be changed.

    `currency_locked` is true once the space has any transaction (pending, skipped or deleted
    included): from then on `PATCH /spaces/{id}` refuses a different currency with a 409. It is
    the same rule, asked the same way (`transactions.service.space_has_transactions`).
    """

    currency_locked: bool


class SpaceUpdate(PatchModel):
    """Fields to change: only the ones sent are updated. Only the currency can be changed so far."""

    # Format only; that the currency is supported and that the space has no transactions are
    # checked by the service. It cannot be cleared, so it is not `| None` (see `PatchModel`).
    currency: CurrencyCode = unset()
