#!/usr/bin/env bash
# Proyecto GCP de staging (KAN-9, INF-03). Idempotente: lee lo que ya existe y solo crea o corrige
# lo que falta. Refleja el estado que se creó a mano en la consola (14 y 15/10/2026), así que en
# kanza-stg una ejecución debería limitarse a pequeños ajustes (ver los avisos de cada paso) y
# servir también para recrear staging desde cero.
#
# Uso:
#   DRY_RUN=1 bash infra/scripts/10_gcp_project.sh   # solo lecturas: imprime lo que haría
#   bash infra/scripts/10_gcp_project.sh             # aplica; pide confirmación antes del primer cambio
#
# Variables opcionales:
#   BILLING_ACCOUNT_ID=XXXXXX-XXXXXX-XXXXXX  cuenta de facturación. Si el proyecto ya está vinculado se
#                                            lee de ahí; solo hace falta para vincular un proyecto nuevo.
#                                            Nunca se escribe en el repo ni se imprime (sale como <oculto>).
#   SKIP_BUDGET=1                            salta el presupuesto (requiere administrar la cuenta de facturación).
#
# Con DRY_RUN=1 las lecturas SÍ se hacen contra la nube; solo se omiten las escrituras.
# Ojo: el "dry-run" de las políticas de limpieza de Artifact Registry es otra cosa (simulación del borrado
# de imágenes en el propio repositorio); aquí siempre se deja desactivado.
set -euo pipefail

source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/../env/staging.env"

POLICY_FILE="$(dirname "$0")/../artifact-registry/cleanup-policies.json"

# Sin preguntas interactivas de gcloud (p. ej. "¿habilitar la API y reintentar?"): la única
# confirmación es la de este script.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

# --- Estado deseado -----------------------------------------------------------------------------

# APIs del ticket: Cloud Run, Cloud SQL, Artifact Registry, Secret Manager y las dos de la
# federación de identidad con GitHub (iamcredentials y sts).
REQUIRED_APIS=(
  run.googleapis.com
  sqladmin.googleapis.com
  artifactregistry.googleapis.com
  secretmanager.googleapis.com
  iamcredentials.googleapis.com
  sts.googleapis.com
)
# APIs que usa el propio script. Con credenciales de usuario, gcloud manda el proyecto de --project
# como proyecto de cuota en cada llamada, así que estas deben estar habilitadas en el proyecto.
# billingbudgets es la única que faltaba al calibrar; cloudresourcemanager ya estaba habilitada.
SUPPORT_APIS=(
  cloudresourcemanager.googleapis.com
  billingbudgets.googleapis.com
)

# Textos tal como quedaron en la consola (así la primera ejecución no "corrige" nada).
AR_DESCRIPTION="Backend Images (Staging)"
RUN_SA_DESCRIPTION="backend id in Cloud Run (staging)"

# Mínimo privilegio de la identidad de Cloud Run: solo conectarse a Cloud SQL (el Cloud SQL Python
# Connector necesita cloudsql.instances.connect/get). El acceso al secreto de la contraseña se da
# SOBRE ESE SECRETO en KAN-10, no a nivel de proyecto (decisión: más estricto que el texto del ticket).
RUN_SA_ROLE="roles/cloudsql.client"

# Créditos que SÍ cuentan en el presupuesto: todos menos los promocionales (PROMOTION). La API no tiene
# "todo menos X", así que se enumeran. SIN CALIBRAR contra la consola: al escribir esto la API de
# presupuestos estaba deshabilitada y no se pudo leer el presupuesto vivo. Solo se usa al CREAR uno
# nuevo y en el comando de corrección sugerido; la comparación del existente solo exige que no
# incluya PROMOTION.
BUDGET_CREDIT_TYPES=(
  COMMITTED_USAGE_DISCOUNT
  COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE
  DISCOUNT
  FREE_TIER
  RESELLER_MARGIN
  SUBSCRIPTION_BENEFIT
  SUSTAINED_USAGE_DISCOUNT
)

# --- Utilidades del script ------------------------------------------------------------------------

CONFIRMED=0
ENABLED_APIS=""
IAM_FLAT=""

step() { printf '\n'; log "== $* =="; }

# La primera escritura real pide una confirmación global; si no hay nada que escribir, nunca pregunta.
ask_apply() {
  if [[ "$CONFIRMED" != "1" ]]; then
    confirm "Hay cambios por aplicar en ${GCP_PROJECT_ID}; el resto se aplica sin volver a preguntar. ¿Continuar?" || die "Cancelado"
    CONFIRMED=1
  fi
}
write() { ask_apply; run "$@"; }
write_retry() { local n="$1" s="$2"; shift 2; ask_apply; retry "$n" "$s" run "$@"; }

api_ready() { grep -Fxq -- "$1" <<<"$ENABLED_APIS"; }

project_is_active() {
  [[ "$(gcloud projects list --filter="projectId=${GCP_PROJECT_ID}" --format='value(lifecycleState)')" == "ACTIVE" ]]
}

iam_flat() {
  gcloud projects get-iam-policy "$GCP_PROJECT_ID" --flatten='bindings[].members' --format='value(bindings.role,bindings.members)'
}
has_binding() { grep -Fxq -- "$1"$'\t'"$2" <<<"$IAM_FLAT"; }

# --- 0. Comprobaciones previas --------------------------------------------------------------------

step "0/9 Comprobaciones previas"
[[ -n "$(command -v gcloud)" ]] || die "Falta gcloud"
command -v jq >/dev/null || die "Falta jq (instálalo con el gestor de paquetes del sistema)"
[[ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)')" ]] \
  || die "No hay sesión activa de gcloud: ejecuta gcloud auth login"
[[ "$GCP_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "GCP_PROJECT_ID no válido: ${GCP_PROJECT_ID}"
# Red de seguridad: este script solo toca proyectos de staging.
[[ "$GCP_PROJECT_ID" == *-stg ]] || die "GCP_PROJECT_ID debe terminar en -stg (recibido: ${GCP_PROJECT_ID})"
[[ "$GCP_REGION" == "southamerica-east1" ]] || die "Región inesperada: ${GCP_REGION}"
[[ -f "$POLICY_FILE" ]] || die "No encuentro ${POLICY_FILE}"
if is_dry; then
  log "DRY_RUN=1: solo lecturas; ninguna escritura se ejecuta"
fi
log "Proyecto ${GCP_PROJECT_ID} · región ${GCP_REGION}"

# --- 1. Proyecto ----------------------------------------------------------------------------------
# Cuenta personal, sin organización. Se busca con `projects list` porque `projects describe` responde
# PERMISSION_DENIED (no NOT_FOUND) cuando el proyecto no existe y no se podría distinguir de un
# problema de permisos. El ID de un proyecto borrado no se puede reutilizar: para recrear staging
# con otro ID hay que cambiar GCP_PROJECT_ID y FIREBASE_PROJECT_ID en staging.env.

step "1/9 Proyecto ${GCP_PROJECT_ID}"
PROJECT_EXISTS=0
PROJECT_NUMBER=""
project_state="$(gcloud projects list --filter="projectId=${GCP_PROJECT_ID}" --format='value(lifecycleState)')"
case "$project_state" in
  ACTIVE)
    PROJECT_EXISTS=1
    st_ok "El proyecto existe y está activo"
    ;;
  "")
    write gcloud projects create "$GCP_PROJECT_ID" --name="$GCP_PROJECT_NAME" --labels="env=${ENV_LABEL}" --format=none
    st_created "Proyecto ${GCP_PROJECT_ID} (sin organización, etiqueta env=${ENV_LABEL})"
    if ! is_dry; then
      PROJECT_EXISTS=1
      # El proyecto recién creado tarda unos segundos en aparecer en las lecturas siguientes.
      retry 8 5 project_is_active || die "El proyecto ${GCP_PROJECT_ID} no apareció como activo tras crearlo"
    fi
    ;;
  *)
    die "El proyecto ${GCP_PROJECT_ID} está en estado '${project_state}'. Si está pendiente de borrado, restaurarlo lo decide el humano en la consola."
    ;;
esac

if (( PROJECT_EXISTS )); then
  probe gcloud projects describe "$GCP_PROJECT_ID" --format=json || die "No encuentro el proyecto ${GCP_PROJECT_ID}"
  PROJECT_NUMBER="$(jq -r '.projectNumber' <<<"$PROBE_OUT")"
  redact_add "$PROJECT_NUMBER"
  label_env="$(jq -r '.labels.env // ""' <<<"$PROBE_OUT")"
  if [[ "$label_env" == "$ENV_LABEL" ]]; then
    st_ok "Etiqueta env=${ENV_LABEL} en el proyecto"
  else
    # El GA de gcloud solo cambia el nombre del proyecto; las etiquetas se ponen en la consola.
    st_warn "El proyecto no tiene la etiqueta env=${ENV_LABEL}. Ponla en la consola: IAM y administración > Etiquetas."
  fi
fi

# --- 2. Facturación -------------------------------------------------------------------------------
# El ID de la cuenta de facturación no va en el repo: sale del proyecto ya vinculado o de la variable
# BILLING_ACCOUNT_ID. Nunca se imprime completo.

step "2/9 Facturación"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-}"
if [[ -n "$BILLING_ACCOUNT_ID" && ! "$BILLING_ACCOUNT_ID" =~ ^[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$ ]]; then
  die "BILLING_ACCOUNT_ID no tiene el formato esperado (XXXXXX-XXXXXX-XXXXXX)"
fi
redact_add "$BILLING_ACCOUNT_ID"

if (( PROJECT_EXISTS )); then
  billing_enabled=""; billing_account=""
  probe gcloud billing projects describe "$GCP_PROJECT_ID" --format='value(billingEnabled,billingAccountName)' \
    || die "No pude leer la facturación del proyecto"
  IFS=$'\t' read -r billing_enabled billing_account <<<"$PROBE_OUT" || true
  billing_account="${billing_account#billingAccounts/}"
  if [[ "$billing_enabled" == "True" && -n "$billing_account" ]]; then
    if [[ -n "$BILLING_ACCOUNT_ID" && "$BILLING_ACCOUNT_ID" != "$billing_account" ]]; then
      die "El proyecto está vinculado a una cuenta distinta de BILLING_ACCOUNT_ID. Cambiar de cuenta de facturación lo decide el humano en la consola."
    fi
    BILLING_ACCOUNT_ID="$billing_account"
    redact_add "$BILLING_ACCOUNT_ID"
    st_ok "Facturación vinculada (cuenta oculta)"
  elif [[ -n "$billing_account" ]]; then
    die "El proyecto tiene cuenta de facturación pero la facturación está deshabilitada: revísalo en la consola de facturación."
  else
    [[ -n "$BILLING_ACCOUNT_ID" ]] \
      || die "El proyecto no está vinculado a ninguna cuenta de facturación. Lista tus cuentas con: gcloud billing accounts list  y reintenta con BILLING_ACCOUNT_ID=<id>"
    confirm "Vincular ${GCP_PROJECT_ID} a la cuenta de facturación indicada?" || die "Cancelado"
    write_retry 3 10 gcloud billing projects link "$GCP_PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID" --format=none
    st_created "Facturación vinculada (cuenta oculta)"
  fi
else
  if [[ -n "$BILLING_ACCOUNT_ID" ]]; then
    st_created "Facturación: se vincularía el proyecto nuevo (cuenta oculta)"
  else
    st_warn "Simulado: el proyecto aún no existe y falta BILLING_ACCOUNT_ID para vincularlo"
  fi
fi

# --- 3. APIs --------------------------------------------------------------------------------------

step "3/9 APIs"
if (( PROJECT_EXISTS )); then
  ENABLED_APIS="$(gcloud services list --enabled --project="$GCP_PROJECT_ID" --format='value(config.name)')"
fi
missing_apis=()
for api in "${REQUIRED_APIS[@]}" "${SUPPORT_APIS[@]}"; do
  if api_ready "$api"; then
    st_ok "API ${api} habilitada"
  else
    missing_apis+=("$api")
  fi
done
if (( ${#missing_apis[@]} > 0 )); then
  write_retry 3 20 gcloud services enable "${missing_apis[@]}" --project="$GCP_PROJECT_ID"
  for api in "${missing_apis[@]}"; do
    st_created "API ${api}"
    if ! is_dry; then ENABLED_APIS+=$'\n'"$api"; fi
  done
  # Tras habilitar una API, la nube tarda en propagarla: las lecturas siguientes reintentan.
  if ! is_dry; then PROBE_SERVICE_RETRIES=8; fi
fi

# --- 4. Artifact Registry -------------------------------------------------------------------------
# Repositorio Docker estándar en la región única, para las imágenes del backend. Sin etiquetas
# inmutables (CD sube etiquetas por commit) ni clave propia (clave administrada por Google). El
# análisis de vulnerabilidades queda desactivado: se cobra por imagen escaneada. Las políticas de
# limpieza (archivo JSON versionado) mantienen el repo pequeño: se borra lo anterior a 30 días,
# pero siempre se conservan las 10 versiones más recientes (Keep gana sobre Delete).

step "4/9 Artifact Registry ${AR_REPOSITORY}"
apply_cleanup_policies() {
  write gcloud artifacts repositories set-cleanup-policies "$AR_REPOSITORY" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --policy="$POLICY_FILE" --no-dry-run --format=none
}

if ! api_ready artifactregistry.googleapis.com; then
  st_created "Repositorio ${AR_REPOSITORY} (simulado: la API aún no está habilitada)"
elif probe gcloud artifacts repositories describe "$AR_REPOSITORY" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --format=json; then
  # gcloud puede anteponer líneas informativas al JSON: se toma desde la primera llave.
  repo_json="$(sed -n '/^{/,$p' <<<"$PROBE_OUT")"
  [[ "$(jq -r '.format // ""' <<<"$repo_json")" == "DOCKER" ]] \
    || st_warn "El repositorio no es de formato Docker"
  [[ "$(jq -r '.mode // ""' <<<"$repo_json")" =~ ^(STANDARD_REPOSITORY|MODE_UNSPECIFIED|)$ ]] \
    || st_warn "El repositorio no está en modo estándar"
  [[ "$(jq -r '.dockerConfig.immutableTags // false' <<<"$repo_json")" == "false" ]] \
    || st_warn "El repositorio tiene etiquetas inmutables activadas (no se espera en staging)"
  if [[ "$(jq -r '.vulnerabilityScanningConfig.enablementState // ""' <<<"$repo_json")" == "SCANNING_ACTIVE" ]]; then
    st_warn "El análisis de vulnerabilidades está activo (se cobra por imagen escaneada)"
  fi

  fix_args=()
  [[ "$(jq -r '.labels.env // ""' <<<"$repo_json")" == "$ENV_LABEL" ]] || fix_args+=(--update-labels="env=${ENV_LABEL}")
  [[ "$(jq -r '.description // ""' <<<"$repo_json")" == "$AR_DESCRIPTION" ]] || fix_args+=(--description="$AR_DESCRIPTION")
  if (( ${#fix_args[@]} > 0 )); then
    write gcloud artifacts repositories update "$AR_REPOSITORY" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" "${fix_args[@]}" --format=none
    st_fixed "Repositorio ${AR_REPOSITORY}: ${fix_args[*]}"
  else
    st_ok "Repositorio ${AR_REPOSITORY} (Docker, estándar, ${GCP_REGION}, etiqueta y descripción correctas)"
  fi

  # Políticas: se normalizan ambas versiones (minúsculas, orden por nombre) y se comparan.
  normalize='def lc: walk(if type == "string" then ascii_downcase else . end);'
  live_policies="$(jq -S -c "${normalize} [(.cleanupPolicies // {}) | to_entries[] | .value
    | {name: .id, action: .action, condition: (.condition // null), mostRecentVersions: (.mostRecentVersions // null)}]
    | lc | sort_by(.name)" <<<"$repo_json")"
  file_policies="$(jq -S -c "${normalize} [.[] | {name: .name, action: .action.type, condition: (.condition // null),
    mostRecentVersions: (.mostRecentVersions // null)}] | lc | sort_by(.name)" "$POLICY_FILE")"
  policies_dry_run="$(jq -r '.cleanupPolicyDryRun // false' <<<"$repo_json")"
  if [[ "$live_policies" == "$file_policies" && "$policies_dry_run" == "false" ]]; then
    st_ok "Políticas de limpieza (delete-old 30 días, keep-recent 10) en modo eliminar"
  else
    apply_cleanup_policies
    st_fixed "Políticas de limpieza reaplicadas desde infra/artifact-registry/cleanup-policies.json"
  fi
else
  write_retry 6 15 gcloud artifacts repositories create "$AR_REPOSITORY" \
    --repository-format=docker --mode=standard-repository \
    --location="$GCP_REGION" --project="$GCP_PROJECT_ID" \
    --description="$AR_DESCRIPTION" --labels="env=${ENV_LABEL}"
  st_created "Repositorio ${AR_REPOSITORY} (Docker, estándar, ${GCP_REGION})"
  apply_cleanup_policies
  st_created "Políticas de limpieza (delete-old 30 días, keep-recent 10)"
fi

# --- 5. Cuenta de servicio de runtime -------------------------------------------------------------
# Identidad del backend en Cloud Run. Solo recibe el rol de Cloud SQL Client a nivel de proyecto y
# no tiene llaves (se usa la identidad del servicio, nunca archivos JSON). No lleva logging.logWriter
# ni artifactregistry.reader: Cloud Run escribe logs y descarga la imagen con su propio agente de
# servicio (se confirma en KAN-13).

step "5/9 Cuenta de servicio ${RUN_SA_NAME}"
RUN_SA_EMAIL="${RUN_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
SA_EXISTS=0
if (( PROJECT_EXISTS )) && probe gcloud iam service-accounts describe "$RUN_SA_EMAIL" --project="$GCP_PROJECT_ID" --format=json; then
  SA_EXISTS=1
  if [[ "$(jq -r '.description // ""' <<<"$PROBE_OUT")" == "$RUN_SA_DESCRIPTION" ]]; then
    st_ok "Cuenta de servicio ${RUN_SA_EMAIL}"
  else
    write gcloud iam service-accounts update "$RUN_SA_EMAIL" --description="$RUN_SA_DESCRIPTION" --project="$GCP_PROJECT_ID"
    st_fixed "Descripción de ${RUN_SA_EMAIL}"
  fi
else
  write gcloud iam service-accounts create "$RUN_SA_NAME" --display-name="$RUN_SA_NAME" --description="$RUN_SA_DESCRIPTION" --project="$GCP_PROJECT_ID"
  st_created "Cuenta de servicio ${RUN_SA_EMAIL}"
  if ! is_dry; then SA_EXISTS=1; fi
fi

if (( PROJECT_EXISTS )); then IAM_FLAT="$(iam_flat)"; fi
if has_binding "$RUN_SA_ROLE" "serviceAccount:${RUN_SA_EMAIL}"; then
  st_ok "Rol ${RUN_SA_ROLE} para ${RUN_SA_NAME}"
else
  # Recién creada la cuenta, IAM tarda unos segundos en verla: se reintenta.
  write_retry 6 10 gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:${RUN_SA_EMAIL}" --role="$RUN_SA_ROLE" --condition=None --format=none
  st_created "Rol ${RUN_SA_ROLE} para ${RUN_SA_NAME}"
  if ! is_dry; then IAM_FLAT="$(iam_flat)"; fi
fi

# Mínimo privilegio: a nivel de proyecto solo ese rol. Si hay otros, se informa; no se quitan solos.
extra_roles="$(awk -F'\t' -v m="serviceAccount:${RUN_SA_EMAIL}" -v r="$RUN_SA_ROLE" '$2 == m && $1 != r {print $1}' <<<"$IAM_FLAT")"
if [[ -n "$extra_roles" ]]; then
  st_fail "${RUN_SA_NAME} tiene roles de proyecto de más: $(tr '\n' ' ' <<<"$extra_roles")"
else
  st_ok "${RUN_SA_NAME} solo tiene ${RUN_SA_ROLE} a nivel de proyecto"
fi

# Sin llaves creadas por usuarios.
if (( SA_EXISTS )) && (( PROJECT_EXISTS )); then
  if probe gcloud iam service-accounts keys list --iam-account="$RUN_SA_EMAIL" --managed-by=user --project="$GCP_PROJECT_ID" --format='value(name)' \
     && [[ -n "$PROBE_OUT" ]]; then
    st_fail "${RUN_SA_NAME} tiene llaves de usuario; el proyecto usa identidades sin llaves"
  else
    st_ok "${RUN_SA_NAME} sin llaves de usuario"
  fi
fi

# --- 6. Cuenta de servicio predeterminada de Compute ------------------------------------------------
# Google la crea con rol Editor sobre todo el proyecto. Se le quita Editor (no se borra ni se
# desactiva la cuenta): ningún servicio de staging debe depender de un permiso tan amplio.

step "6/9 Cuenta de servicio predeterminada de Compute"
if [[ -n "$PROJECT_NUMBER" ]]; then
  COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  if has_binding "roles/editor" "serviceAccount:${COMPUTE_SA}"; then
    confirm "Quitar roles/editor a ${COMPUTE_SA}?" || die "Cancelado"
    write gcloud projects remove-iam-policy-binding "$GCP_PROJECT_ID" \
      --member="serviceAccount:${COMPUTE_SA}" --role=roles/editor --format=none
    st_fixed "roles/editor quitado a la cuenta predeterminada de Compute"
    if ! is_dry; then IAM_FLAT="$(iam_flat)"; fi
  else
    st_ok "La cuenta predeterminada de Compute no tiene roles/editor"
  fi
else
  COMPUTE_SA=""
  st_info "Simulado: el proyecto aún no existe; no hay cuenta de Compute que revisar"
fi

# --- 7. Verificación: ninguna cuenta de servicio con Editor/Owner ------------------------------------
# Un Owner humano (user:) es válido. Única excepción: el Google APIs Service Agent
# (<número>@cloudservices.gserviceaccount.com), que Google administra y puede traer Editor; se
# acepta solo por patrón exacto y se muestra como informativo. Cualquier otra cuenta de servicio
# con Editor/Owner es un fallo (no se corrige sola).

step "7/9 Verificación: ninguna cuenta de servicio con Editor/Owner"
violations=0
while IFS=$'\t' read -r role member; do
  [[ -n "$role" ]] || continue
  [[ "$member" == serviceAccount:* ]] || continue
  [[ "$role" == "roles/editor" || "$role" == "roles/owner" ]] || continue
  if [[ "$member" =~ ^serviceAccount:[0-9]+@cloudservices\.gserviceaccount\.com$ ]]; then
    st_info "Google APIs Service Agent con ${role}: lo administra Google, excepción permitida"
  elif is_dry && [[ "$member" == "serviceAccount:${COMPUTE_SA}" && "$role" == "roles/editor" ]]; then
    st_info "${member} tiene ${role}: se corrige en el paso 6"
  else
    st_fail "${member} tiene ${role}"
    violations=1
  fi
done <<<"$IAM_FLAT"
if (( violations == 0 )); then
  st_ok "Ninguna cuenta de servicio tiene Editor/Owner"
fi

# --- 8. Presupuesto -------------------------------------------------------------------------------
# Alerta de gasto: USD 20 al mes, solo el proyecto, todos los servicios, solo alertas (sin tope de
# gasto). Avisa por correo a los administradores de facturación al 50, 90 y 100 % del gasto real.
# Los créditos promocionales NO se descuentan (si no, la alerta no saltaría mientras el crédito de
# prueba cubra el gasto). Si ya existe uno con el mismo nombre solo se compara y se avisa; nunca se
# modifica solo.

step "8/9 Presupuesto ${BUDGET_DISPLAY_NAME}"
CREDITS_CSV="$(IFS=,; printf '%s' "${BUDGET_CREDIT_TYPES[*]}")"
BUDGET_DRIFT_JQ='
  (.budgetFilter // {}) as $f
  | [
      (if ((.amount.specifiedAmount.units // "0") | tostring) == $amt and (.amount.specifiedAmount.currencyCode // "") == $cur then empty else "monto o moneda" end),
      (if ($f.calendarPeriod // "") == "MONTH" then empty else "período" end),
      (if (($f.projects // []) == ["projects/" + $num] or ($f.projects // []) == ["projects/" + $pid]) then empty else "proyectos" end),
      (if (($f.services // []) | length) == 0 then empty else "servicios" end),
      (if ($f.creditTypesTreatment // "") == "INCLUDE_SPECIFIED_CREDITS" and (($f.creditTypes // []) | length) > 0 and (($f.creditTypes // []) | any(. == "PROMOTION") | not) then empty else "créditos (deben contar todos menos PROMOTION)" end),
      (if ([.thresholdRules[]? | .thresholdPercent] | sort) == [0.5, 0.9, 1] then empty else "umbrales" end),
      (if ([.thresholdRules[]? | (.spendBasis // "CURRENT_SPEND")] | all(. == "CURRENT_SPEND")) then empty else "base de los umbrales" end),
      (if (.notificationsRule.disableDefaultIamRecipients // false) == false then empty else "destinatarios por defecto" end),
      (if (.spendCap // null) == null then empty else "tope de gasto" end)
    ] | join(", ")'

if [[ "${SKIP_BUDGET:-0}" == "1" ]]; then
  st_info "SKIP_BUDGET=1: se omite el presupuesto"
elif [[ -z "$BILLING_ACCOUNT_ID" ]] || ! api_ready billingbudgets.googleapis.com; then
  st_info "Simulado: la API billingbudgets aún no está habilitada (o falta la cuenta de facturación); el presupuesto se comprueba en la siguiente ejecución"
else
  probe gcloud billing budgets list --billing-account="$BILLING_ACCOUNT_ID" --project="$GCP_PROJECT_ID" --format=json \
    || die "No pude listar los presupuestos de la cuenta de facturación"
  # Se filtra por nombre con jq (no con --filter de gcloud) para no crear un duplicado si cambia el nombre del campo.
  n_match="$(jq --arg n "$BUDGET_DISPLAY_NAME" '[.[] | select(.displayName == $n)] | length' <<<"$PROBE_OUT")"
  case "$n_match" in
    0)
      write gcloud billing budgets create --billing-account="$BILLING_ACCOUNT_ID" --project="$GCP_PROJECT_ID" \
        --display-name="$BUDGET_DISPLAY_NAME" --budget-amount="${BUDGET_AMOUNT}${BUDGET_CURRENCY}" \
        --calendar-period=month --filter-projects="projects/${PROJECT_NUMBER}" \
        --credit-types-treatment=include-specified-credits --filter-credit-types="$CREDITS_CSV" \
        --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 --format=none
      st_created "Presupuesto ${BUDGET_DISPLAY_NAME} (${BUDGET_AMOUNT} ${BUDGET_CURRENCY}/mes, alertas 50/90/100 %)"
      ;;
    1)
      budget_json="$(jq --arg n "$BUDGET_DISPLAY_NAME" '[.[] | select(.displayName == $n)][0]' <<<"$PROBE_OUT")"
      drift="$(jq -r --arg amt "$BUDGET_AMOUNT" --arg cur "$BUDGET_CURRENCY" --arg num "$PROJECT_NUMBER" --arg pid "$GCP_PROJECT_ID" "$BUDGET_DRIFT_JQ" <<<"$budget_json")"
      if [[ -z "$drift" ]]; then
        st_ok "Presupuesto ${BUDGET_DISPLAY_NAME} coincide con lo declarado"
      else
        budget_name="$(jq -r '.name' <<<"$budget_json")"
        st_warn "El presupuesto ${BUDGET_DISPLAY_NAME} difiere en: ${drift}. No se modifica solo."
        st_info "Para alinearlo (revísalo antes; la lista de créditos no está calibrada): gcloud billing budgets update ${budget_name} --project=${GCP_PROJECT_ID} --budget-amount=${BUDGET_AMOUNT}${BUDGET_CURRENCY} --calendar-period=month --filter-projects=projects/${PROJECT_NUMBER} --credit-types-treatment=include-specified-credits --filter-credit-types=${CREDITS_CSV} --clear-threshold-rules --add-threshold-rule=percent=0.5 --add-threshold-rule=percent=0.9 --add-threshold-rule=percent=1.0"
      fi
      ;;
    *)
      st_fail "Hay ${n_match} presupuestos llamados ${BUDGET_DISPLAY_NAME}; deja solo uno (decisión humana)"
      ;;
  esac
fi

# --- 9. Resumen -----------------------------------------------------------------------------------

step "9/9 Resumen"
summary
