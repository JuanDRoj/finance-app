#!/usr/bin/env bash
# Workload Identity Federation GitHub -> GCP (KAN-12, INF-06). Idempotente: lee lo que ya existe y
# solo crea o corrige lo que falta. Refleja el estado que el humano crea a mano en la consola, así
# que en kanza-stg una corrida debería limitarse a verificar (ver los avisos de cada paso) y sirve
# también para recrear staging desde cero.
#
# Qué crea (todo sin llaves JSON: GitHub presenta un token OIDC de corta vida y Google lo canjea):
#   - Pool + provider OIDC de GitHub, con una condición que solo deja pasar a ESTE repositorio,
#     desde refs/heads/main.
#   - Cuenta de servicio github-deployer-stg con permisos mínimos:
#       roles/run.admin                  a nivel de proyecto (desplegar servicios y jobs de Cloud Run)
#       roles/artifactregistry.writer    solo sobre el repositorio de imágenes
#       roles/iam.serviceAccountUser     solo sobre la cuenta de runtime (actuar como ella al desplegar)
#   - roles/iam.workloadIdentityUser sobre la cuenta deployer para el principalSet del repositorio
#     (por repository_id, que no cambia si renombran o transfieren el repo).
#
# Uso:
#   DRY_RUN=1 bash infra/scripts/30_workload_identity.sh   # solo lecturas: imprime lo que haría
#   bash infra/scripts/30_workload_identity.sh             # aplica; pide confirmación antes del primer cambio
#
# Variables opcionales:
#   SET_GH_VARS=1   además escribe las variables de repo GCP_WIF_PROVIDER y GCP_DEPLOYER_SA con
#                   `gh variable set` (administración de GitHub: la corre el humano). Sin esto, el
#                   script solo compara las variables y muestra los comandos.
#
# Reglas que este script nunca rompe:
#   - Una condición, mapeo o issuer del provider que difiere se CORRIGE (update-oidc): es un control
#     de seguridad, así que siempre se alinea al estado estricto de este archivo.
#   - Nunca quita permisos ni miembros: si hay roles o miembros de más, avisa con [FALLO] y el
#     humano decide en la consola.
#   - Nunca crea llaves de cuentas de servicio.
#
# Con DRY_RUN=1 las lecturas SÍ se hacen contra la nube; solo se omiten las escrituras.
set -euo pipefail

source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/../env/staging.env"

# Sin preguntas interactivas de gcloud: la única confirmación es la de este script.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

WORKFLOWS_DIR="$(dirname "$0")/../../.github/workflows"

# --- Estado deseado -----------------------------------------------------------------------------

DEPLOYER_EMAIL="${DEPLOYER_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
DEPLOYER_MEMBER="serviceAccount:${DEPLOYER_EMAIL}"
RUN_SA_EMAIL="${RUN_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

DEPLOYER_SA_DESCRIPTION="GitHub Actions deployer (staging)"
POOL_DISPLAY_NAME="GitHub Actions (staging)"
POOL_DESCRIPTION="OIDC identities from GitHub Actions of ${GITHUB_REPO}"
PROVIDER_DISPLAY_NAME="GitHub OIDC (staging)"
PROVIDER_DESCRIPTION="GitHub Actions OIDC, restricted to ${GITHUB_REPO} on main"

ISSUER_URI="https://token.actions.githubusercontent.com"

# Mapeo de claims del token de GitHub a atributos de Google. La condición no usa `sub` (el repo tiene
# el sujeto inmutable activado y su formato es otro); usa claims que no cambian con renombres.
MAPPING_PAIRS=(
  "google.subject=assertion.sub"
  "attribute.repository=assertion.repository"
  "attribute.repository_id=assertion.repository_id"
  "attribute.repository_owner_id=assertion.repository_owner_id"
  "attribute.ref=assertion.ref"
)
MAPPING_CSV="$(IFS=,; printf '%s' "${MAPPING_PAIRS[*]}")"
MAPPING_JSON="$(printf '%s\n' "${MAPPING_PAIRS[@]}" | jq -Rn '[inputs | split("=") | {(.[0]): .[1]}] | add')"

# Condición del provider (CEL). Es la barrera principal del lado de Google:
#   - repository_id y repository_owner_id: solo este repo; un fork o un repo homónimo tienen otro id.
#   - ref: solo la rama main (ramas, tags y PRs quedan fuera; en un PR el ref es refs/pull/N/merge).
#   - event_name: cierra un hueco conocido, pull_request_target corre con ref=refs/heads/main aunque
#     lo dispare un PR externo. No limita push, workflow_dispatch ni schedule.
ATTRIBUTE_CONDITION="assertion.repository_id == '${GITHUB_REPO_ID}' && assertion.repository_owner_id == '${GITHUB_OWNER_ID}' && assertion.ref == 'refs/heads/main' && assertion.event_name != 'pull_request_target'"

# Roles de la cuenta deployer.
DEPLOYER_PROJECT_ROLE="roles/run.admin"
DEPLOYER_AR_ROLE="roles/artifactregistry.writer"
DEPLOYER_ACTAS_ROLE="roles/iam.serviceAccountUser"
WIF_USER_ROLE="roles/iam.workloadIdentityUser"

# APIs que usa este script (las habilita 10_gcp_project.sh).
NEEDED_APIS=(
  iam.googleapis.com
  iamcredentials.googleapis.com
  sts.googleapis.com
  cloudresourcemanager.googleapis.com
  artifactregistry.googleapis.com
  run.googleapis.com
)

# --- Utilidades del script ------------------------------------------------------------------------

IAM_FLAT=""
iam_flat() {
  gcloud projects get-iam-policy "$GCP_PROJECT_ID" --flatten='bindings[].members' --format='value(bindings.role,bindings.members)'
}
has_binding() { grep -Fxq -- "$1"$'\t'"$2" <<<"$IAM_FLAT"; }

# policy_has <política JSON> <rol> <miembro>: ¿el miembro está en ese rol?
policy_has() {
  jq -e --arg r "$2" --arg m "$3" '(.bindings // []) | any(.role == $r and ((.members // []) | index($m)))' <<<"$1" >/dev/null
}
# policy_extras <política JSON> <rol> <miembro>: líneas "rol miembro" que NO sean exactamente el par esperado.
policy_extras() {
  jq -r --arg r "$2" --arg m "$3" '(.bindings // [])[] | .role as $role | (.members // [])[] | select(($role == $r and . == $m) | not) | "\($role) \(.)"' <<<"$1"
}

# --- 0. Comprobaciones previas --------------------------------------------------------------------

step "0/10 Comprobaciones previas"
[[ -n "$(command -v gcloud)" ]] || die "Falta gcloud"
command -v jq >/dev/null || die "Falta jq (instálalo con el gestor de paquetes del sistema)"
[[ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)')" ]] \
  || die "No hay sesión activa de gcloud: ejecuta gcloud auth login"
[[ "$GCP_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "GCP_PROJECT_ID no válido: ${GCP_PROJECT_ID}"
# Red de seguridad: este script solo toca proyectos de staging.
[[ "$GCP_PROJECT_ID" == *-stg ]] || die "GCP_PROJECT_ID debe terminar en -stg (recibido: ${GCP_PROJECT_ID})"
[[ "$GCP_REGION" == "southamerica-east1" ]] || die "Región inesperada: ${GCP_REGION}"
[[ "$GITHUB_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "GITHUB_REPO no válido: ${GITHUB_REPO}"
[[ "$GITHUB_REPO_ID" =~ ^[0-9]+$ ]] || die "GITHUB_REPO_ID debe ser numérico: ${GITHUB_REPO_ID}"
[[ "$GITHUB_OWNER_ID" =~ ^[0-9]+$ ]] || die "GITHUB_OWNER_ID debe ser numérico: ${GITHUB_OWNER_ID}"
if is_dry; then
  log "DRY_RUN=1: solo lecturas; ninguna escritura se ejecuta"
fi
log "Proyecto ${GCP_PROJECT_ID} · región ${GCP_REGION} · repositorio ${GITHUB_REPO}"

# Los IDs de staging.env deben ser los del repo real: un ID desactualizado dejaría la condición
# apuntando a otro repositorio (o a ninguno).
GH_OK=0
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  GH_OK=1
  gh_ids="$(gh api "repos/${GITHUB_REPO}" --jq '[.id, .owner.id] | @tsv' 2>/dev/null || true)"
  if [[ -z "$gh_ids" ]]; then
    st_warn "No pude leer repos/${GITHUB_REPO} con gh; no se verificaron los IDs de GitHub"
  elif [[ "$gh_ids" == "${GITHUB_REPO_ID}"$'\t'"${GITHUB_OWNER_ID}" ]]; then
    st_ok "IDs de GitHub (repositorio y propietario) coinciden con ${GITHUB_REPO}"
  else
    die "GITHUB_REPO_ID/GITHUB_OWNER_ID de staging.env no coinciden con GitHub (repositorio, propietario: ${gh_ids//$'\t'/, })"
  fi
else
  st_warn "gh no está disponible o sin sesión: no se verificaron los IDs de GitHub ni las variables de repo"
fi

PROJECT_NUMBER=""
probe gcloud projects describe "$GCP_PROJECT_ID" --format=json || die "No encuentro el proyecto ${GCP_PROJECT_ID}"
PROJECT_NUMBER="$(jq -r '.projectNumber' <<<"$PROBE_OUT")"
redact_add "$PROJECT_NUMBER"

enabled_apis="$(gcloud services list --enabled --project="$GCP_PROJECT_ID" --format='value(config.name)')"
for api in "${NEEDED_APIS[@]}"; do
  if grep -Fxq -- "$api" <<<"$enabled_apis"; then
    st_ok "API ${api} habilitada"
  else
    st_fail "Falta habilitar la API ${api}: corre 10_gcp_project.sh"
  fi
done
(( N_FAIL == 0 )) || { summary || true; die "Faltan APIs; este script no las habilita"; }

PRINCIPAL_SET="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository_id/${GITHUB_REPO_ID}"
PROVIDER_FULL_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"

# --- 1. Pool --------------------------------------------------------------------------------------
# Contenedor de identidades externas. Siempre en la ubicación global. Un pool borrado conserva su ID
# 30 días (no se puede reutilizar), por eso un pool en estado DELETED es un fallo, no se recrea solo.

step "1/10 Pool ${WIF_POOL}"
POOL_EXISTS=0
POOL_BAD=0
if probe gcloud iam workload-identity-pools describe "$WIF_POOL" --location=global --project="$GCP_PROJECT_ID" --format=json; then
  POOL_EXISTS=1
  pool_state="$(jq -r '.state // ""' <<<"$PROBE_OUT")"
  pool_disabled="$(jq -r '.disabled // false' <<<"$PROBE_OUT")"
  if [[ "$pool_state" != "ACTIVE" ]]; then
    st_fail "El pool ${WIF_POOL} está en estado ${pool_state}; si se borró, su ID queda reservado 30 días. Restaurarlo o elegir otro nombre lo decide el humano."
    POOL_EXISTS=0
    POOL_BAD=1
  elif [[ "$pool_disabled" == "true" ]]; then
    write gcloud iam workload-identity-pools update "$WIF_POOL" --location=global --project="$GCP_PROJECT_ID" --no-disabled --format=none
    st_fixed "Pool ${WIF_POOL} estaba deshabilitado"
  else
    st_ok "Pool ${WIF_POOL} activo"
  fi
else
  write gcloud iam workload-identity-pools create "$WIF_POOL" --location=global --project="$GCP_PROJECT_ID" \
    --display-name="$POOL_DISPLAY_NAME" --description="$POOL_DESCRIPTION" --format=none
  st_created "Pool ${WIF_POOL}"
  if ! is_dry; then POOL_EXISTS=1; fi
fi

# --- 2. Provider OIDC -----------------------------------------------------------------------------
# Define a quién se le cree y bajo qué condiciones. Sin allowed-audiences: la action de autenticación
# usa por defecto el nombre completo del provider como audiencia. Si issuer, mapeo o condición
# difieren, se corrigen (update-oidc).

step "2/10 Provider ${WIF_PROVIDER}"
if (( POOL_EXISTS )) && probe gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
    --workload-identity-pool="$WIF_POOL" --location=global --project="$GCP_PROJECT_ID" --format=json; then
  prov_json="$PROBE_OUT"
  prov_state="$(jq -r '.state // ""' <<<"$prov_json")"
  if [[ "$prov_state" != "ACTIVE" ]]; then
    st_fail "El provider ${WIF_PROVIDER} está en estado ${prov_state}; si se borró, su ID queda reservado 30 días. Lo decide el humano."
  else
    drift=()
    [[ "$(jq -r '.oidc.issuerUri // ""' <<<"$prov_json")" == "$ISSUER_URI" ]] || drift+=("issuer")
    [[ "$(jq -S -c '.attributeMapping // {}' <<<"$prov_json")" == "$(jq -S -c . <<<"$MAPPING_JSON")" ]] || drift+=("mapeo de atributos")
    [[ "$(jq -r '.attributeCondition // ""' <<<"$prov_json")" == "$ATTRIBUTE_CONDITION" ]] || drift+=("condición de atributo")
    [[ "$(jq -r '.disabled // false' <<<"$prov_json")" == "false" ]] || drift+=("provider deshabilitado")
    # Audiencias personalizadas: no se corrigen desde aquí (un valor vacío no es fiable en update-oidc).
    if [[ "$(jq -c '.oidc.allowedAudiences // []' <<<"$prov_json")" != "[]" ]]; then
      st_fail "El provider tiene audiencias permitidas personalizadas; la action usa la audiencia por defecto. Quítalas en la consola."
    fi
    if (( ${#drift[@]} == 0 )); then
      st_ok "Provider ${WIF_PROVIDER} (issuer, mapeo y condición como se esperan)"
    else
      write gcloud iam workload-identity-pools providers update-oidc "$WIF_PROVIDER" \
        --workload-identity-pool="$WIF_POOL" --location=global --project="$GCP_PROJECT_ID" \
        --issuer-uri="$ISSUER_URI" --attribute-mapping="$MAPPING_CSV" --attribute-condition="$ATTRIBUTE_CONDITION" \
        --no-disabled --format=none
      st_fixed "Provider ${WIF_PROVIDER}: ${drift[*]}"
    fi
  fi
elif (( POOL_BAD )); then
  st_fail "No se puede crear el provider ${WIF_PROVIDER}: el pool ${WIF_POOL} no está activo"
else
  write gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
    --workload-identity-pool="$WIF_POOL" --location=global --project="$GCP_PROJECT_ID" \
    --display-name="$PROVIDER_DISPLAY_NAME" --description="$PROVIDER_DESCRIPTION" \
    --issuer-uri="$ISSUER_URI" --attribute-mapping="$MAPPING_CSV" --attribute-condition="$ATTRIBUTE_CONDITION" --format=none
  st_created "Provider ${WIF_PROVIDER}"
fi

# --- 3. Cuenta de servicio deployer ---------------------------------------------------------------

step "3/10 Cuenta de servicio ${DEPLOYER_SA_NAME}"
DEPLOYER_EXISTS=0
if probe gcloud iam service-accounts describe "$DEPLOYER_EMAIL" --project="$GCP_PROJECT_ID" --format=json; then
  DEPLOYER_EXISTS=1
  if [[ "$(jq -r '.description // ""' <<<"$PROBE_OUT")" == "$DEPLOYER_SA_DESCRIPTION" ]]; then
    st_ok "Cuenta de servicio ${DEPLOYER_EMAIL}"
  else
    write gcloud iam service-accounts update "$DEPLOYER_EMAIL" --description="$DEPLOYER_SA_DESCRIPTION" --project="$GCP_PROJECT_ID"
    st_fixed "Descripción de ${DEPLOYER_EMAIL}"
  fi
else
  write gcloud iam service-accounts create "$DEPLOYER_SA_NAME" --display-name="$DEPLOYER_SA_NAME" --description="$DEPLOYER_SA_DESCRIPTION" --project="$GCP_PROJECT_ID"
  st_created "Cuenta de servicio ${DEPLOYER_EMAIL}"
  if ! is_dry; then DEPLOYER_EXISTS=1; fi
fi

# --- 4. Rol de proyecto ---------------------------------------------------------------------------
# run.admin a nivel de proyecto (texto del ticket): hace falta para crear el servicio y los jobs de
# Cloud Run. Más de lo necesario: roles/run.developer basta para desplegar y ejecutar jobs; solo
# run.admin añade administrar el acceso público (--allow-unauthenticated). Se revisa en KAN-13/16.
# Ningún otro rol de proyecto: ni serviceAccountUser (se da sobre la cuenta de runtime), ni Editor.

step "4/10 Rol de proyecto de ${DEPLOYER_SA_NAME}"
IAM_FLAT="$(iam_flat)"
if has_binding "$DEPLOYER_PROJECT_ROLE" "$DEPLOYER_MEMBER"; then
  st_ok "Rol ${DEPLOYER_PROJECT_ROLE} para ${DEPLOYER_SA_NAME}"
else
  # Recién creada la cuenta, IAM tarda unos segundos en verla: se reintenta.
  write_retry 6 10 gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="$DEPLOYER_MEMBER" --role="$DEPLOYER_PROJECT_ROLE" --condition=None --format=none
  st_created "Rol ${DEPLOYER_PROJECT_ROLE} para ${DEPLOYER_SA_NAME}"
  if ! is_dry; then IAM_FLAT="$(iam_flat)"; fi
fi
extra_roles="$(awk -F'\t' -v m="$DEPLOYER_MEMBER" -v r="$DEPLOYER_PROJECT_ROLE" '$2 == m && $1 != r {print $1}' <<<"$IAM_FLAT")"
if [[ -n "$extra_roles" ]]; then
  st_fail "${DEPLOYER_SA_NAME} tiene roles de proyecto de más: $(tr '\n' ' ' <<<"$extra_roles")"
else
  st_ok "${DEPLOYER_SA_NAME} solo tiene ${DEPLOYER_PROJECT_ROLE} a nivel de proyecto"
fi

# --- 5. Artifact Registry -------------------------------------------------------------------------
# writer SOLO sobre el repositorio de imágenes (no sobre todo el proyecto): permite subir imágenes y
# no borrarlas (la limpieza la hacen las políticas del repositorio, del lado servidor).

step "5/10 ${DEPLOYER_AR_ROLE} sobre el repositorio ${AR_REPOSITORY}"
probe gcloud artifacts repositories get-iam-policy "$AR_REPOSITORY" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --format=json \
  || die "No encuentro el repositorio ${AR_REPOSITORY} (lo crea 10_gcp_project.sh)"
ar_json="$PROBE_OUT"
if policy_has "$ar_json" "$DEPLOYER_AR_ROLE" "$DEPLOYER_MEMBER"; then
  st_ok "${DEPLOYER_AR_ROLE} para ${DEPLOYER_SA_NAME} sobre ${AR_REPOSITORY}"
else
  write_retry 6 10 gcloud artifacts repositories add-iam-policy-binding "$AR_REPOSITORY" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" \
    --member="$DEPLOYER_MEMBER" --role="$DEPLOYER_AR_ROLE" --format=none
  st_created "${DEPLOYER_AR_ROLE} para ${DEPLOYER_SA_NAME} sobre ${AR_REPOSITORY}"
fi
ar_extra="$(jq -r --arg m "$DEPLOYER_MEMBER" --arg r "$DEPLOYER_AR_ROLE" '(.bindings // [])[] | select(.role != $r) | select((.members // []) | index($m)) | .role' <<<"$ar_json")"
if [[ -n "$ar_extra" ]]; then
  st_fail "${DEPLOYER_SA_NAME} tiene otros roles sobre ${AR_REPOSITORY}: $(tr '\n' ' ' <<<"$ar_extra")"
fi

# --- 6. Actuar como la cuenta de runtime ----------------------------------------------------------
# Para desplegar una revisión o un job que corre como run-api-stg, el deployer necesita poder
# "actuar como" esa cuenta. serviceAccountUser se da SOBRE esa cuenta, no a nivel de proyecto: así
# el deployer no puede actuar como ninguna otra.

step "6/10 ${DEPLOYER_ACTAS_ROLE} sobre ${RUN_SA_NAME}"
probe gcloud iam service-accounts get-iam-policy "$RUN_SA_EMAIL" --project="$GCP_PROJECT_ID" --format=json \
  || die "No encuentro la cuenta de runtime ${RUN_SA_EMAIL} (la crea 10_gcp_project.sh)"
run_sa_policy="$PROBE_OUT"
if policy_has "$run_sa_policy" "$DEPLOYER_ACTAS_ROLE" "$DEPLOYER_MEMBER"; then
  st_ok "${DEPLOYER_ACTAS_ROLE} para ${DEPLOYER_SA_NAME} sobre ${RUN_SA_NAME}"
else
  write_retry 6 10 gcloud iam service-accounts add-iam-policy-binding "$RUN_SA_EMAIL" --project="$GCP_PROJECT_ID" \
    --member="$DEPLOYER_MEMBER" --role="$DEPLOYER_ACTAS_ROLE" --format=none
  st_created "${DEPLOYER_ACTAS_ROLE} para ${DEPLOYER_SA_NAME} sobre ${RUN_SA_NAME}"
fi
run_sa_extra="$(jq -r --arg m "$DEPLOYER_MEMBER" --arg r "$DEPLOYER_ACTAS_ROLE" '(.bindings // [])[] | select(.role != $r) | select((.members // []) | index($m)) | .role' <<<"$run_sa_policy")"
if [[ -n "$run_sa_extra" ]]; then
  st_fail "${DEPLOYER_SA_NAME} tiene otros roles sobre ${RUN_SA_NAME}: $(tr '\n' ' ' <<<"$run_sa_extra")"
fi

# --- 7. Quién puede usar la cuenta deployer -------------------------------------------------------
# workloadIdentityUser para el principalSet de este repositorio (por repository_id). Es la segunda
# barrera: aunque la condición del provider se aflojara, solo estas identidades pueden suplantar la
# cuenta. Cualquier otro miembro o rol en la política de la cuenta deployer es un fallo.

step "7/10 ${WIF_USER_ROLE} sobre ${DEPLOYER_SA_NAME} para el repositorio"
if (( DEPLOYER_EXISTS )) && probe gcloud iam service-accounts get-iam-policy "$DEPLOYER_EMAIL" --project="$GCP_PROJECT_ID" --format=json; then
  deployer_policy="$PROBE_OUT"
else
  deployer_policy='{}'
fi
if policy_has "$deployer_policy" "$WIF_USER_ROLE" "$PRINCIPAL_SET"; then
  st_ok "${WIF_USER_ROLE} para el principalSet del repositorio ${GITHUB_REPO}"
else
  write_retry 6 10 gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_EMAIL" --project="$GCP_PROJECT_ID" \
    --member="$PRINCIPAL_SET" --role="$WIF_USER_ROLE" --format=none
  st_created "${WIF_USER_ROLE} para el principalSet del repositorio ${GITHUB_REPO}"
fi
deployer_extra="$(policy_extras "$deployer_policy" "$WIF_USER_ROLE" "$PRINCIPAL_SET")"
if [[ -n "$deployer_extra" ]]; then
  st_fail "La política de ${DEPLOYER_SA_NAME} tiene permisos de más (quítalos en la consola: IAM > Cuentas de servicio > Permisos): $(tr '\n' ';' <<<"$deployer_extra")"
else
  st_ok "La política de ${DEPLOYER_SA_NAME} solo contiene el principalSet del repositorio"
fi

# --- 8. Sin llaves --------------------------------------------------------------------------------

step "8/10 Sin llaves JSON"
if (( DEPLOYER_EXISTS )); then
  if probe gcloud iam service-accounts keys list --iam-account="$DEPLOYER_EMAIL" --managed-by=user --project="$GCP_PROJECT_ID" --format='value(name)' \
     && [[ -n "$PROBE_OUT" ]]; then
    st_fail "${DEPLOYER_SA_NAME} tiene llaves de usuario; el proyecto usa identidades sin llaves"
  else
    st_ok "${DEPLOYER_SA_NAME} sin llaves de usuario"
  fi
fi
if [[ -d "$WORKFLOWS_DIR" ]]; then
  key_files="$(grep -rlE 'credentials_json|private_key|BEGIN [A-Z ]*PRIVATE KEY' "$WORKFLOWS_DIR" || true)"
  if [[ -n "$key_files" ]]; then
    st_fail "Los workflows mencionan credenciales por llave: $(tr '\n' ' ' <<<"$key_files")"
  else
    st_ok "Ningún workflow usa llaves de cuenta de servicio"
  fi
else
  st_warn "No encuentro ${WORKFLOWS_DIR}"
fi

# --- 9. Variables de repo -------------------------------------------------------------------------
# Los workflows leen vars.GCP_WIF_PROVIDER y vars.GCP_DEPLOYER_SA. No son secretos (son nombres de
# recursos), pero llevan el número de proyecto: en este log salen como <oculto>.

step "9/10 Variables de repo en ${GITHUB_REPO}"
sync_var() {
  local name="$1" want="$2" have="" state_txt=""
  if (( GH_OK )); then
    have="$(gh variable get "$name" --repo "$GITHUB_REPO" 2>/dev/null || true)"
  fi
  if [[ "$have" == "$want" ]]; then
    st_ok "Variable ${name} configurada"
  elif [[ "${SET_GH_VARS:-0}" == "1" ]]; then
    (( GH_OK )) || die "SET_GH_VARS=1 necesita gh con sesión activa"
    confirm "Escribir la variable de repo ${name} en ${GITHUB_REPO}?" || die "Cancelado"
    run gh variable set "$name" --repo "$GITHUB_REPO" --body "$want"
    st_created "Variable ${name}"
  else
    if [[ -n "$have" ]]; then state_txt="distinta de la esperada"; else state_txt="sin configurar"; fi
    st_warn "Variable ${name} ${state_txt}. Para escribirla: SET_GH_VARS=1 bash infra/scripts/30_workload_identity.sh (o: gh variable set ${name} --repo ${GITHUB_REPO} --body ${want})"
  fi
}
sync_var GCP_WIF_PROVIDER "$PROVIDER_FULL_NAME"
sync_var GCP_DEPLOYER_SA "$DEPLOYER_EMAIL"

# --- 10. Resumen ----------------------------------------------------------------------------------

step "10/10 Resumen"
summary
