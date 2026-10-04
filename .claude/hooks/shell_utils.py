#!/usr/bin/env python3
"""
shell_utils.py — Utilidades compartidas por los hooks guard_cloud y guard_scope.

Parte un comando de shell en segmentos (&&, ||, ;, |, &, saltos de línea) y en
tokens, respetando comillas. Es un análisis heurístico, no un intérprete de
bash: cubre las formas habituales en que un agente escribe comandos, no todas.
Solo usa la librería estándar de Python.
"""

import os
import re
import shlex

HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")
ENV_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
DURATION = re.compile(r"^\d+(\.\d+)?[smhd]?$")

SHELLS = {"bash", "sh", "zsh", "dash"}
# Programas que solo envuelven a otro comando: `timeout 10 cmd`, `env X=1 cmd`…
WRAPPERS = {"timeout", "nice", "nohup", "env", "command", "time", "exec", "xargs", "stdbuf"}
# Palabras de control y agrupación que preceden al programa real.
KEYWORDS = {"(", ")", "{", "}", "!", "$", "if", "then", "else", "elif", "do", "while", "until"}


def strip_heredocs(text: str, only_if: re.Pattern | None = None, unless: re.Pattern | None = None) -> str:
    """Quita el cuerpo de los heredocs (<<EOF … EOF): es texto, no comandos.

    only_if: solo se quita si la línea que abre el heredoc coincide (ej. `git commit`).
    unless:  se conserva si la línea coincide (ej. `bash <<EOF`, que sí ejecuta el cuerpo).
    """
    lines = text.split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        i += 1
        match = HEREDOC.search(line)
        if not match:
            continue
        if (only_if and not only_if.search(line)) or (unless and unless.search(line)):
            continue
        delimiter = match.group(2)
        while i < len(lines) and lines[i].strip() != delimiter:
            i += 1
        i += 1  # salta la línea del delimitador
    return "\n".join(out)


def split_segments(text: str) -> list[str]:
    """Parte un comando por &&, ||, ;, |, & y saltos de línea, fuera de comillas."""
    text = text.replace("\\\n", " ")
    segments, buf, quote = [], [], None
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if quote:
            buf.append(c)
            if c == "\\" and quote == '"' and i + 1 < n:
                buf.append(text[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
            buf.append(c)
        elif c == "\\" and i + 1 < n:
            buf.append(text[i:i + 2])
            i += 2
            continue
        elif text.startswith(("&&", "||"), i):
            segments.append("".join(buf))
            buf = []
            i += 2
            continue
        elif c in ";|\n" or (c == "&" and not _amp_in_redirect(text, i)):
            segments.append("".join(buf))
            buf = []
        else:
            buf.append(c)
        i += 1
    segments.append("".join(buf))
    return [s.strip() for s in segments if s.strip()]


def _amp_in_redirect(text: str, i: int) -> bool:
    """`&` que forma parte de una redirección (2>&1, &>archivo), no un separador."""
    prev = text[i - 1] if i > 0 else ""
    nxt = text[i + 1] if i + 1 < len(text) else ""
    return prev in "<>" or nxt == ">"


def tokenize(segment: str) -> list[str]:
    """Tokens de un segmento, sin comillas y con las redirecciones separadas (>, >>, 2>&1…)."""
    try:
        lexer = shlex.shlex(segment, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        return list(lexer)
    except ValueError:  # comillas sin cerrar
        return segment.split()


def program_index(tokens: list[str]) -> int | None:
    """Índice del programa que ejecuta el segmento, saltando VAR=valor, envoltorios y palabras de control."""
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if ENV_ASSIGN.match(token) or token in KEYWORDS:
            i += 1
        elif os.path.basename(token) in WRAPPERS:
            i += 1
            while i < len(tokens) and (tokens[i].startswith("-") or DURATION.match(tokens[i])):
                i += 1
        else:
            return i
    return None


def shell_inline_command(args: list[str]) -> str | None:
    """Para `bash -c "<cmd>"` (o -lc, -ec…), devuelve <cmd>; si no hay -c, None."""
    for i, arg in enumerate(args):
        if arg.startswith("-") and not arg.startswith("--") and "c" in arg[1:]:
            return args[i + 1] if i + 1 < len(args) else None
    return None
