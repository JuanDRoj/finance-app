import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, NoReturn

import pytest
from fastapi import FastAPI

from app.core.db import Database
from app.export_openapi import DEFAULT_OUTPUT, main, render_openapi
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[2]
COMMITTED_OPENAPI = BACKEND_DIR / "openapi.json"


def _fresh_render() -> str:
    # A new app each time: FastAPI caches the schema on the instance, so reusing one app would
    # make any determinism check trivially true.
    return render_openapi(create_app())


def _run_export(cwd: Path, *args: str, hash_seed: int = 0) -> subprocess.CompletedProcess[str]:
    # ENV=prod with no DATABASE_URL: building Settings would fail, so a clean exit proves the
    # export never needs configuration. `_isolated_settings` already cleared the DB variables.
    env = {**os.environ, "ENV": "prod", "PYTHONHASHSEED": str(hash_seed)}
    return subprocess.run(  # noqa: S603
        [sys.executable, "-m", "app.export_openapi", *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def test_render_is_identical_for_two_fresh_apps() -> None:
    assert _fresh_render() == _fresh_render()


def test_render_has_sorted_keys_two_space_indent_and_single_trailing_newline() -> None:
    text = _fresh_render()

    def check_sorted(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        keys = [key for key, _ in pairs]
        assert keys == sorted(keys)
        return dict(pairs)

    json.loads(text, object_pairs_hook=check_sorted)

    assert text.startswith('{\n  "components"')
    # Second nesting level: exactly four spaces, not three or five.
    assert text.splitlines()[2].startswith('    "')
    assert not text.splitlines()[2].startswith("     ")
    assert text.endswith("}\n")
    assert not text.endswith("\n\n")
    assert "\r" not in text


def test_non_ascii_text_is_written_as_utf8_not_escaped(app: FastAPI, tmp_path: Path) -> None:
    @app.get("/summary", summary="Resumen de categorías (ñ)")
    async def _summary() -> dict[str, str]:
        return {}

    text = render_openapi(app)

    assert "Resumen de categorías (ñ)" in text
    assert "\\u00" not in text
    target = tmp_path / "openapi.json"
    target.write_bytes(text.encode("utf-8"))
    assert "Resumen de categorías (ñ)" in target.read_text(encoding="utf-8")


def test_main_writes_rendered_schema_to_the_given_output(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    target = tmp_path / "out.json"

    assert main(["--output", str(target)]) == 0

    assert target.read_bytes() == _fresh_render().encode("utf-8")
    assert b"\r" not in target.read_bytes()
    assert str(target) in capsys.readouterr().out


def test_default_output_is_openapi_json_next_to_the_app_package() -> None:
    assert DEFAULT_OUTPUT == BACKEND_DIR / "openapi.json"


def test_export_never_runs_the_lifespan_or_creates_a_database(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("the export must not touch settings or the database")

    monkeypatch.setattr(Database, "create", forbidden)
    monkeypatch.setattr("app.main.get_settings", forbidden)
    target = tmp_path / "out.json"

    assert main(["--output", str(target)]) == 0
    assert target.is_file()


def test_export_runs_without_env_vars_and_output_does_not_depend_on_hash_seed(
    isolated_backend: Path, tmp_path: Path
) -> None:
    first, second = tmp_path / "seed1.json", tmp_path / "seed2.json"

    run_1 = _run_export(isolated_backend, "--output", str(first), hash_seed=1)
    run_2 = _run_export(isolated_backend, "--output", str(second), hash_seed=2)

    assert run_1.returncode == 0, run_1.stderr
    assert run_2.returncode == 0, run_2.stderr
    assert first.read_bytes() == second.read_bytes()


def test_default_run_writes_openapi_json_inside_the_backend_copy(isolated_backend: Path) -> None:
    real_before = COMMITTED_OPENAPI.read_bytes() if COMMITTED_OPENAPI.exists() else None

    result = _run_export(isolated_backend)

    assert result.returncode == 0, result.stderr
    written = isolated_backend / "openapi.json"
    assert written.read_bytes() == _fresh_render().encode("utf-8")
    # The default path is anchored to the code, so the repo's own file was not the target.
    real_after = COMMITTED_OPENAPI.read_bytes() if COMMITTED_OPENAPI.exists() else None
    assert real_after == real_before


def test_committed_openapi_json_is_up_to_date() -> None:
    hint = (
        "backend/openapi.json is missing or stale: run `uv run python -m app.export_openapi` "
        "from /backend and commit the result (then `npm run gen:api` in /frontend once it exists)"
    )
    assert COMMITTED_OPENAPI.is_file(), hint
    assert COMMITTED_OPENAPI.read_bytes() == _fresh_render().encode("utf-8"), hint
