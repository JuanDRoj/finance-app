#!/usr/bin/env bash
# Funciones comunes para los scripts de infra. Se usa con `source`.
# DRY_RUN=1 imprime los comandos de escritura sin ejecutarlos.

# Valores que nunca deben salir en pantalla ni en la evidencia (ej. ID de la cuenta de facturación).
# Se registran con `redact_add`; con la lista vacía, `log` y `die` se comportan igual que siempre.
REDACTIONS=()

redact_add() { [[ -n "${1:-}" ]] && REDACTIONS+=("$1"); return 0; }

_redact() {
  local s="$*" v
  for v in "${REDACTIONS[@]+"${REDACTIONS[@]}"}"; do
    s="${s//"$v"/<oculto>}"
  done
  printf '%s' "$s"
}

log() { printf '[infra] %s\n' "$(_redact "$*")"; }

die() { printf '[infra] ERROR: %s\n' "$(_redact "$*")" >&2; exit 1; }

is_dry() { [[ "${DRY_RUN:-0}" == "1" ]]; }

# Ejecuta un comando; en dry-run solo lo imprime (con comillas, para poder copiarlo).
run() {
  if is_dry; then
    printf '[dry-run] %s\n' "$(_redact "$(printf '%q ' "$@")")"
  else
    "$@"
  fi
}

# Pide confirmación antes de una acción externa. En dry-run no pregunta.
# El texto pasa por _redact, igual que log y die.
confirm() {
  is_dry && return 0
  local answer
  read -r -p "[infra] $(_redact "$1") [s/N] " answer
  [[ "$answer" == "s" || "$answer" == "S" ]]
}

# --- Estado por recurso y resumen final ---
# Cada recurso se reporta con una etiqueta: ya existía, creado, corregido, aviso o fallo.
# En dry-run, "creado" y "corregido" pasan a "se crearía" y "se corregiría".
N_OK=0; N_CREATED=0; N_FIXED=0; N_WARN=0; N_FAIL=0

st_ok()      { N_OK=$((N_OK + 1)); log "[ok] $*"; }
st_created() { N_CREATED=$((N_CREATED + 1)); if is_dry; then log "[se crearía] $*"; else log "[creado] $*"; fi; }
st_fixed()   { N_FIXED=$((N_FIXED + 1)); if is_dry; then log "[se corregiría] $*"; else log "[corregido] $*"; fi; }
st_warn()    { N_WARN=$((N_WARN + 1)); log "[AVISO] $*"; }
st_fail()    { N_FAIL=$((N_FAIL + 1)); log "[FALLO] $*"; }
st_info()    { log "[info] $*"; }

# Imprime el resumen y devuelve 1 si hubo algún fallo.
summary() {
  log "RESUMEN: ya_existia=${N_OK} creado=${N_CREATED} corregido=${N_FIXED} avisos=${N_WARN} fallos=${N_FAIL}"
  if (( N_FAIL > 0 )); then
    log "Hay fallos: revisa las líneas [FALLO] de arriba."
    return 1
  fi
  if (( N_CREATED == 0 && N_FIXED == 0 )); then
    log "Nada que crear ni corregir."
  fi
  return 0
}

# --- Esperas y comprobaciones ---

# retry <intentos> <segundos> cmd...: reintenta mientras falle (propagación de APIs o de IAM).
# Con `run` delante, en dry-run imprime una vez y no espera.
retry() {
  local max="$1" wait_s="$2" i=1
  shift 2
  until "$@"; do
    if (( i >= max )); then
      return 1
    fi
    log "Reintento ${i}/${max} en ${wait_s}s (propagación)"
    sleep "$wait_s"
    i=$((i + 1))
  done
}

# probe <cmd...>: distingue "no existe" de "no pude comprobar".
#   0 = existe (stdout del comando en $PROBE_OUT)
#   1 = no existe (NOT_FOUND)
#   cualquier otro error detiene el script con el mensaje de la nube.
# Si la API aún no se propagó tras habilitarla, reintenta PROBE_SERVICE_RETRIES veces (15 s cada una).
PROBE_OUT=""
PROBE_SERVICE_RETRIES=0
probe() {
  local err_file err attempt=0
  err_file="$(mktemp)"
  while true; do
    if PROBE_OUT="$("$@" 2>"$err_file")"; then
      rm -f "$err_file"
      return 0
    fi
    err="$(<"$err_file")"
    if grep -qE 'SERVICE_DISABLED|has not been used in project' <<<"$err" && (( attempt < PROBE_SERVICE_RETRIES )); then
      attempt=$((attempt + 1))
      log "API aún sin propagar; reintento ${attempt}/${PROBE_SERVICE_RETRIES} en 15s"
      sleep 15
      continue
    fi
    break
  done
  rm -f "$err_file"
  PROBE_OUT=""
  if grep -qiE 'NOT_FOUND|not found|does not exist|Unknown service account' <<<"$err"; then
    return 1
  fi
  die "No pude comprobar: $* -- ${err:0:600}"
}

# --- Estructura de los scripts de recursos (compartida por 10_, 20_ y sql_*) ---

step() { printf '\n'; log "== $* =="; }

# La primera escritura real pide una confirmación global; si no hay nada que escribir, nunca pregunta.
# Un script que ya preguntó algo más específico puede dejar CONFIRMED=1 para no repetir la pregunta.
CONFIRMED=0
ask_apply() {
  if [[ "$CONFIRMED" != "1" ]]; then
    confirm "Hay cambios por aplicar en ${GCP_PROJECT_ID}; el resto se aplica sin volver a preguntar. ¿Continuar?" || die "Cancelado"
    CONFIRMED=1
  fi
}

write() { ask_apply; run "$@"; }

# write_retry <intentos> <segundos> cmd...: como write, pero reintenta; si agota los intentos se detiene.
write_retry() {
  local n="$1" s="$2" cmd
  shift 2
  cmd="$*"
  ask_apply
  retry "$n" "$s" run "$@" || die "El comando falló tras ${n} intentos: ${cmd:0:300}"
}
