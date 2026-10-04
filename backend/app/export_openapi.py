"""Write the API contract (`openapi.json`) without starting the server.

    uv run python -m app.export_openapi [-o PATH]

The frontend generates its TypeScript types from this file, and it is committed to the repo.
Importing the app builds no settings and no engine (both live in the lifespan, which never runs
here), so the export needs neither a database nor any environment variable. Keep it that way:
do not call `get_settings()` or create an engine at import time in a router or a model.
"""

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from fastapi import FastAPI

from app.main import create_app

# Anchored to this file, not to the cwd: backend/openapi.json wherever the command is run from.
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "openapi.json"


def render_openapi(app: FastAPI) -> str:
    """Deterministic JSON: sorted keys, 2-space indent, UTF-8 text, one trailing newline."""
    return json.dumps(app.openapi(), sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.export_openapi",
        description="Write the OpenAPI schema of the API without starting the server.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="file to write (default: backend/openapi.json); its directory must already exist",
    )
    args = parser.parse_args(argv)

    # Render first so a failure never truncates an existing file.
    text = render_openapi(create_app())
    # newline="\n": never translate line endings, so the bytes are the same on every platform.
    args.output.write_text(text, encoding="utf-8", newline="\n")
    print(f"OpenAPI schema written to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
