#!/usr/bin/env python3
"""
guard_cloud.py — Hook PreToolUse (Bash) para Claude Code.

Revisa cada comando de shell ANTES de que se ejecute y decide:
  - deny  → lo bloquea (el agente recibe el motivo y debe buscar otro camino)
  - ask   → fuerza la pregunta al humano con una advertencia visible
  - nada  → deja que sigan las reglas normales de settings.json

Complementa las reglas de settings.json: aquí se detectan casos que las reglas
por prefijo no ven (comandos encadenados, flags en cualquier posición, scripts).

Además de las reglas de bloqueo y advertencia:
  - Lista blanca de staging: todo `gcloud`/`firebase` debe llevar `--project`
    con un ID definido en infra/env/staging.env (GCP_PROJECT_ID o
    FIREBASE_PROJECT_ID). Otro proyecto o sin `--project` → bloqueado.
    Mientras ese archivo no exista (lo crea KAN-9), pregunta.
  - Scripts: si el comando ejecuta un script del repo (`bash x.sh`, `./x.sh`,
    `source x.sh`), revisa también su contenido y el de lo que cargue con
    `source`. Si el script tiene comandos de nube, pregunta mostrándolos.
Solo usa la librería estándar de Python.
"""

import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True  # sin __pycache__ dentro de .claude/hooks
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from shell_utils import (
        SHELLS,
        program_index,
        shell_inline_command,
        split_segments,
        strip_heredocs,
        tokenize,
    )
except Exception as exc:  # un hook que no arranca dejaría pasar todo: mejor preguntar
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": f"[guard_cloud] No se pudo cargar shell_utils ({exc!r}); revisa el comando con cuidado.",
    }}))
    sys.exit(0)

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

# Herramientas que tocan la nube.
CLOUD_CLIS = r"(gcloud|gsutil|bq|firebase|vercel|terraform)"

# Lista blanca de staging: CLIs que deben llevar --project y de dónde sale el ID.
PROJECT_CLIS = {"gcloud", "firebase"}
STAGING_ENV = "infra/env/staging.env"
PROJECT_KEYS = ("GCP_PROJECT_ID", "FIREBASE_PROJECT_ID")

# Comandos que no actúan sobre un proyecto (no necesitan --project).
GCLOUD_NO_PROJECT = {"auth", "components", "info", "version", "topic", "init", "cheat-sheet", "help"}
GCLOUD_NO_PROJECT_PREFIXES = [["projects", "list"], ["billing", "accounts", "list"], ["organizations", "list"]]
FIREBASE_NO_PROJECT = ("emulators:", "setup:emulators", "login", "logout", "projects:list", "help")

# Subcomandos donde el proyecto va como argumento posicional: (prefijo, posición del ID).
POSITIONAL_PROJECT = [
    (["projects"], 2),                  # gcloud projects create|describe <ID>
    (["config", "set", "project"], 3),  # gcloud config set project <ID>
    (["billing", "projects"], 3),       # gcloud billing projects link <ID>
    (["use"], 1),                       # firebase use <ID>
]

# Gestores de paquetes: en estos subcomandos `firebase` es el nombre de un paquete, no la CLI
# (`npm install firebase`, `npm view firebase version`). exec/x/dlx y npx sí ejecutan la CLI.
PACKAGE_MANAGERS = {"npm", "pnpm", "yarn"}
PACKAGE_SUBCOMMANDS = {
    "view", "info", "show", "v", "install", "i", "ci", "add", "uninstall", "remove", "rm", "un",
    "ls", "list", "search", "outdated", "update", "up", "audit", "why", "explain",
}

MAX_SCRIPT_DEPTH = 3
MAX_SCRIPT_BYTES = 200_000

# "git" seguido de sus opciones globales (-C ruta, -c clave=valor, --opcion) y luego el subcomando.
GIT = r"\bgit\s+(?:-[Cc]\s+\S+\s+|--\S+\s+)*"
# Fin de palabra "estricto": no seguido de letra, dígito, guion o dos puntos.
END = r"(?![\w:-])"

# Cualquier mención a producción en un comando de nube se bloquea (capa extra a la lista blanca).
PROD_MARKERS = [
    r"\bprod\b",
    r"[-_]prod\b",
    r"\bprod[-_]",
    r"\bproduction\b",
    r"--prod\b",  # vercel --prod
]

# Reglas de bloqueo (deny): (regex, motivo)
DENY_RULES = [
    # --- Nube: borrar recursos ---
    (rf"\b{CLOUD_CLIS}\b[^|;&]*\s(delete|destroy|remove|rm){END}",
     "Borrar recursos en la nube está prohibido para los agentes. Si es necesario, propónselo al humano para que lo haga él."),
    (rf"\bgsutil\b[^|;&]*\s(rm|rb){END}",
     "Borrar buckets u objetos de Cloud Storage está prohibido para los agentes."),
    (rf"\bbq\b[^|;&]*\srm{END}",
     "Borrar datasets o tablas de BigQuery está prohibido para los agentes."),
    # --- Nube: llaves JSON de cuentas de servicio (usamos Workload Identity Federation) ---
    (r"\bgcloud\b[^|;&]*\bservice-accounts\s+keys\s+create\b",
     "Crear llaves JSON de cuentas de servicio está prohibido: el proyecto usa Workload Identity Federation."),
    # --- Git ---
    (rf"{GIT}push\b[^|;&]*(\s--force|\s-f{END}|\s\+\S+)",
     "Force push está prohibido."),
    (rf"{GIT}push\b[^|;&]*\s(\S+:)?(refs/heads/)?main(?=\s|$)",
     "Push directo a main está prohibido. Usa una rama y un PR."),
    (rf"{GIT}reset\b[^|;&]*--hard\b",
     "git reset --hard está prohibido (se pierde trabajo sin vuelta atrás)."),
    (rf"{GIT}clean\b[^|;&]*\s-\w*f",
     "git clean -f está prohibido (borra archivos no versionados sin vuelta atrás)."),
    (rf"{GIT}branch\b[^|;&]*\s-D\s+main(?=\s|$)",
     "Borrar la rama main está prohibido."),
    (r"\bgh\b[^|;&]*\bpr\s+merge\b",
     "Mergear PRs lo hace solo el humano en GitHub."),
    (r"\bgh\b[^|;&]*\brepo\s+delete\b",
     "Borrar repositorios está prohibido."),
    # --- Sistema ---
    (r"\bsudo\b",
     "sudo está prohibido para los agentes. Si hace falta instalar algo del sistema, pídeselo al humano."),
    (r"\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*|-r\s+-f|-f\s+-r)\s+(/|~|\$HOME|\.\.?)(\s|/?$|/\*)",
     "rm -rf sobre una ruta raíz, el home o el directorio actual completo está prohibido."),
]

# Reglas de advertencia (ask): se pregunta al humano con un aviso destacado.
ASK_RULES = [
    (r"\bgcloud\b[^|;&]*\b(add-iam-policy-binding|remove-iam-policy-binding|set-iam-policy)\b",
     "CAMBIO DE PERMISOS IAM. Verifica que el proyecto sea staging y que el rol sea el mínimo necesario."),
    (r"\bgcloud\b[^|;&]*\bconfig\s+set\s+project\b",
     "Cambio del proyecto activo de gcloud. Verifica que sea el de staging."),
    (r"\b(alembic)\b[^|;&]*\b(downgrade)\b",
     "Alembic downgrade: revierte migraciones de la base de datos."),
]

# Los heredocs de git/gh (mensajes de commit, cuerpos de PR) son texto, no comandos.
GIT_OR_GH = re.compile(r"\b(git|gh)\b")
VAR_REF = re.compile(r"^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$")


# ---------------------------------------------------------------------------
# Lógica
# ---------------------------------------------------------------------------

def decide(decision: str, reason: str) -> None:
    """Imprime la decisión en el formato que espera Claude Code y termina."""
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": f"[guard_cloud] {reason}",
        }
    }))
    sys.exit(0)


def current_branch(cwd: str) -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=cwd, capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip()
    except Exception:
        return ""


def load_staging_env(project_dir: str) -> dict[str, str] | None:
    """Lee infra/env/staging.env (KEY=valor, sin secretos). None si aún no existe."""
    env: dict[str, str] = {}
    try:
        with open(os.path.join(project_dir, STAGING_ENV), encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                line = line.removeprefix("export ").strip()
                key, value = line.split("=", 1)
                value = value.split(" #", 1)[0].strip().strip("\"'")
                value = re.sub(r"\$\{?(\w+)\}?", lambda m: env.get(m.group(1), m.group(0)), value)
                env[key.strip()] = value
    except FileNotFoundError:
        return None
    return env


def needs_project(cli: str, args: list[str]) -> bool:
    """False para comandos que no actúan sobre un proyecto (auth, versión, emuladores locales…)."""
    if not args or any(a in ("--version", "-v", "-V", "--help", "-h") for a in args[:2]):
        return False
    first = args[0]
    if cli == "gcloud":
        if first == "config":
            return args[1:3] == ["set", "project"]
        if any(args[:len(p)] == p for p in GCLOUD_NO_PROJECT_PREFIXES):
            return False
        return first not in GCLOUD_NO_PROJECT
    return not first.startswith(FIREBASE_NO_PROJECT)


def project_values(cli: str, args: list[str]) -> list[str]:
    """Valores de --project (o -P en firebase), o el ID posicional en `projects create <ID>` y similares."""
    values = []
    for i, arg in enumerate(args):
        if arg == "--project" or (cli == "firebase" and arg == "-P"):
            if i + 1 < len(args):
                values.append(args[i + 1])
        elif arg.startswith("--project="):
            values.append(arg.split("=", 1)[1])
    if values:
        return values
    for prefix, pos in POSITIONAL_PROJECT:
        if args[:len(prefix)] == prefix:
            positional = [a for a in args[pos:] if not a.startswith("-")]
            return positional[:1]
    return []


def is_package_query(tokens: list[str]) -> bool:
    """True para `npm|pnpm|yarn <subcomando de paquetes> …`: los argumentos son paquetes, no comandos."""
    p = program_index(tokens)
    if p is None or os.path.basename(tokens[p]) not in PACKAGE_MANAGERS:
        return False
    sub = next((a for a in tokens[p + 1:] if not a.startswith("-")), None)
    return sub in PACKAGE_SUBCOMMANDS


class Checker:
    def __init__(self, project_dir: str):
        self.project_dir = os.path.realpath(project_dir)
        self.env = load_staging_env(self.project_dir)
        self.allowed = {self.env[k] for k in PROJECT_KEYS if self.env and self.env.get(k)}
        self.denies: list[str] = []
        self.asks: list[str] = []
        self.script_cloud_lines: list[str] = []
        self.visited: set[str] = set()

    # --- recorrido -----------------------------------------------------------

    def check_text(self, text: str, cwd: str, origin: str | None = None,
                   script_dir: str | None = None, depth: int = 0) -> None:
        """Revisa un comando (o el contenido de un script) segmento por segmento."""
        text = strip_heredocs(text, only_if=GIT_OR_GH)
        cur = cwd
        for segment in split_segments(text):
            tokens = tokenize(segment)
            p = program_index(tokens)
            if p is not None and tokens[p] == "cd":  # `cd infra && bash scripts/x.sh`
                target = next((a for a in tokens[p + 1:] if not a.startswith("-")), None)
                if target and not re.search(r"[$`]", target):
                    cur = os.path.realpath(os.path.join(cur, os.path.expanduser(target)))
                continue
            self.check_segment(segment, tokens, cur, origin, script_dir, depth)

    def check_segment(self, seg: str, tokens: list[str], cwd: str, origin: str | None,
                      script_dir: str | None, depth: int) -> None:
        where = f" (en {origin})" if origin else ""
        has_cloud = re.search(rf"\b{CLOUD_CLIS}\b", seg)

        # 1) Producción en cualquier comando de nube
        if has_cloud and any(re.search(m, seg, re.IGNORECASE) for m in PROD_MARKERS):
            self.denies.append(f"El comando menciona producción{where}. Los agentes solo trabajan en staging.")

        # 2) Reglas de bloqueo
        for pattern, reason in DENY_RULES:
            if re.search(pattern, seg):
                self.denies.append(reason + where)

        # 3) `git push` sin destino estando parado en main
        if origin is None and re.search(rf"{GIT}push\b", seg) and current_branch(cwd) == "main":
            self.denies.append("Estás en la rama main: el push iría directo a main. Crea una rama primero.")

        # 4) Reglas de advertencia
        for pattern, reason in ASK_RULES:
            if re.search(pattern, seg):
                self.asks.append(reason + where)

        # 5) Lista blanca de staging
        self.check_projects(tokens, where)
        # 6) Scripts y `bash -c`
        self.check_nested(tokens, cwd, origin, script_dir, depth)

        if origin and has_cloud:
            self.script_cloud_lines.append(f"{origin}: {seg[:140]}")

    def check_projects(self, tokens: list[str], where: str) -> None:
        if is_package_query(tokens):
            return
        for i, token in enumerate(tokens):
            cli = os.path.basename(token)
            if cli not in PROJECT_CLIS:
                continue
            args = tokens[i + 1:]
            if not needs_project(cli, args):
                continue
            values = project_values(cli, args)
            if not values:
                self.denies.append(
                    f"`{cli}` sin `--project` explícito{where}. Toda operación en la nube debe "
                    f"apuntar al proyecto de staging definido en {STAGING_ENV}."
                )
            for value in values:
                project = self.resolve(value)
                if project is None:
                    self.asks.append(f"No puedo verificar el proyecto `{value}`{where}. Confirma que sea staging.")
                elif not self.allowed:
                    self.asks.append(
                        f"Aún no existe {STAGING_ENV} con GCP_PROJECT_ID (lo crea KAN-9). "
                        f"Verifica que `{project}`{where} sea el proyecto de staging."
                    )
                elif project not in self.allowed:
                    self.denies.append(
                        f"El proyecto `{project}`{where} no es el de staging ({', '.join(sorted(self.allowed))})."
                    )

    def resolve(self, value: str) -> str | None:
        """Valor literal, o una variable ($X / ${X}) definida en staging.env. None si no se puede saber."""
        match = VAR_REF.match(value)
        if match:
            return (self.env or {}).get(match.group(1))
        return None if re.search(r"[$`]", value) else value

    def check_nested(self, tokens: list[str], cwd: str, origin: str | None,
                     script_dir: str | None, depth: int) -> None:
        if depth >= MAX_SCRIPT_DEPTH:
            return
        p = program_index(tokens)
        if p is None:
            return
        program, args = tokens[p], tokens[p + 1:]
        name = os.path.basename(program)
        if name in SHELLS:
            inline = shell_inline_command(args)
            if inline is not None:
                self.check_text(inline, cwd, origin, script_dir, depth + 1)
                return
            script = next((a for a in args if not a.startswith("-")), None)
        elif name in ("source", "."):
            script = args[0] if args else None
        elif "/" in program or program.endswith(".sh"):
            script = program
        else:
            return
        if script:
            self.inspect_script(script, cwd, script_dir, depth)

    def inspect_script(self, script: str, cwd: str, script_dir: str | None, depth: int) -> None:
        path = self.resolve_script(script, cwd, script_dir)
        if not path or path in self.visited:
            return
        self.visited.add(path)
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                content = fh.read(MAX_SCRIPT_BYTES)
        except OSError:
            return
        rel = os.path.relpath(path, self.project_dir)
        self.check_text(content, cwd, origin=rel, script_dir=os.path.dirname(path), depth=depth + 1)

    def resolve_script(self, script: str, cwd: str, script_dir: str | None) -> str | None:
        """Ruta real de un script del repo. Prueba relativo a cwd y al directorio del script que lo carga."""
        candidates = []
        if not re.search(r"[$`]", script):
            candidates.append(os.path.join(cwd, os.path.expanduser(script)))
        if script_dir:
            # source "$(dirname "$0")/lib.sh" o "${SCRIPT_DIR}/../env/staging.env"
            rest = re.sub(r"^(\$\{?\w+\}?|\$\(.*?\))/", "", script)
            if not re.search(r"[$`]", rest):
                candidates.append(os.path.join(script_dir, rest))
            candidates.append(os.path.join(script_dir, os.path.basename(script)))
        for candidate in candidates:
            path = os.path.realpath(candidate)
            name = os.path.basename(path)
            if os.path.relpath(path, self.project_dir).startswith(".."):
                continue  # solo scripts del repositorio
            if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
                continue  # nunca leer secretos
            if os.path.isfile(path):
                return path
        return None


def check(command: str, cwd: str, project_dir: str) -> None:
    checker = Checker(project_dir)
    checker.check_text(command, cwd)

    if checker.denies:
        decide("deny", checker.denies[0])

    asks = list(dict.fromkeys(checker.asks))  # sin duplicados, en orden
    if checker.script_cloud_lines:
        lines = checker.script_cloud_lines
        listing = "\n".join(f"  · {line}" for line in lines[:10])
        extra = f"\n  · … y {len(lines) - 10} más" if len(lines) > 10 else ""
        asks.append(f"El script ejecuta {len(lines)} comando(s) de nube:\n{listing}{extra}")
    if asks:
        decide("ask", "\n".join(asks))

    sys.exit(0)  # sin objeciones: siguen las reglas normales de settings.json


def main() -> None:
    try:
        data = json.load(sys.stdin)
        if data.get("tool_name") != "Bash":
            sys.exit(0)
        command = data.get("tool_input", {}).get("command", "") or ""
        cwd = data.get("cwd") or "."
        project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or cwd
        check(command, cwd, project_dir)
    except SystemExit:
        raise
    except Exception as exc:  # si el guardia falla, no deja pasar en silencio: pregunta
        decide("ask", f"El hook de seguridad tuvo un error ({exc!r}); revisa el comando con cuidado.")


if __name__ == "__main__":
    main()
