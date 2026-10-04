#!/usr/bin/env bash
# Escanea TODO el historial de git en busca de secretos (solo lectura).
# Se corre antes de hacer público el repo (KAN-7). Nunca imprime valores:
# gitleaks usa --redact y el fallback solo muestra conteos por patrón.
set -euo pipefail

source "$(dirname "$0")/lib.sh"

REPO_ROOT="$(git rev-parse --show-toplevel)"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  log "Escaneando el historial con gitleaks (Docker)"
  # Montaje de solo lectura; se analizan todas las ramas y tags.
  docker run --rm -v "$REPO_ROOT":/repo:ro zricethezav/gitleaks:latest \
    detect --source /repo --log-opts="--all" --redact --no-banner
else
  log "Docker no disponible: fallback con grep (solo conteos, sin valores)"
  patterns=(
    'AKIA[0-9A-Z]{16}'
    '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    'gh[pousr]_[A-Za-z0-9]{30,}'
    'AIza[0-9A-Za-z_-]{35}'
    'xox[baprs]-[A-Za-z0-9-]+'
    'sk-[A-Za-z0-9]{32,}'
    '(password|passwd|secret|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*["'\'']?[A-Za-z0-9/+_-]{12,}'
    # URLs con usuario y clave incrustados en la direccion de conexion
    '[a-z+]+://[^/:@[:space:]]+:[^@[:space:]]+@'
  )
  found=0
  for p in "${patterns[@]}"; do
    n="$(git -C "$REPO_ROOT" log --all -p | grep -ciE -e "$p" || true)"
    log "patrón '${p:0:30}...': $n coincidencias"
    [[ "$n" != "0" ]] && found=1
  done
  [[ "$found" == "0" ]] || die "Hay coincidencias: revisar a mano (archivo/commit), sin publicar"
fi

log "Escaneo terminado sin hallazgos"
