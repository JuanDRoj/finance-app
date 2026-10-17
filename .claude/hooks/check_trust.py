#!/usr/bin/env python3
"""
check_trust.py — Hook SessionStart para Claude Code.

Avisa al humano (y a Claude) de dos problemas del entorno que no se ven en
pantalla. No bloquea nada. Solo usa la librería estándar de Python.

1. Confianza: los hooks del frontmatter de los subagentes (guard_scope) solo
   corren si este repositorio está marcado como confiable en ~/.claude.json
   (projects["<raíz del repo>"].hasTrustDialogAccepted). Si solo se confió en
   una carpeta padre, o se usa `claude -p`, no corren.
2. `frontend/.env.local`: sin él, `npm run dev` y `npm run build` del frontend
   fallan, y los agentes no pueden crearlo (las reglas deny de `.env*` también
   bloquean crear el archivo). Es el paso 1 del README y lo hace el humano.
   Solo se comprueba que el archivo exista: nunca se lee.
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


def trust_warning(root: str) -> str | None:
    path = config_file()
    if not path:
        return None  # no se puede verificar: mejor no hacer ruido
    try:
        with open(path, encoding="utf-8") as fh:
            projects = json.load(fh).get("projects", {})
    except Exception:
        return None
    if (projects.get(root) or {}).get("hasTrustDialogAccepted") is True:
        return None
    return (
        f"{root} no está marcado como confiable en Claude Code: los hooks de los subagentes "
        "(guard_scope) NO van a correr. Abre Claude Code en la raíz del repo y acepta el diálogo de "
        f"confianza, o pon projects[\"{root}\"].hasTrustDialogAccepted en true en {path}."
    )


def frontend_env_missing(root: str) -> bool:
    # Solo en este repo (existe la plantilla) y sin abrir el archivo.
    frontend = os.path.join(root, "frontend")
    return (os.path.isfile(os.path.join(frontend, ".env.example"))
            and not os.path.exists(os.path.join(frontend, ".env.local")))


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    start = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    root = os.path.realpath(repo_root(start))

    messages = []  # (para el humano, para Claude)
    trust = trust_warning(root)
    if trust:
        messages.append((trust, trust + " No delegues tareas que editen código hasta que el humano lo resuelva."))
    if frontend_env_missing(root):
        env = (
            "Falta frontend/.env.local: sin él, `npm run dev` y `npm run build` del frontend fallan. "
            "Es el paso 1 del README y lo hace el humano: cp frontend/.env.example frontend/.env.local"
        )
        messages.append((env, env + " Los agentes no pueden crearlo (reglas deny de .env*): pídeselo al humano."))
    if not messages:
        sys.exit(0)

    print(json.dumps({
        "systemMessage": "\n".join(human for human, _ in messages),
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": " ".join(context for _, context in messages),
        },
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()
