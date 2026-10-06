"""Fixtures shared by the tests that use the real Firebase Auth emulator."""

import os
import socket
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator

import pytest
from fastapi import FastAPI

from app.core.config import LOCAL_FIREBASE_EMULATOR_HOST, Settings
from app.modules.auth.dependencies import get_firebase_auth
from app.modules.auth.firebase import FirebaseAdminAuth, create_firebase_auth
from tests.emulator.helpers import EmulatorAccount, delete_account, sign_up, unique_email


@pytest.fixture(scope="session")
def emulator_host() -> str:
    host = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST") or LOCAL_FIREBASE_EMULATOR_HOST
    name, _, port = host.partition(":")
    try:
        socket.create_connection((name, int(port)), timeout=2).close()
    except OSError:
        pytest.fail(
            f"The Firebase Auth emulator is not reachable at {host}. "
            "Start it with `docker compose up -d` from the repo root (see README).",
            pytrace=False,
        )
    return host


@pytest.fixture
def real_firebase(
    app: FastAPI, emulator_host: str, monkeypatch: pytest.MonkeyPatch
) -> Iterator[FirebaseAdminAuth]:
    # Set through monkeypatch so that the variable `create_firebase_auth` writes is undone.
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", emulator_host)
    adapter = create_firebase_auth(Settings(_env_file=None))
    app.dependency_overrides[get_firebase_auth] = lambda: adapter
    try:
        yield adapter
    finally:
        adapter.close()


@pytest.fixture
async def emulator_user(
    emulator_host: str,
) -> AsyncIterator[Callable[..., Awaitable[EmulatorAccount]]]:
    """Factory of accounts in the emulator, each deleted (only that one) when the test ends."""
    created: list[EmulatorAccount] = []

    async def create(display_name: str = "Eva E2E") -> EmulatorAccount:
        account = await sign_up(emulator_host, unique_email(), display_name)
        created.append(account)
        return account

    try:
        yield create
    finally:
        for account in created:
            await delete_account(emulator_host, account)
