"""The fingerprint of a movement body: what `Idempotency-Key` compares to spot a different request.

It is computed from the validated model, not from the bytes of the request, so two spellings of the
same movement are the same request and any real difference is another one.
"""

import uuid
from datetime import timedelta
from typing import Any

import pytest
from pydantic import TypeAdapter

from app.modules.transactions.idempotency import IDEMPOTENCY_KEY_TTL, request_fingerprint
from app.modules.transactions.schemas import MovementCreate

adapter: TypeAdapter[Any] = TypeAdapter(MovementCreate)
ACCOUNT = uuid.UUID("0199a000-0000-7000-8000-000000000001")
OTHER_ACCOUNT = uuid.UUID("0199a000-0000-7000-8000-000000000002")
CATEGORY = uuid.UUID("0199a000-0000-7000-8000-0000000000c1")


def _expense(**changes: Any) -> dict[str, Any]:
    return {
        "type": "expense",
        "date": "2026-10-20",
        "account_id": str(ACCOUNT),
        "category_id": str(CATEGORY),
        "amount_minor": 1550,
        "description": "Súper",
        **changes,
    }


def _fingerprint(body: dict[str, Any]) -> bytes:
    return request_fingerprint(adapter.validate_python(body))


def test_the_ttl_is_24_hours() -> None:
    assert timedelta(hours=24) == IDEMPOTENCY_KEY_TTL


def test_the_fingerprint_is_a_sha256_digest_and_is_stable() -> None:
    first = _fingerprint(_expense())

    assert len(first) == 32
    assert first == _fingerprint(_expense())


def test_the_order_of_the_fields_does_not_matter() -> None:
    reordered = dict(reversed(list(_expense().items())))

    assert _fingerprint(reordered) == _fingerprint(_expense())


def test_the_case_of_a_uuid_does_not_matter() -> None:
    shouted = _expense(account_id=str(ACCOUNT).upper(), category_id=str(CATEGORY).upper())

    assert _fingerprint(shouted) == _fingerprint(_expense())


def test_a_description_is_compared_trimmed() -> None:
    assert _fingerprint(_expense(description="  Súper ")) == _fingerprint(_expense())


def test_an_omitted_description_is_the_same_as_a_null_one() -> None:
    omitted = _expense()
    del omitted["description"]

    assert _fingerprint(omitted) == _fingerprint(_expense(description=None))


@pytest.mark.parametrize(
    "changes",
    [
        {"amount_minor": 1551},
        {"date": "2026-10-21"},
        {"account_id": str(OTHER_ACCOUNT)},
        {"category_id": str(OTHER_ACCOUNT)},
        {"description": "Súper 2"},
        {"description": None},
    ],
    ids=["amount", "date", "account", "category", "description", "no-description"],
)
def test_any_real_difference_changes_the_fingerprint(changes: dict[str, Any]) -> None:
    assert _fingerprint(_expense(**changes)) != _fingerprint(_expense())


def test_the_type_is_part_of_the_fingerprint() -> None:
    assert _fingerprint(_expense(type="income")) != _fingerprint(_expense())


def test_a_transfer_is_fingerprinted_by_both_of_its_accounts() -> None:
    transfer = {
        "type": "transfer",
        "date": "2026-10-20",
        "from_account_id": str(ACCOUNT),
        "to_account_id": str(OTHER_ACCOUNT),
        "amount_minor": 3_000,
    }
    swapped = {**transfer, "from_account_id": str(OTHER_ACCOUNT), "to_account_id": str(ACCOUNT)}

    assert _fingerprint(transfer) != _fingerprint(swapped)
