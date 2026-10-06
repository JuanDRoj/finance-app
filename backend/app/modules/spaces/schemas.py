import uuid
from typing import Literal

from app.core.schemas import ReadModel


class SpaceMemberRead(ReadModel):
    space_id: uuid.UUID
    user_id: uuid.UUID
    role: Literal["owner", "member"]
