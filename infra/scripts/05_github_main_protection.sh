#!/usr/bin/env bash
# Protege `main` con un ruleset de GitHub (KAN-7). Idempotente: crea el ruleset
# `protect-main` si no existe y lo actualiza si ya existe.
#
# Uso:  CHECKS_REF=<sha-del-PR> DRY_RUN=1 bash infra/scripts/05_github_main_protection.sh   # solo muestra
#       CHECKS_REF=<sha-del-PR> bash infra/scripts/05_github_main_protection.sh             # aplica (pide confirmación)
# Los checks de CI (KAN-15) se exigen por defecto (backend,frontend,api-types,secrets) y hay que
# indicar CHECKS_REF (un commit donde ya corrieron) o SKIP_CHECKS_VERIFY=1. Sin checks a propósito:
# REQUIRED_CHECKS="".
set -euo pipefail

source "$(dirname "$0")/lib.sh"

REPO="${REPO:-JuanDRoj/finance-app}"
RULESET_NAME="protect-main"

# Nombres de los checks de CI que deben pasar antes de mergear, separados por coma. Deben ser
# EXACTAMENTE el `name:` de cada job de .github/workflows/ci.yml (KAN-15):
#   REQUIRED_CHECKS="backend,frontend,api-types,secrets"
# Por defecto es el estado deseado, para que volver a correr el script sin variables no quite los
# checks. `REQUIRED_CHECKS=""` (definida y vacía) significa "sin checks" a propósito; ojo: exigir un
# check que nadie reporta bloquearía todos los merges.
# Se recortan los espacios alrededor de cada nombre y se ignoran los vacíos.
REQUIRED_CHECKS="${REQUIRED_CHECKS-backend,frontend,api-types,secrets}"

# Con checks requeridos hay que indicar un SHA o rama donde el CI ya corrió (p. ej. el commit del
# PR). El script comprueba que cada check exista ahí y se detiene si no; así un nombre mal escrito
# no deja el ruleset exigiendo un check que nunca llega. Para saltar la verificación a propósito:
# SKIP_CHECKS_VERIFY=1 (con aviso).
CHECKS_REF="${CHECKS_REF:-}"
SKIP_CHECKS_VERIFY="${SKIP_CHECKS_VERIFY:-0}"

# Los rulesets no existen en repos privados del plan Free (devuelven 403).
visibility="$(gh repo view "$REPO" --json visibility --jq .visibility)"
if [[ "$visibility" != "PUBLIC" ]]; then
  die "El repo $REPO es $visibility; los rulesets requieren repo público o GitHub Pro. No se cambió nada."
fi

# Normaliza REQUIRED_CHECKS: sin espacios sobrantes ni entradas vacías. El nombre se inserta en
# un JSON a mano, así que solo se aceptan caracteres que no lo rompan.
check_names=()
if [[ -n "$REQUIRED_CHECKS" ]]; then
  IFS=',' read -ra arr <<< "$REQUIRED_CHECKS"
  for c in "${arr[@]}"; do
    c="${c#"${c%%[![:space:]]*}"}"   # recorta espacios al inicio
    c="${c%"${c##*[![:space:]]}"}"   # recorta espacios al final
    [[ -z "$c" ]] && continue
    [[ "$c" =~ ^[A-Za-z0-9][A-Za-z0-9._/\ -]*$ ]] || die "Nombre de check no válido: '${c}'"
    check_names+=("$c")
  done
  [[ ${#check_names[@]} -gt 0 ]] || die "REQUIRED_CHECKS no contiene ningún nombre: '${REQUIRED_CHECKS}'"
fi

# Verifica que cada check exista de verdad en CHECKS_REF (solo lectura). Es obligatorio salvo que
# se salte a propósito con SKIP_CHECKS_VERIFY=1.
if [[ ${#check_names[@]} -gt 0 ]]; then
  if [[ -n "$CHECKS_REF" ]]; then
    reported="$(gh api --paginate "repos/${REPO}/commits/${CHECKS_REF}/check-runs" --jq '.check_runs[].name')"
    for c in "${check_names[@]}"; do
      grep -Fxq -- "$c" <<< "$reported" || die "El check '${c}' no aparece en ${CHECKS_REF}. Checks que sí existen: $(printf '%s' "$reported" | sort -u | paste -sd, -). No se cambió nada."
    done
    log "Checks verificados en ${CHECKS_REF}: ${check_names[*]}"
  elif [[ "$SKIP_CHECKS_VERIFY" == "1" ]]; then
    log "AVISO: SKIP_CHECKS_VERIFY=1, no se comprueba que los checks existan; un nombre incorrecto bloquearía todos los merges"
  else
    die "Hay checks requeridos (${check_names[*]}): indica CHECKS_REF=<sha o rama donde el CI ya corrió> para verificarlos, o SKIP_CHECKS_VERIFY=1 para saltar la verificación a propósito. No se cambió nada."
  fi
fi

# Regla de checks solo si hay alguno configurado.
checks_rule=""
if [[ ${#check_names[@]} -gt 0 ]]; then
  contexts=""
  for c in "${check_names[@]}"; do
    contexts+="{\"context\":\"${c}\"},"
  done
  checks_rule=",{\"type\":\"required_status_checks\",\"parameters\":{\"strict_required_status_checks_policy\":false,\"required_status_checks\":[${contexts%,}]}}"
fi

# - pull_request: todo cambio entra por PR (0 aprobaciones: el único usuario no puede aprobar su propio PR).
# - non_fast_forward: bloquea force push.   - deletion: impide borrar main.
# - bypass_actors vacío: la regla también aplica al administrador.
payload="$(cat <<JSON
{
  "name": "${RULESET_NAME}",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {"ref_name": {"include": ["refs/heads/main"], "exclude": []}},
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 0,
      "dismiss_stale_reviews_on_push": false,
      "require_code_owner_review": false,
      "require_last_push_approval": false,
      "required_review_thread_resolution": false
    }}${checks_rule}
  ]
}
JSON
)"

existing_id="$(gh api "repos/${REPO}/rulesets" --jq ".[] | select(.name==\"${RULESET_NAME}\") | .id")"

if [[ -n "$existing_id" ]]; then
  log "Ruleset existente (id ${existing_id}): se actualizará"
  method=PUT; endpoint="repos/${REPO}/rulesets/${existing_id}"
else
  log "Ruleset no existe: se creará"
  method=POST; endpoint="repos/${REPO}/rulesets"
fi

# Evita quitar checks requeridos sin querer: compara con los que exige hoy el ruleset (solo lectura).
if [[ -n "$existing_id" ]]; then
  current_checks="$(gh api "repos/${REPO}/rulesets/${existing_id}" \
    --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context')"
  removed=()
  while IFS= read -r c; do
    [[ -z "$c" ]] && continue
    found=0
    for n in "${check_names[@]}"; do [[ "$n" == "$c" ]] && found=1; done
    [[ "$found" == "1" ]] || removed+=("$c")
  done <<< "$current_checks"
  if [[ ${#removed[@]} -gt 0 ]]; then
    log "!!! ATENCIÓN: este cambio QUITA checks requeridos del ruleset: ${removed[*]}"
    log "!!! Los PR podrán mergearse sin que pasen. Si no es lo que quieres, cancela."
    confirm "Confirmas quitar esos checks requeridos?" || die "Cancelado"
  fi
fi

log "Payload:"
printf '%s\n' "$payload"

confirm "Aplicar el ruleset en ${REPO}?" || die "Cancelado"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  log "[dry-run] gh api -X ${method} ${endpoint} --input - (no se ejecuta)"
else
  printf '%s' "$payload" | gh api -X "$method" "$endpoint" --input - >/dev/null
  log "Ruleset aplicado"
fi
