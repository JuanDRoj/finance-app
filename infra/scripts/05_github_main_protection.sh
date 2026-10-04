#!/usr/bin/env bash
# Protege `main` con un ruleset de GitHub (KAN-7). Idempotente: crea el ruleset
# `protect-main` si no existe y lo actualiza si ya existe.
#
# Uso:  DRY_RUN=1 bash infra/scripts/05_github_main_protection.sh   # solo muestra
#       bash infra/scripts/05_github_main_protection.sh             # aplica (pide confirmación)
set -euo pipefail

source "$(dirname "$0")/lib.sh"

REPO="${REPO:-JuanDRoj/finance-app}"
RULESET_NAME="protect-main"

# Nombres de los jobs de CI que deben pasar antes de mergear, separados por coma.
# Vacío hasta KAN-15: exigir un check que nadie reporta bloquearía todos los PR.
# KAN-15 lo rellena (ej. "backend,frontend") y vuelve a correr este script.
REQUIRED_CHECKS="${REQUIRED_CHECKS:-}"

# Los rulesets no existen en repos privados del plan Free (devuelven 403).
visibility="$(gh repo view "$REPO" --json visibility --jq .visibility)"
if [[ "$visibility" != "PUBLIC" ]]; then
  die "El repo $REPO es $visibility; los rulesets requieren repo público o GitHub Pro. No se cambió nada."
fi

# Regla de checks solo si hay alguno configurado.
checks_rule=""
if [[ -n "$REQUIRED_CHECKS" ]]; then
  contexts=""
  IFS=',' read -ra arr <<< "$REQUIRED_CHECKS"
  for c in "${arr[@]}"; do
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
