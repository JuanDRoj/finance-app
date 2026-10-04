#!/usr/bin/env python3
"""
check_trust.py — Hook SessionStart para Claude Code.

Los hooks del frontmatter de los subagentes (guard_scope) solo corren si este
repositorio está marcado como confiable en ~/.claude.json
(projects["<raíz del repo>"].hasTrustDialogAccepted). Si solo se confió en una
carpeta padre, o se usa `claude -p`, no corren y Claude Code no lo muestra en
pantalla. Este hook avisa al humano (y a Claude) cuando pasa. No bloquea nada.
Solo usa la librería estándar de Python.
"""

import json
import os
import subprocess
import sys


def repo_root(start: str) -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                             cwd=start, capture_output=True, text=True, timeout=5)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except Exception:
        pass
    return start


def config_file() -> str | None:
    candidates = []
    if os.environ.get("CLAUDE_CONFIG_DIR"):
        candidates.append(os.path.join(os.environ["CLAUDE_CONFIG_DIR"], ".claude.json"))
    candidates.append(os.path.expanduser("~/.claude.json"))
    return next((c for c in candidates if os.path.isfile(c)), None)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    start = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    root = os.path.realpath(repo_root(start))

    path = config_file()
    if not path:
        sys.exit(0)  # no se puede verificar: mejor no hacer ruido
    try:
        with open(path, encoding="utf-8") as fh:
            projects = json.load(fh).get("projects", {})
    except Exception:
        sys.exit(0)

    if (projects.get(root) or {}).get("hasTrustDialogAccepted") is True:
        sys.exit(0)

    message = (
        f"⚠️ {root} no está marcado como confiable en Claude Code: los hooks de los subagentes "
        "(guard_scope) NO van a correr. Abre Claude Code en la raíz del repo y acepta el diálogo de "
        f"confianza, o pon projects[\"{root}\"].hasTrustDialogAccepted en true en {path}."
    )
    print(json.dumps({
        "systemMessage": message,
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": message + " No delegues tareas que editen código hasta que el humano lo resuelva.",
        },
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()
