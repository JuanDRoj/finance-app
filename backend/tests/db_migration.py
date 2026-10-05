"""Brings the shared test database to the latest migration (used by `migrated_test_database`)."""

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from alembic.util.exc import CommandError
from sqlalchemy.engine import URL

from app.core.config import get_settings


def upgrade_test_database(
    url: URL,
    alembic_ini: Path,
    upgrade: Callable[[Config, str], Any] = command.upgrade,
) -> None:
    """Run `alembic upgrade head` on `url`; fail with recovery commands if it cannot.

    `upgrade` is a parameter so the failure path can be tested without a broken database.
    """
    patch = pytest.MonkeyPatch()  # the autouse fixture is per-test; this one outlives it
    patch.setenv("DATABASE_URL", url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    try:
        upgrade(Config(str(alembic_ini)), "head")
    except CommandError as exc:
        name = url.database
        pytest.fail(
            f"Cannot migrate {name}: {exc}\n"
            "It is probably at a revision that does not exist on this branch. Recreate it:\n"
            f"  docker compose exec postgres dropdb -U finance {name}\n"
            f"  docker compose exec postgres createdb -U finance {name}",
            pytrace=False,
        )
    finally:
        patch.undo()
        get_settings.cache_clear()
