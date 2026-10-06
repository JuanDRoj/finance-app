import uuid
from typing import Literal

from app.core.schemas import ReadModel
from app.modules.currencies.schemas import CurrencyRead


class SpaceMemberRead(ReadModel):
    space_id: uuid.UUID
    user_id: uuid.UUID
    role: Literal["owner", "member"]


class SpaceRead(ReadModel):
    id: uuid.UUID
    name: str
    type: Literal["personal", "household"]
    currency: CurrencyRead
    timezone: str
