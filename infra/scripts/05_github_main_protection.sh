#!/usr/bin/env bash
# Protege `main` con un ruleset de GitHub (KAN-7). Idempotente: crea el ruleset
# `protect-main` si no existe y lo actualiza si ya existe.
#
# Uso:  DRY_RUN=1 bash infra/scripts/05_github_main_protection.sh   # solo muestra
#       bash infra/scripts/05_github_main_protection.sh             # aplica (pide confirmación)
# Con checks de CI (KAN-15), cuando ya corrieron al menos una vez en el PR:
#       CHECKS_REF=<sha-del-PR> REQUIRED_CHECKS="backend,frontend,api-types,secrets" \
#         bash infra/scripts/05_github_main_protection.sh
set -euo pipefail

source "$(dirname "$0")/lib.sh"

REPO="${REPO:-JuanDRoj/finance-app}"
RULESET_NAME="protect-main"

# Nombres de los checks de CI que deben pasar antes de mergear, separados por coma. Deben ser
# EXACTAMENTE el `name:` de cada job de .github/workflows/ci.yml (KAN-15):
#   REQUIRED_CHECKS="backend,frontend,api-types,secrets"
# Vacío = el ruleset no exige checks (exigir uno que nadie reporta bloquearía todos los merges).
# Se recortan los espacios alrededor de cada nombre y se ignoran los vacíos.
REQUIRED_CHECKS="${REQUIRED_CHECKS:-}"

# Recomendado al exigir checks: un SHA o rama donde el CI ya corrió (p. ej. el commit del PR).
# El script comprueba que cada check requerido exista ahí y se detiene si no; así un nombre mal
# escrito no deja el ruleset exigiendo un check que nunca llega.
CHECKS_REF="${CHECKS_REF:-}"

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

# Verifica que cada check exista de verdad en CHECKS_REF (solo lectura).
if [[ ${#check_names[@]} -gt 0 ]]; then
  if [[ -n "$CHECKS_REF" ]]; then
    reported="$(gh api --paginate "repos/${REPO}/commits/${CHECKS_REF}/check-runs" --jq '.check_runs[].name')"
    for c in "${check_names[@]}"; do
      grep -Fxq -- "$c" <<< "$reported" || die "El check '${c}' no aparece en ${CHECKS_REF}. Checks que sí existen: $(printf '%s' "$reported" | sort -u | paste -sd, -). No se cambió nada."
    done
    log "Checks verificados en ${CHECKS_REF}: ${check_names[*]}"
  else
    log "AVISO: sin CHECKS_REF no se comprueba que los checks existan; un nombre incorrecto bloquearía todos los merges"
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

log "Payload:"
printf '%s\n' "$payload"

confirm "Aplicar el ruleset en ${REPO}?" || die "Cancelado"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  log "[dry-run] gh api -X ${method} ${endpoint} --input - (no se ejecuta)"
else
  printf '%s' "$payload" | gh api -X "$method" "$endpoint" --input - >/dev/null
  log "Ruleset aplicado"
fi
