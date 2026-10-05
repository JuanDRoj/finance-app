import uuid

from app.core.schemas import ReadModel


class UserRead(ReadModel):
    id: uuid.UUID
    email: str
    display_name: str | None
