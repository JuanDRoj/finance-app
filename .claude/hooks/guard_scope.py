#!/usr/bin/env python3
"""
guard_scope.py — Hook PreToolUse (Edit|Write) para subagentes de Claude Code.

Limita QUÉ archivos puede crear o editar un agente. Se declara en el
frontmatter de cada agente, pasando como argumentos las rutas permitidas
(relativas a la raíz del repo):

    python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/guard_scope.py" backend/ docs/notes/

Formato de cada argumento:
  - termina en "/"  → carpeta: permite todo lo que haya dentro   (backend/)
  - con * o ?       → patrón glob; "*" también cruza carpetas    (frontend/*.test.ts)
  - otro            → archivo exacto                              (Dockerfile)

Si el archivo no coincide con ninguna ruta permitida, la edición se bloquea.
Solo usa la librería estándar de Python.
"""

import fnmatch
import json
import os
import sys


def decide_deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": f"[guard_scope] {reason}",
        }
    }))
    sys.exit(0)


def allowed(rel_path: str, rules: list[str]) -> bool:
    for rule in rules:
        if rule.endswith("/"):
            if rel_path.startswith(rule):
                return True
        elif any(ch in rule for ch in "*?["):
            if fnmatch.fnmatch(rel_path, rule):
                return True
        elif rel_path == rule:
            return True
    return False


def main() -> None:
    rules = sys.argv[1:]
    try:
        data = json.load(sys.stdin)
    except Exception:
        decide_deny("No se pudo leer la petición del hook; edición bloqueada por seguridad.")

    tool_input = data.get("tool_input", {}) or {}
    file_path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not file_path:
        sys.exit(0)  # la herramienta no edita un archivo concreto

    project_dir = os.path.realpath(os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or ".")
    abs_path = os.path.realpath(os.path.join(data.get("cwd") or project_dir, file_path))
    rel_path = os.path.relpath(abs_path, project_dir).replace(os.sep, "/")

    if rel_path.startswith("../") or rel_path == "..":
        decide_deny(f"'{file_path}' está fuera del repositorio.")

    agent = data.get("agent_type") or "este agente"
    if not rules:
        decide_deny(f"{agent} no tiene rutas permitidas configuradas.")

    if not allowed(rel_path, rules):
        decide_deny(
            f"{agent} no puede editar '{rel_path}'. Rutas permitidas: {', '.join(rules)}. "
            "Si el cambio es necesario, repórtalo al orquestador como sugerencia."
        )

    sys.exit(0)


if __name__ == "__main__":
    main()