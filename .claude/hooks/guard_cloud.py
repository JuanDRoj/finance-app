#!/usr/bin/env python3
"""
guard_cloud.py — Hook PreToolUse (Bash) para Claude Code.

Revisa cada comando de shell ANTES de que se ejecute y decide:
  - deny  → lo bloquea (el agente recibe el motivo y debe buscar otro camino)
  - ask   → fuerza la pregunta al humano con una advertencia visible
  - nada  → deja que sigan las reglas normales de settings.json

Complementa las reglas de settings.json: aquí se detectan casos que las reglas
por prefijo no ven (comandos encadenados, flags en cualquier posición, etc.).
Solo usa la librería estándar de Python.
"""

import json
import re
import subprocess
import sys

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

# Herramientas que tocan la nube.
CLOUD_CLIS = r"(gcloud|gsutil|bq|firebase|vercel|terraform)"

# "git" seguido de sus opciones globales (-C ruta, -c clave=valor, --opcion) y luego el subcomando.
GIT = r"\bgit\s+(?:-[Cc]\s+\S+\s+|--\S+\s+)*"
# Fin de palabra "estricto": no seguido de letra, dígito, guion o dos puntos.
END = r"(?![\w:-])"

# Cualquier mención a producción en un comando de nube se bloquea.
# Cuando exista el ID real del proyecto de prod, agrégalo aquí.
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
     "⚠️ CAMBIO DE PERMISOS IAM. Verifica que el proyecto sea staging y que el rol sea el mínimo necesario."),
    (r"\bgcloud\b[^|;&]*\bconfig\s+set\s+project\b",
     "⚠️ Cambio del proyecto activo de gcloud. Verifica que sea el de staging."),
    (r"\b(alembic)\b[^|;&]*\b(downgrade)\b",
     "⚠️ Alembic downgrade: revierte migraciones de la base de datos."),
]


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


def check(command: str, cwd: str) -> None:
    cmd = " ".join(command.split())  # normaliza espacios y saltos de línea

    # 1) Producción en cualquier comando de nube
    if re.search(rf"\b{CLOUD_CLIS}\b", cmd):
        for marker in PROD_MARKERS:
            if re.search(marker, cmd, re.IGNORECASE):
                decide("deny", "El comando menciona producción. Los agentes solo trabajan en staging.")

    # 2) Reglas de bloqueo
    for pattern, reason in DENY_RULES:
        if re.search(pattern, cmd):
            decide("deny", reason)

    # 3) `git push` sin destino estando parado en main
    if re.search(rf"{GIT}push\b", cmd) and current_branch(cwd) == "main":
        decide("deny", "Estás en la rama main: el push iría directo a main. Crea una rama primero.")

    # 4) Reglas de advertencia
    for pattern, reason in ASK_RULES:
        if re.search(pattern, cmd):
            decide("ask", reason)

    # 5) Sin objeciones: siguen las reglas normales de settings.json
    sys.exit(0)


def main() -> None:
    try:
        data = json.load(sys.stdin)
        if data.get("tool_name") != "Bash":
            sys.exit(0)
        command = data.get("tool_input", {}).get("command", "") or ""
        cwd = data.get("cwd") or "."
        check(command, cwd)
    except SystemExit:
        raise
    except Exception as exc:  # si el guardia falla, no deja pasar en silencio: pregunta
        decide("ask", f"El hook de seguridad tuvo un error ({exc!r}); revisa el comando con cuidado.")


if __name__ == "__main__":
    main()