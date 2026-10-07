"""The wait that the emulator tests use before logging out (no emulator needed)."""

import time

import pytest

from tests.emulator.helpers import (
    CLOCK_STEP_MARGIN_SECONDS,
    session_cookie_iat,
    wait_until_revocable,
)
from tests.fakes import unsigned_id_token


def _cookie(iat: int) -> str:
    # The emulator's session cookie is an unsigned JWT like this one.
    return unsigned_id_token(iat=iat)


def test_the_iat_is_read_from_the_cookie() -> None:
    assert session_cookie_iat(_cookie(1_700_000_000)) == 1_700_000_000


async def test_a_cookie_issued_long_ago_needs_no_wait() -> None:
    started = time.monotonic()

    await wait_until_revocable(_cookie(int(time.time()) - 10))

    assert time.monotonic() - started < 0.2


async def test_the_wait_ends_in_a_later_second_than_the_newest_cookie() -> None:
    now = int(time.time())

    await wait_until_revocable(_cookie(now - 30), _cookie(now))  # the older one does not matter

    assert time.time() >= now + 1 + CLOCK_STEP_MARGIN_SECONDS


async def test_a_cookie_from_the_future_fails_with_a_clear_message_instead_of_hanging() -> None:
    started = time.monotonic()

    with pytest.raises(AssertionError, match="out of step"):
        await wait_until_revocable(_cookie(int(time.time()) + 3600))

    assert time.monotonic() - started < 0.2
