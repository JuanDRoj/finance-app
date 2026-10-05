"""Enforces the module rules of docs/arquitectura-backend.md (section 2) by reading the AST.

`find_violations` is a pure function over a source tree, so each rule is tested against small
synthetic trees and then run once against the real `app/`.
"""

import ast
from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parents[2] / "app"

# Bottom to top. Modules on the same level must not call each other either.
ORDER: list[set[str]] = [
    {"users", "auth"},
    {"currencies"},
    {"spaces"},
    {"accounts", "categories"},
    {"transactions"},
    {"recurring", "budgets", "goals"},
    {"dashboard"},
]
LEVEL = {name: level for level, names in enumerate(ORDER) for name in names}

# What another module may expose: its service and schemas, plus dependencies (routers only).
PUBLIC_PARTS = {"service", "schemas", "dependencies"}
MODULES_PREFIX = ("app", "modules")


def scanned_modules(app_dir: Path) -> set[str]:
    modules = app_dir / "modules"
    if not modules.is_dir():
        return set()
    return {p.name for p in modules.iterdir() if p.is_dir() and p.name != "__pycache__"}


def _package_of(app_dir: Path, file: Path) -> list[str]:
    """Dotted package of `file` as parts, e.g. ['app', 'modules', 'spaces']."""
    return ["app", *file.relative_to(app_dir).parent.parts]


def _imports(tree: ast.AST, package: list[str]) -> list[tuple[int, list[str]]]:
    """Every import as (line, absolute dotted parts). `from x import y` yields x.y."""
    found: list[tuple[int, list[str]]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend((node.lineno, alias.name.split(".")) for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = package[: len(package) - (node.level - 1)]
                module = [*base, *(node.module.split(".") if node.module else [])]
            else:
                module = node.module.split(".") if node.module else []
            found.extend((node.lineno, [*module, alias.name]) for alias in node.names)
    return found


def _target(parts: list[str]) -> tuple[str, str | None] | None:
    """(module, part) when the import points into app.modules.<module>[.<part>]."""
    if tuple(parts[:2]) != MODULES_PREFIX or len(parts) < 3:
        return None
    return parts[2], parts[3] if len(parts) > 3 else None


HTTP_NAMES = {"HTTPException", "Request"}


def _is_http_framework(dotted: str | None) -> bool:
    return dotted is not None and dotted.split(".")[0] in {"fastapi", "starlette"}


def _dotted(node: ast.expr) -> str | None:
    """`a.b.c` as 'a.b.c' for a chain of names and attributes, else None."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _dotted(node.value)
        return None if base is None else f"{base}.{node.attr}"
    return None


def find_violations(app_dir: Path) -> list[str]:
    violations: list[str] = []

    for module in sorted(scanned_modules(app_dir)):
        if module not in LEVEL:
            violations.append(
                f"modules/{module}: not in ORDER (tests/unit/test_module_boundaries.py); "
                "decide its level and add it"
            )

    files = sorted(app_dir.rglob("*.py"))
    for file in files:
        relative = file.relative_to(app_dir)
        rel = relative.as_posix()
        in_core = relative.parts[0] == "core"
        own = (
            relative.parts[1]
            if relative.parts[0] == "modules" and len(relative.parts) > 2
            else None
        )
        if not (in_core or own):
            continue
        tree = ast.parse(file.read_text(), filename=str(file))
        is_router = file.name == "router.py"
        is_layer = own is not None and file.name in {"service.py", "repository.py"}
        seen: set[tuple[int, str]] = set()

        def report(
            line: int, message: str, rel: str = rel, seen: set[tuple[int, str]] = seen
        ) -> None:
            if (line, message) not in seen:
                seen.add((line, message))
                violations.append(f"{rel}:{line}: {message}")

        for line, parts in _imports(tree, _package_of(app_dir, file)):
            if in_core and parts[:2] == list(MODULES_PREFIX):
                report(line, "app/core must not import app.modules")
            if parts in (["app"], list(MODULES_PREFIX)) and own is not None:
                # `import app`, `import app.modules`, `from app import modules`: with the bare
                # package in hand, `modules.x.repository` slips past the rules by attribute.
                report(line, "imports app.modules without naming a module")
            elif parts == ["app"]:
                report(line, "imports the bare app package")
            target = _target(parts)
            if target is None or own is None or target[0] == own:
                continue
            other, part = target
            if part is None:
                # `import app.modules.x` / `from app.modules import x`: the package itself
                # would let `x.repository.f()` slip past the rule by attribute access.
                report(line, f"imports the {other} package; import its service or schemas")
            elif part not in PUBLIC_PARTS:
                report(line, f"imports {other}.{part}; only service/schemas/dependencies allowed")
            elif part == "dependencies" and not is_router:
                report(line, f"imports {other}.dependencies outside a router")
            if not is_router and LEVEL.get(other, -1) >= LEVEL.get(own, 99):
                report(
                    line, f"{own} must not import {other} (same or later level) outside a router"
                )

        if is_layer:
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Attribute)
                    and node.attr in {"commit", "rollback"}
                    and isinstance(node.ctx, ast.Load)
                ):
                    report(node.lineno, f"{file.name} must not call {node.attr}()")
                if (
                    isinstance(node, ast.ImportFrom)
                    and _is_http_framework(node.module)
                    and HTTP_NAMES & {a.name for a in node.names}
                ):
                    report(node.lineno, "service/repository must not know HTTP")
                if (
                    isinstance(node, ast.Attribute)
                    and node.attr in HTTP_NAMES
                    and _is_http_framework(_dotted(node.value))
                ):
                    report(node.lineno, "service/repository must not know HTTP")
    return violations


def _write(root: Path, relative: str, source: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source)


def _tree(tmp_path: Path, files: dict[str, str]) -> Path:
    app = tmp_path / "app"
    for relative, source in files.items():
        _write(app, relative, source)
    return app


def test_real_app_respects_module_boundaries() -> None:
    assert find_violations(APP_DIR) == []


def test_real_app_scan_is_not_vacuous() -> None:
    assert "currencies" in scanned_modules(APP_DIR)


def test_module_may_import_its_own_internals(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/currencies/service.py": "from app.modules.currencies import repository\n",
            "modules/currencies/repository.py": "",
        },
    )
    assert find_violations(app) == []


@pytest.mark.parametrize("target", ["repository", "models"])
def test_other_module_repository_and_models_are_forbidden(tmp_path: Path, target: str) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/currencies/models.py": "",
            "modules/currencies/repository.py": "",
            "modules/spaces/service.py": f"from app.modules.currencies.{target} import X\n",
        },
    )
    violations = find_violations(app)
    assert len(violations) == 1
    assert "spaces/service.py:1" in violations[0]


def test_import_of_a_forbidden_submodule_by_name_is_detected(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/currencies/repository.py": "",
            "modules/spaces/service.py": "from app.modules.currencies import repository\n",
        },
    )
    assert len(find_violations(app)) == 1


def test_plain_import_statement_is_detected(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/currencies/models.py": "",
            "modules/spaces/service.py": "import app.modules.currencies.models\n",
        },
    )
    assert len(find_violations(app)) == 1


def test_relative_import_of_another_module_is_detected(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/currencies/models.py": "",
            "modules/spaces/service.py": "from ..currencies import models\n",
        },
    )
    assert len(find_violations(app)) == 1


def test_service_and_schemas_of_an_earlier_module_are_allowed(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/currencies/service.py": "",
            "modules/currencies/schemas.py": "",
            "modules/spaces/service.py": (
                "from app.modules.currencies import service\n"
                "from app.modules.currencies.schemas import CurrencyRead\n"
            ),
        },
    )
    assert find_violations(app) == []


def test_service_cannot_import_a_later_module(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/currencies/service.py": "from app.modules.spaces import service\n",
            "modules/spaces/service.py": "",
        },
    )
    assert len(find_violations(app)) == 1


def test_modules_on_the_same_level_cannot_import_each_other(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/accounts/service.py": "from app.modules.categories import service\n",
            "modules/categories/service.py": "",
        },
    )
    assert len(find_violations(app)) == 1


def test_router_may_combine_later_modules_and_use_their_dependencies(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/spaces/router.py": (
                "from app.modules.transactions import service\n"
                "from app.modules.transactions.dependencies import dep\n"
            ),
            "modules/transactions/service.py": "",
            "modules/transactions/dependencies.py": "",
        },
    )
    assert find_violations(app) == []


def test_dependencies_of_another_module_are_only_for_routers(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/spaces/dependencies.py": "",
            "modules/accounts/service.py": "from app.modules.spaces.dependencies import dep\n",
        },
    )
    assert len(find_violations(app)) == 1


def test_router_still_cannot_import_another_modules_repository(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/transactions/repository.py": "",
            "modules/spaces/router.py": "from app.modules.transactions import repository\n",
        },
    )
    assert len(find_violations(app)) == 1


def test_unknown_module_must_be_added_to_the_order(tmp_path: Path) -> None:
    app = _tree(tmp_path, {"modules/mystery/service.py": ""})
    violations = find_violations(app)
    assert len(violations) == 1
    assert "mystery" in violations[0]


def test_core_cannot_import_modules(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {
            "core/db.py": "from app.modules.currencies.service import x\n",
            "modules/currencies/service.py": "",
        },
    )
    assert len(find_violations(app)) == 1


@pytest.mark.parametrize("name", ["service", "repository"])
@pytest.mark.parametrize("call", ["session.commit()", "session.rollback()"])
def test_service_and_repository_never_commit_or_roll_back(
    tmp_path: Path, name: str, call: str
) -> None:
    app = _tree(
        tmp_path,
        {f"modules/currencies/{name}.py": f"async def f(session):\n    await {call}\n"},
    )
    violations = find_violations(app)
    assert len(violations) == 1
    assert f"{name}.py:2" in violations[0]


def test_commit_is_allowed_outside_service_and_repository(tmp_path: Path) -> None:
    app = _tree(
        tmp_path,
        {"modules/currencies/seed.py": "async def f(session):\n    await session.commit()\n"},
    )
    assert find_violations(app) == []


@pytest.mark.parametrize(
    "source",
    [
        "from fastapi import HTTPException\n",
        "from fastapi import Request\n",
        "import fastapi\n\nx = fastapi.HTTPException\n",
    ],
)
def test_service_does_not_know_http(tmp_path: Path, source: str) -> None:
    app = _tree(tmp_path, {"modules/currencies/service.py": source})
    assert len(find_violations(app)) == 1


def test_router_may_import_fastapi(tmp_path: Path) -> None:
    app = _tree(
        tmp_path, {"modules/currencies/router.py": "from fastapi import APIRouter, Request\n"}
    )
    assert find_violations(app) == []


@pytest.mark.parametrize(
    "source",
    [
        "import app.modules.currencies\n",
        "from app.modules import currencies\n",
        "from .. import currencies\n",
    ],
)
def test_importing_another_modules_package_is_forbidden(tmp_path: Path, source: str) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/currencies/repository.py": "",
            "modules/spaces/service.py": source,
        },
    )
    violations = find_violations(app)
    assert len(violations) == 1
    assert "spaces/service.py:1" in violations[0]


def test_importing_the_service_of_another_module_by_name_is_still_allowed(
    tmp_path: Path,
) -> None:
    app = _tree(
        tmp_path,
        {
            "modules/currencies/service.py": "",
            "modules/spaces/service.py": "from app.modules import currencies\n",
        },
    )
    # `currencies` here is the package: forbidden. The allowed form names the part.
    assert len(find_violations(app)) == 1
    app = _tree(
        tmp_path / "ok",
        {
            "modules/currencies/service.py": "",
            "modules/spaces/service.py": "from app.modules.currencies import service\n",
        },
    )
    assert find_violations(app) == []


@pytest.mark.parametrize(
    "source",
    [
        "from starlette.requests import Request\n",
        "from starlette.exceptions import HTTPException\n",
        "import starlette.requests\n\nx = starlette.requests.Request\n",
    ],
)
def test_service_does_not_know_starlette_http(tmp_path: Path, source: str) -> None:
    app = _tree(tmp_path, {"modules/currencies/service.py": source})
    assert len(find_violations(app)) == 1


@pytest.mark.parametrize(
    "source",
    [
        "from app import modules\n",
        "import app\n",
        "import app.modules\n",
        "from ... import modules\n",
    ],
)
def test_reaching_app_modules_without_naming_a_module_is_forbidden(
    tmp_path: Path, source: str
) -> None:
    app = _tree(tmp_path, {"modules/spaces/service.py": source})
    violations = find_violations(app)
    assert len(violations) == 1
    assert "spaces/service.py:1" in violations[0]


@pytest.mark.parametrize(
    "source",
    [
        "from app.core.db import DbSession\n",
        "from app import core\n",
        "from ...core import db\n",
        "from . import repository\n",
        "import app.core.db\n",
    ],
)
def test_legitimate_app_imports_inside_a_module_are_allowed(tmp_path: Path, source: str) -> None:
    app = _tree(
        tmp_path,
        {"modules/spaces/service.py": source, "modules/spaces/repository.py": ""},
    )
    assert find_violations(app) == []


def test_core_importing_the_bare_app_package_is_forbidden(tmp_path: Path) -> None:
    app = _tree(tmp_path, {"core/db.py": "import app\n"})
    assert len(find_violations(app)) == 1
