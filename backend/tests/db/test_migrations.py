import asyncio
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

BACKEND_DIR = Path(__file__).resolve().parents[2]

PROBE_REVISION = """\
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "probe",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("probe")
"""


def _config(script_location: Path | None = None) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(script_location or BACKEND_DIR / "migrations"))
    return config


@pytest.fixture
def probe_scripts(tmp_path: Path) -> Path:
    """The real env.py and template next to a throwaway revision that creates one table."""
    scripts = tmp_path / "migrations"
    (scripts / "versions").mkdir(parents=True)
    for name in ("env.py", "script.py.mako"):
        shutil.copy(BACKEND_DIR / "migrations" / name, scripts / name)
    (scripts / "versions" / "0001_probe.py").write_text(PROBE_REVISION, encoding="utf-8")
    return scripts


async def _query(url: str, sql: str) -> list[str]:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as conn:
            return [str(v) for v in (await conn.execute(text(sql))).scalars().all()]
    finally:
        await engine.dispose()


_USER_TABLES = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"


async def test_upgrade_head_then_downgrade_base_work_on_an_empty_database(
    scratch_database_url: str,
) -> None:
    # alembic's env.py calls asyncio.run(), which cannot run inside this test's event loop.
    await asyncio.to_thread(command.upgrade, _config(), "head")
    await asyncio.to_thread(command.downgrade, _config(), "base")

    leftovers = set(await _query(scratch_database_url, _USER_TABLES)) - {"alembic_version"}
    assert leftovers == set()


async def test_env_py_applies_the_naming_convention_and_reverts_cleanly(
    scratch_database_url: str, probe_scripts: Path
) -> None:
    config = _config(probe_scripts)

    await asyncio.to_thread(command.upgrade, config, "head")
    assert "probe" in await _query(scratch_database_url, _USER_TABLES)
    # Unnamed in the revision: the name comes from Base.metadata via env.py's target_metadata.
    constraints = await _query(
        scratch_database_url, "SELECT conname FROM pg_constraint WHERE conrelid = 'probe'::regclass"
    )
    assert constraints == ["pk_probe"]
    assert await _query(scratch_database_url, "SELECT version_num FROM alembic_version") == ["0001"]

    await asyncio.to_thread(command.downgrade, config, "base")
    assert "probe" not in await _query(scratch_database_url, _USER_TABLES)
    assert await _query(scratch_database_url, "SELECT version_num FROM alembic_version") == []


async def test_alembic_cli_upgrades_and_downgrades_from_the_backend_directory(
    scratch_database_url: str,
) -> None:
    env = {**os.environ, "DATABASE_URL": scratch_database_url}

    def run(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(  # noqa: S603
            [sys.executable, "-m", "alembic", *args],
            cwd=BACKEND_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )

    upgrade = await asyncio.to_thread(run, "upgrade", "head")
    assert upgrade.returncode == 0, upgrade.stderr
    downgrade = await asyncio.to_thread(run, "downgrade", "base")
    assert downgrade.returncode == 0, downgrade.stderr

    # The CLI keeps the project's JSON logging instead of alembic's own log config.
    lines = [line for line in upgrade.stdout.splitlines() if line.strip()]
    assert lines, "alembic should log at INFO"
    assert all(json.loads(line)["logger"] for line in lines)
