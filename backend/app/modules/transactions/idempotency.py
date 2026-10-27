"""Pure pieces of `Idempotency-Key`: how long a key counts and what "the same request" means.

No session and no database here (like `entries.py`), so both are tested without a database.
"""

import hashlib
import json
from datetime import timedelta

from app.modules.transactions.schemas import MovementCreate

# How long a key is remembered. After that, the same key is a new request and replaces the old row.
IDEMPOTENCY_KEY_TTL = timedelta(hours=24)


def request_fingerprint(data: MovementCreate) -> bytes:
    """The sha256 (32 bytes) of the validated body, to tell "the same request" from another.

    It is computed from the model, not from the bytes of the request, so what does not change the
    movement does not change the fingerprint: the order of the fields, the spaces of the JSON, the
    case of a UUID, a description with spaces around it, an omitted description versus a null one.
    Every field takes part (the type included), so any real difference is another request. The JSON
    is canonical: sorted keys, no spaces, UTF-8.
    """
    canonical = json.dumps(
        data.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode()).digest()
