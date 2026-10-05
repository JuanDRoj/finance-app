import os
from pathlib import Path
from typing import Any

import pytest
from alembic.util.exc import CommandError
from sqlalchemy.engine import make_url

from tests.db_migration import upgrade_test_database

URL = make_url("postgresql+asyncpg://finance:secret@localhost:5432/finance_test")
ALEMBIC_INI = Path("alembic.ini")


def test_unknown_revision_fails_with_the_commands_to_recreate_the_database() -> None:
    def broken_upgrade(config: Any, revision: str) -> None:
        raise CommandError("Can't locate revision identified by '0099'")

    with pytest.raises(pytest.fail.Exception) as exc:
        upgrade_test_database(URL, ALEMBIC_INI, upgrade=broken_upgrade)

    message = str(exc.value)
    assert "finance_test" in message
    assert "Can't locate revision" in message
    assert "dropdb -U finance finance_test" in message
    assert "createdb -U finance finance_test" in message
    assert "secret" not in message


def test_upgrade_runs_to_head_against_the_given_database_and_restores_the_environment() -> None:
    seen: dict[str, Any] = {}

    def fake_upgrade(config: Any, revision: str) -> None:
        seen["revision"] = revision
        seen["database_url"] = os.environ["DATABASE_URL"]

    before = os.environ.get("DATABASE_URL")
    upgrade_test_database(URL, ALEMBIC_INI, upgrade=fake_upgrade)

    assert seen["revision"] == "head"
    assert seen["database_url"].endswith("/finance_test")
    assert os.environ.get("DATABASE_URL") == before


def test_errors_other_than_an_unknown_revision_are_not_swallowed() -> None:
    def boom(config: Any, revision: str) -> None:
        raise RuntimeError("database is down")

    with pytest.raises(RuntimeError):
        upgrade_test_database(URL, ALEMBIC_INI, upgrade=boom)
