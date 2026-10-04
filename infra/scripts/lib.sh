#!/usr/bin/env bash
# Funciones comunes para los scripts de infra. Se usa con `source`.
# DRY_RUN=1 imprime los comandos de escritura sin ejecutarlos.

log() { printf '[infra] %s\n' "$*"; }

die() { printf '[infra] ERROR: %s\n' "$*" >&2; exit 1; }

# Ejecuta un comando; en dry-run solo lo imprime.
run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# Pide confirmación antes de una acción externa. En dry-run no pregunta.
confirm() {
  [[ "${DRY_RUN:-0}" == "1" ]] && return 0
  local answer
  read -r -p "[infra] $1 [s/N] " answer
  [[ "$answer" == "s" || "$answer" == "S" ]]
}
