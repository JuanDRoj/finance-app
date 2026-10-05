from pydantic import Field

from app.core.schemas import InputModel, Timezone


class SessionCreate(InputModel):
    """Body of `POST /auth/session`."""

    # A Firebase ID token is a JWT of 1-2 KB; the cap only keeps absurd bodies out.
    id_token: str = Field(min_length=1, max_length=8192)
    # The browser's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`): the timezone of the
    # personal space created on the first login.
    timezone: Timezone
