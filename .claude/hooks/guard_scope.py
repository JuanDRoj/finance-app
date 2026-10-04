#!/usr/bin/env python3
"""
guard_scope.py — Hook PreToolUse (Edit|Write|Bash) que limita QUÉ archivos puede
crear, editar o borrar un agente.

Se declara en el frontmatter de cada subagente (y en /tarea para la sesión
principal), pasando como argumentos las rutas permitidas (relativas a la raíz):

    python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/guard_scope.py" backend/ docs/notes/

Formato de cada ruta:
  - termina en "/"  → carpeta: permite todo lo que haya dentro   (backend/)
  - con * o ?       → patrón glob; "*" también cruza carpetas    (frontend/*.test.ts)
  - otro            → archivo exacto                              (Dockerfile)

Opciones:
  --main-only  → solo actúa en la sesión principal; dentro de un subagente no
                 objeta nada (lo usa /tarea para el orquestador).

Qué revisa:
  - Edit/Write/NotebookEdit: el archivo debe estar dentro de las rutas permitidas.
  - Bash (heurístico): los comandos que escriben o borran (rm, mv, cp, sed -i,
    tee, redirecciones >, touch, mkdir, find -delete…) solo pueden apuntar a
    rutas permitidas. En subagentes, además, solo se permite git de lectura.
    No detecta escrituras hechas desde programas (python -c, node -e, npm run…).
    Las rutas fuera del repositorio no se revisan aquí: las controla el sistema
    de permisos de Claude Code.
Solo usa la librería estándar de Python.
"""

import fnmatch
import json
import os
import re
import sys


def decide(decision: str, reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": f"[guard_scope] {reason}",
        }
    }))
    sys.exit(0)


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from shell_utils import SHELLS, program_index, shell_inline_command, split_segments, strip_heredocs, tokenize
except Exception as exc:  # un hook que no arranca dejaría pasar todo: mejor bloquear
    decide("deny", f"No se pudo cargar shell_utils ({exc!r}); acción bloqueada por seguridad.")

FILE_TOOLS = {"Edit", "Write", "NotebookEdit", "MultiEdit"}

# git de solo lectura que un subagente puede usar.
READ_ONLY_GIT = {"status", "diff", "log", "show", "blame", "ls-files", "rev-parse", "grep",
                 "describe", "shortlog", "cat-file"}
BRANCH_WRITE_FLAGS = {"-d", "-D", "-m", "-M", "-c", "-C", "-f", "--delete", "--move", "--copy",
                      "--force", "-u", "--set-upstream-to", "--unset-upstream"}
BRANCH_LIST_FLAGS = {"--list", "-l", "--show-current", "--contains", "--merged", "--no-merged"}

REDIRECT_OUT = {">", ">>", ">|", "&>", "&>>"}
REDIRECT_OTHER = {"<", "<<", "<<<", "<<-", ">&", "<&", "<>"}
# Un heredoc que alimenta a un shell sí ejecuta su cuerpo: ese no se quita.
FEEDS_SHELL = re.compile(r"\b(bash|sh|zsh|dash)\b")


def allowed(rel_path: str, rules: list[str], allow_ancestors: bool = False) -> bool:
    """¿rel_path está dentro de las rutas permitidas? allow_ancestors: también sus carpetas padre (mkdir -p)."""
    for rule in rules:
        if rule.endswith("/"):
            if rel_path.startswith(rule) or rel_path + "/" == rule:
                return True
        elif any(ch in rule for ch in "*?["):
            if fnmatch.fnmatch(rel_path, rule):
                return True
        elif rel_path == rule:
            return True
        if allow_ancestors and rule.startswith(rel_path + "/"):
            return True
    return False


def split_redirects(tokens: list[str]) -> tuple[list[str], list[str]]:
    """Separa los argumentos del comando de los archivos que reciben una redirección de salida."""
    args, targets, i = [], [], 0
    while i < len(tokens):
        token = tokens[i]
        if token in REDIRECT_OUT or token in REDIRECT_OTHER:
            if args and args[-1].isdigit():
                args.pop()  # descriptor: el "2" de 2>/dev/null
            if token in REDIRECT_OUT and i + 1 < len(tokens):
                targets.append(tokens[i + 1])
            i += 2
            continue
        args.append(token)
        i += 1
    return args, targets


def flag_value(args: list[str], names: tuple[str, ...]) -> str | None:
    for i, arg in enumerate(args):
        if arg in names and i + 1 < len(args):
            return args[i + 1]
        for name in names:
            if name.startswith("--") and arg.startswith(name + "="):
                return arg.split("=", 1)[1]
    return None


def sed_files(args: list[str]) -> list[str]:
    """Archivos de un `sed -i`: los posicionales, menos el script si no vino con -e/-f."""
    positional, has_script_flag, i = [], False, 0
    while i < len(args):
        arg = args[i]
        if arg in ("-e", "--expression", "-f", "--file"):
            has_script_flag = True
            i += 2
            continue
        if arg.startswith(("--expression=", "--file=")):
            has_script_flag = True
        elif not arg.startswith("-"):
            positional.append(arg)
        i += 1
    return positional if has_script_flag else positional[1:]


def write_targets(name: str, args: list[str]) -> list[tuple[str, str]]:
    """(ruta, tipo) que un comando crea, modifica o borra. tipo: "mkdir" o "write"."""
    plain = [a for a in args if not a.startswith("-")]
    if name in ("rm", "rmdir", "touch", "unlink", "shred", "tee"):
        return [(a, "write") for a in plain]
    if name == "mkdir":
        return [(a, "mkdir") for a in plain]
    if name == "truncate":
        size = flag_value(args, ("-s", "--size"))
        return [(a, "write") for a in plain if a != size]
    if name in ("mv", "cp", "install", "rsync", "ln"):
        target_dir = flag_value(args, ("-t", "--target-directory"))
        if name == "mv":  # mover también "borra" el origen
            return [(a, "write") for a in plain]
        if target_dir:
            return [(target_dir, "write")]
        return [(plain[-1], "write")] if len(plain) >= 2 else []
    if name in ("chmod", "chown", "chgrp"):
        return [(a, "write") for a in plain[1:]]
    if name == "sed" and any(a == "--in-place" or a.startswith("--in-place=") or re.match(r"^-[a-zA-Z]*i", a)
                             for a in args):
        return [(a, "write") for a in sed_files(args)]
    if name == "dd":
        return [(a[3:], "write") for a in args if a.startswith("of=")]
    if name == "find":
        deletes = "-delete" in args or any(
            a in ("-exec", "-execdir", "-ok") and i + 1 < len(args) and os.path.basename(args[i + 1]) in ("rm", "mv")
            for i, a in enumerate(args)
        )
        if deletes:
            roots = []
            for a in args:
                if a.startswith("-") or a in ("(", "!", ")"):
                    break
                roots.append(a)
            return [(r, "write") for r in roots or ["."]]
    return []


class ScopeGuard:
    def __init__(self, data: dict, rules: list[str], main_only: bool):
        self.rules = rules
        self.main_only = main_only
        self.cwd = data.get("cwd") or "."
        self.project_dir = os.path.realpath(os.environ.get("CLAUDE_PROJECT_DIR") or self.cwd)
        self.is_subagent = bool(data.get("agent_id"))
        agent = data.get("agent_type")
        self.who = f"`{agent}`" if agent else ("La sesión principal (orquestador)" if main_only else "Este agente")
        self.denies: list[str] = []
        self.asks: list[str] = []

    def rel(self, path: str, cwd: str) -> str:
        abs_path = os.path.realpath(os.path.join(cwd, os.path.expanduser(path)))
        return os.path.relpath(abs_path, self.project_dir).replace(os.sep, "/")

    def rules_text(self) -> str:
        return ", ".join(self.rules) if self.rules else "ninguna (solo lectura)"

    # --- Edit / Write ---------------------------------------------------------

    def check_file_tool(self, tool_input: dict) -> None:
        file_path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        if not file_path:
            return
        rel_path = self.rel(file_path, self.cwd)
        if rel_path.startswith("../") or rel_path == "..":
            if not self.main_only:  # el orquestador puede usar scratchpad y memoria
                self.denies.append(f"'{file_path}' está fuera del repositorio.")
        elif not self.rules:
            self.denies.append(f"{self.who} no tiene rutas permitidas configuradas.")
        elif not allowed(rel_path, self.rules):
            self.denies.append(
                f"{self.who} no puede editar '{rel_path}'. Rutas permitidas: {self.rules_text()}. "
                "Si el cambio es necesario, repórtalo al orquestador como sugerencia."
            )

    # --- Bash -----------------------------------------------------------------

    def check_bash(self, command: str, cwd: str, depth: int = 0) -> None:
        text = strip_heredocs(command, unless=FEEDS_SHELL)
        cur = cwd
        for segment in split_segments(text):
            args, redirect_targets = split_redirects(tokenize(segment))
            for target in redirect_targets:
                self.check_target(target, cur, "write")
            p = program_index(args)
            if p is None:
                continue
            name, rest = os.path.basename(args[p]), args[p + 1:]
            if name == "cd":
                target = next((a for a in rest if not a.startswith("-")), "~")
                if not re.search(r"[$`]", target):
                    cur = os.path.realpath(os.path.join(cur, os.path.expanduser(target)))
                continue
            if name == "git":
                if self.is_subagent:
                    self.check_git(rest)
                continue
            if name in SHELLS and depth < 3:
                inline = shell_inline_command(rest)
                if inline:
                    self.check_bash(inline, cur, depth + 1)
                continue
            for target, kind in write_targets(name, rest):
                self.check_target(target, cur, kind)

    def check_target(self, token: str, cwd: str, kind: str) -> None:
        if not token or token.startswith("/dev/"):
            return
        if re.search(r"[$`]", token):
            self.asks.append(f"{self.who} escribe o borra en `{token}`: no puedo verificar si está en su alcance.")
            return
        path = token
        glob = re.search(r"[*?\[]", path)
        if glob:  # `rm frontend/*.ts` → se revisa la carpeta frontend
            path = os.path.dirname(path[:glob.start()]) or "."
        rel_path = self.rel(path, cwd)
        if rel_path == ".." or rel_path.startswith("../"):
            return  # fuera del repo: lo decide el sistema de permisos de Claude Code
        if rel_path != "." and allowed(rel_path, self.rules, allow_ancestors=(kind == "mkdir")):
            return
        shown = "la raíz del repositorio" if rel_path == "." else f"'{rel_path}'"
        self.denies.append(
            f"{self.who} no puede escribir ni borrar {shown} con Bash. Rutas permitidas: {self.rules_text()}. "
            "Si el cambio es necesario, repórtalo al orquestador como sugerencia."
        )

    def check_git(self, args: list[str]) -> None:
        i = 0
        while i < len(args):
            if args[i] in ("-C", "-c", "--git-dir", "--work-tree", "--namespace"):
                i += 2
            elif args[i].startswith("-"):
                i += 1
            else:
                break
        if i >= len(args):
            return
        sub, rest = args[i], args[i + 1:]
        if self.git_read_only(sub, rest):
            return
        self.denies.append(
            f"{self.who} solo puede usar git de lectura (status, diff, log, show). "
            f"`git {sub}` lo maneja el orquestador."
        )

    @staticmethod
    def git_read_only(sub: str, rest: list[str]) -> bool:
        if sub in READ_ONLY_GIT:
            return True
        if sub == "branch":
            if BRANCH_WRITE_FLAGS & set(rest):
                return False
            return all(a.startswith("-") for a in rest) or bool(BRANCH_LIST_FLAGS & set(rest))
        if sub == "remote":
            return rest in ([], ["-v"], ["--verbose"]) or rest[:1] == ["get-url"]
        if sub == "config":
            return bool({"--get", "--get-all", "--get-regexp", "--list", "-l"} & set(rest))
        if sub == "stash":
            return rest[:1] in (["list"], ["show"])
        return False


def main() -> None:
    argv = sys.argv[1:]
    main_only = "--main-only" in argv
    rules = [a for a in argv if a != "--main-only"]
    try:
        data = json.load(sys.stdin)
    except Exception:
        decide("deny", "No se pudo leer la petición del hook; acción bloqueada por seguridad.")

    if main_only and data.get("agent_id"):
        sys.exit(0)  # dentro de un subagente: lo controla su propio hook

    guard = ScopeGuard(data, rules, main_only)
    tool = data.get("tool_name")
    tool_input = data.get("tool_input", {}) or {}
    try:
        if tool in FILE_TOOLS:
            guard.check_file_tool(tool_input)
        elif tool == "Bash":
            guard.check_bash(tool_input.get("command", "") or "", guard.cwd)
    except Exception as exc:
        decide("ask", f"El hook de alcance tuvo un error ({exc!r}); revisa la acción con cuidado.")

    if guard.denies:
        decide("deny", guard.denies[0])
    if guard.asks:
        decide("ask", "\n".join(dict.fromkeys(guard.asks)))
    sys.exit(0)


if __name__ == "__main__":
    main()
