#!/usr/bin/env bash
# Despliegue a staging de una imagen ya subida a Artifact Registry (KAN-16, INF-10). Es el corazón del
# CD: lo llama .github/workflows/cd-staging.yml tras construir y subir la imagen, y el humano también lo
# puede correr en local (con su sesión de gcloud) para probarlo ANTES del merge: la condición del
# proveedor WIF solo deja entrar a main, así que el workflow no se puede ejecutar desde una rama.
#
# Pasos (cada uno se detiene en rojo si algo falla, y el tráfico NO se mueve hasta el paso 6):
#   1. Estado de Cloud SQL: encendida -> se migra; apagada -> se omite el job (con aviso); otro -> rojo.
#   2. Job de migraciones: se actualiza a la imagen y se comprueba que quedó con ella.
#   3. Job de migraciones: se ejecuta (--wait) y se comprueba que la ejecución usó esa imagen y terminó bien.
#   4. Servicio: revisión nueva SIN tráfico y con la etiqueta "candidate" (URL propia).
#   5. Smoke test contra la URL de la etiqueta (GET /health); la revisión anterior sigue sirviendo.
#   6. Se mueve el tráfico a la revisión nueva (--to-latest) y se vuelve a hacer el smoke en la URL pública.
#
# Por qué sin tráfico: un despliegue normal manda el 100 % a la revisión nueva en cuanto arranca; si
# arranca pero responde mal, ya está sirviendo cuando el smoke falla. Así la revisión anterior sigue
# sirviendo hasta que la nueva demuestra que responde.
#
# Uso:
#   IMAGE=<ruta>@sha256:<digest> bash infra/scripts/cd_deploy.sh
#   DRY_RUN=1 IMAGE=... bash infra/scripts/cd_deploy.sh      # lecturas sí; escrituras solo se imprimen
#
# Variables:
#   IMAGE        (obligatoria) imagen por digest, de finance-stg/finance-api. Nada de etiquetas: un digest
#                no cambia, y es lo que se comprueba en el job, en la ejecución y en la revisión.
#   GIT_SHA      (opcional) SHA completo del commit; se guarda como etiqueta git-sha del servicio. En local,
#                pasarlo (cualquier valor de 40 hex) cambia la plantilla y fuerza una revisión nueva aunque
#                la imagen sea la ya desplegada.
#   SMOKE_PATH   (opcional, /health por defecto) ruta del smoke test. Solo para pruebas de fallo (por
#                ejemplo /nope debe dar rojo y dejar el tráfico donde estaba). En Cloud Run las rutas que
#                terminan en "z" están reservadas por Google: por eso es /health y no /healthz (KAN-43).
#   CI           si vale "true" (GitHub Actions lo define) no pregunta nada; en local pregunta una vez.
#
# No pasa --allow-unauthenticated ni flags de escalado: el despliegue solo cambia la imagen (y la
# etiqueta git-sha); el resto de la configuración se cambia a propósito en la Consola o en 40_cloud_run.sh.
set -euo pipefail

source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/../env/staging.env"
source "$(dirname "$0")/lib_sql.sh"

# Sin preguntas interactivas de gcloud: la única confirmación es la de este script (y solo en local).
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

IMAGE="${IMAGE:-}"
GIT_SHA="${GIT_SHA:-}"
SMOKE_PATH="${SMOKE_PATH:-/health}"
CANDIDATE_TAG="candidate"
IMAGE_PATH="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${AR_REPOSITORY}/${IMAGE_NAME}"
BODY_FILE=""
HTTP_TIMEOUT="${HTTP_TIMEOUT:-60}"   # el primer pedido paga el arranque en frío

cleanup() {
  if [[ -n "$BODY_FILE" ]]; then rm -f "$BODY_FILE"; fi
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

# Texto para el resumen del job de GitHub Actions (no hace nada fuera de Actions).
note() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"; fi
  return 0
}
# Aviso visible en la interfaz de GitHub (anotación); fuera de Actions es solo un aviso en el log.
gh_warning() {
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then printf '::warning::%s\n' "$*"; fi
  return 0
}

# En Actions no hay a quién preguntar; en local se pregunta una vez antes de la primera escritura.
if [[ "${CI:-}" == "true" ]]; then CONFIRMED=1; fi

# --- Comprobaciones previas --------------------------------------------------------------------------
step "0/6 Comprobaciones previas"
# No se usa sql_preflight: comprueba `gcloud auth list`, y la action de autenticación de GitHub no
# registra la cuenta en esa lista (usa un archivo de credenciales externo). En local sí se comprueba.
[[ -n "$(command -v gcloud)" ]] || die "Falta gcloud"
command -v jq >/dev/null || die "Falta jq"
command -v curl >/dev/null || die "Falta curl"
if [[ "${CI:-}" != "true" ]]; then
  [[ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)')" ]] \
    || die "No hay sesión activa de gcloud: ejecuta gcloud auth login"
fi
[[ "$GCP_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "GCP_PROJECT_ID no válido: ${GCP_PROJECT_ID}"
[[ "$GCP_PROJECT_ID" == *-stg ]] || die "GCP_PROJECT_ID debe terminar en -stg (recibido: ${GCP_PROJECT_ID})"
[[ "$GCP_REGION" == "southamerica-east1" ]] || die "Región inesperada: ${GCP_REGION}"
[[ "$SQL_INSTANCE" =~ ^[a-z][a-z0-9-]*-stg$ ]] || die "SQL_INSTANCE no válida o sin sufijo -stg: ${SQL_INSTANCE}"
[[ "$CR_SERVICE" =~ ^[a-z][a-z0-9-]*-stg$ ]] || die "CR_SERVICE no válido o sin sufijo -stg: ${CR_SERVICE}"
[[ "$CR_JOB" =~ ^[a-z][a-z0-9-]*-stg$ ]] || die "CR_JOB no válido o sin sufijo -stg: ${CR_JOB}"
[[ "$AR_REPOSITORY" == *-stg ]] || die "AR_REPOSITORY debe terminar en -stg (recibido: ${AR_REPOSITORY})"
[[ -n "$IMAGE" ]] || die "Falta IMAGE: IMAGE=${IMAGE_PATH}@sha256:<digest> bash infra/scripts/cd_deploy.sh"
[[ "$IMAGE" == "${IMAGE_PATH}@sha256:"* ]] || die "IMAGE debe ser de ${IMAGE_PATH}@sha256:<digest> (recibido: ${IMAGE})"
[[ "${IMAGE##*@sha256:}" =~ ^[0-9a-f]{64}$ ]] || die "El digest de IMAGE no es válido (se esperan 64 caracteres hexadecimales)"
[[ -z "$GIT_SHA" || "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || die "GIT_SHA debe ser el SHA completo del commit (40 caracteres hexadecimales)"
[[ "$SMOKE_PATH" =~ ^/[A-Za-z0-9/_.-]*$ ]] || die "SMOKE_PATH no válida: ${SMOKE_PATH}"
BODY_FILE="$(mktemp)"
if is_dry; then log "DRY_RUN=1: las lecturas se hacen; ninguna escritura se ejecuta"; fi
log "Proyecto ${GCP_PROJECT_ID} · región ${GCP_REGION} · servicio ${CR_SERVICE} · job ${CR_JOB}"
log "Imagen ${IMAGE}"

# La imagen tiene que estar en el registro (en Actions se acaba de subir). Sin esto, fallaría más tarde,
# con el job ya apuntando a una imagen que no existe.
probe gcloud artifacts docker images describe "$IMAGE" --project="$GCP_PROJECT_ID" --format='value(image_summary.digest)' \
  || die "La imagen no existe en ${AR_REPOSITORY}: ${IMAGE}"
st_ok "La imagen existe en Artifact Registry"

# Revisión que sirve hoy el tráfico (la única con 100 %). Es la que debe seguir sirviendo si algo falla.
probe gcloud run services describe "$CR_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
  || die "No encuentro el servicio ${CR_SERVICE}: se crea con infra/scripts/40_cloud_run.sh"
SERVICE_JSON="$PROBE_OUT"
PREV_REV="$(jq -r '[.status.traffic[]? | select(.percent == 100) | .revisionName] | if length == 1 then .[0] else "" end' <<<"$SERVICE_JSON")"
[[ -n "$PREV_REV" ]] || die "El tráfico de ${CR_SERVICE} no está al 100 % en una sola revisión; revísalo en la Consola antes de desplegar"
st_ok "Revisión que sirve hoy: ${PREV_REV}"

# --- 1. Estado de Cloud SQL --------------------------------------------------------------------------
step "1/6 Estado de la instancia ${SQL_INSTANCE}"
sql_describe
power="$(sql_power_state)"
state="$(jq -r '.state // "?"' <<<"$SQL_JSON")"
policy="$(jq -r '.settings.activationPolicy // "?"' <<<"$SQL_JSON")"
MIGRATE=0
case "$power" in
  running)
    MIGRATE=1
    st_ok "Cloud SQL encendida (${state}/${policy}): se ejecutarán las migraciones"
    ;;
  stopped)
    st_warn "Cloud SQL apagada (${state}/${policy}): se OMITEN las migraciones; el despliegue sigue (/health no usa la BD)"
    gh_warning "Migraciones omitidas: Cloud SQL esta apagada. Al encenderla (sql_power.sh start), ejecuta: gh workflow run cd-staging.yml --ref main"
    note "### Migraciones omitidas"
    note "Cloud SQL estaba apagada (${state}/${policy}), así que el job \`${CR_JOB}\` no se ejecutó. La revisión nueva puede tener un esquema más nuevo que la BD."
    note "Al encenderla con \`sql_power.sh start\`, corre \`gh workflow run cd-staging.yml --ref main\` para aplicar las migraciones pendientes."
    ;;
  *)
    die "Cloud SQL está en un estado intermedio o inesperado (${state}/${policy}); no se despliega. Espera a que termine y vuelve a correr."
    ;;
esac

# --- 2. Job de migraciones: imagen -------------------------------------------------------------------
# `gcloud run jobs execute` corre la imagen que el job YA tiene configurada, por eso primero se actualiza
# (siempre, también cuando se omite la ejecución: así el job queda al día para la próxima vez).
step "2/6 Job ${CR_JOB}: usar la imagen del commit"
if ! is_dry; then ask_apply; fi
run gcloud run jobs update "$CR_JOB" --image "$IMAGE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --quiet
if is_dry; then
  st_info "DRY_RUN=1: no se comprueba la imagen del job porque no se actualizó"
else
  probe gcloud run jobs describe "$CR_JOB" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
    || die "No encuentro el job ${CR_JOB}"
  job_image="$(jq -r '.spec.template.spec.template.spec.containers[0].image // ""' <<<"$PROBE_OUT")"
  [[ "$job_image" == "$IMAGE" ]] || die "El job quedó con otra imagen (${job_image}); se esperaba ${IMAGE}"
  st_ok "El job ${CR_JOB} usa la imagen del commit"
fi

# --- 3. Job de migraciones: ejecución ----------------------------------------------------------------
step "3/6 Migraciones (alembic upgrade head)"
# last_execution: nombre de la ejecución más reciente del job (vacío si no hay ninguna).
last_execution() {
  probe gcloud run jobs executions list --job="$CR_JOB" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --sort-by='~metadata.creationTimestamp' --limit=1 --format=json \
    || die "No pude listar las ejecuciones de ${CR_JOB}"
  jq -r '.[0].metadata.name // ""' <<<"$PROBE_OUT"
}
if (( MIGRATE == 0 )); then
  st_info "Omitidas: la instancia de Cloud SQL está apagada"
elif is_dry; then
  run gcloud run jobs execute "$CR_JOB" --wait --project="$GCP_PROJECT_ID" --region="$GCP_REGION"
  st_info "DRY_RUN=1: no se ejecuta el job ni se comprueba la ejecución"
else
  before_exec="$(last_execution)"
  exec_ok=1
  run gcloud run jobs execute "$CR_JOB" --wait --project="$GCP_PROJECT_ID" --region="$GCP_REGION" || exec_ok=0
  exec_name="$(last_execution)"
  [[ -n "$exec_name" && "$exec_name" != "$before_exec" ]] || die "No encuentro la ejecución nueva de ${CR_JOB}"
  probe gcloud run jobs executions describe "$exec_name" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
    || die "No pude leer la ejecución ${exec_name}"
  exec_json="$PROBE_OUT"
  if (( exec_ok == 0 )) || ! jq -e '(.status.succeededCount // 0) >= 1' <<<"$exec_json" >/dev/null; then
    reason="$(jq -r '[.status.conditions[]? | select(.status != "True") | .message // empty] | first // "sin detalle"' <<<"$exec_json")"
    note "### Falló la migración"
    note "Ejecución \`${exec_name}\`: ${reason:0:300}. El detalle está en los registros de Cloud Run (Consola > Cloud Run > Jobs > ${CR_JOB}). No se desplegó nada: la revisión anterior sigue sirviendo."
    die "La migración falló (ejecución ${exec_name}): ${reason:0:300}. No se despliega; la revisión ${PREV_REV} sigue sirviendo."
  fi
  exec_image="$(jq -r '.spec.template.spec.containers[0].image // ""' <<<"$exec_json")"
  [[ "$exec_image" == "$IMAGE" ]] || die "La ejecución ${exec_name} corrió con otra imagen (${exec_image}); se esperaba ${IMAGE}"
  st_ok "Ejecución ${exec_name} terminó bien y usó la imagen del commit"
fi

# --- 4. Servicio: revisión sin tráfico ---------------------------------------------------------------
step "4/6 Revisión nueva de ${CR_SERVICE} sin tráfico (etiqueta ${CANDIDATE_TAG})"
DEPLOY_ARGS=(--image "$IMAGE" --no-traffic --tag "$CANDIDATE_TAG")
if [[ -n "$GIT_SHA" ]]; then DEPLOY_ARGS+=(--update-labels="git-sha=${GIT_SHA}"); fi
run gcloud run deploy "$CR_SERVICE" "${DEPLOY_ARGS[@]}" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --quiet

CAND_REV=""
CAND_URL=""
if is_dry; then
  st_info "DRY_RUN=1: no se lee la revisión candidata porque no se desplegó"
else
  # La etiqueta puede tardar unos segundos en aparecer en la lectura del servicio.
  for attempt in 1 2 3 4 5 6; do
    probe gcloud run services describe "$CR_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
      || die "No pude leer el servicio ${CR_SERVICE}"
    SERVICE_JSON="$PROBE_OUT"
    CAND_REV="$(jq -r --arg t "$CANDIDATE_TAG" '[.status.traffic[]? | select(.tag == $t) | .revisionName] | first // ""' <<<"$SERVICE_JSON")"
    CAND_URL="$(jq -r --arg t "$CANDIDATE_TAG" '[.status.traffic[]? | select(.tag == $t) | .url] | first // ""' <<<"$SERVICE_JSON")"
    if [[ -n "$CAND_REV" && -n "$CAND_URL" ]]; then break; fi
    log "La etiqueta ${CANDIDATE_TAG} aún no aparece; reviso otra vez en 5 s (${attempt}/6)"
    sleep 5
  done
  [[ -n "$CAND_REV" && -n "$CAND_URL" ]] || die "No encuentro la etiqueta ${CANDIDATE_TAG} en ${CR_SERVICE} tras el despliegue"

  probe gcloud run revisions describe "$CAND_REV" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
    || die "No pude leer la revisión ${CAND_REV}"
  cand_image="$(jq -r '.spec.containers[0].image // ""' <<<"$PROBE_OUT")"
  [[ "$cand_image" == "$IMAGE" ]] || die "La revisión ${CAND_REV} usa otra imagen (${cand_image}); se esperaba ${IMAGE}"
  st_ok "Revisión candidata ${CAND_REV} con la imagen del commit"

  # La garantía del diseño: el tráfico no se movió. Si fuera de otro modo (p. ej. una versión de gcloud
  # que mantiene "latestRevision" con --no-traffic), no hay forma de proteger la revisión anterior desde
  # aquí: se detiene y se dice cómo volver.
  prev_pct="$(jq -r --arg r "$PREV_REV" '[.status.traffic[]? | select(.revisionName == $r) | .percent // 0] | add // 0' <<<"$SERVICE_JSON")"
  if [[ "$prev_pct" != "100" ]]; then
    die "El tráfico se movió sin permiso (la revisión ${PREV_REV} tiene ${prev_pct} %). Para volver: gcloud run services update-traffic ${CR_SERVICE} --to-revisions=${PREV_REV}=100 --project=${GCP_PROJECT_ID} --region=${GCP_REGION}"
  fi
  st_ok "La revisión anterior (${PREV_REV}) sigue con el 100 % del tráfico"
fi

# --- smoke -------------------------------------------------------------------------------------------
# smoke <url base>: GET <url><SMOKE_PATH> debe responder 200 con {"status":"ok"}. Reintenta: la primera
# petición paga el arranque en frío.
smoke() {
  local base="$1" code="000" i
  for i in 1 2 3 4 5; do
    code="$(curl -sS --max-time "$HTTP_TIMEOUT" -o "$BODY_FILE" -w '%{http_code}' "${base}${SMOKE_PATH}" 2>/dev/null)" || true
    code="${code:-000}"
    if [[ "$code" == "200" ]] && jq -e '.status == "ok"' "$BODY_FILE" >/dev/null 2>&1; then
      return 0
    fi
    log "Smoke ${base}${SMOKE_PATH}: HTTP ${code}; reintento en 5 s (${i}/5)"
    sleep 5
  done
  log "Respuesta (primeros 300 caracteres): $(head -c 300 "$BODY_FILE" | tr '\n' ' ')"
  return 1
}

step "5/6 Smoke test de la revisión candidata (sin tráfico)"
if is_dry; then
  st_info "DRY_RUN=1: se haría GET <url de la etiqueta ${CANDIDATE_TAG}>${SMOKE_PATH}"
else
  if ! smoke "$CAND_URL"; then
    note "### Falló el smoke test"
    note "La revisión \`${CAND_REV}\` no respondió bien en \`${SMOKE_PATH}\`. No recibió tráfico: la revisión \`${PREV_REV}\` sigue sirviendo."
    die "El smoke test de ${CAND_REV} falló. El tráfico no se movió: la revisión ${PREV_REV} sigue sirviendo."
  fi
  st_ok "La revisión candidata responde en ${SMOKE_PATH}"
fi

# --- 6. Mover el tráfico -----------------------------------------------------------------------------
step "6/6 Mover el tráfico a la revisión nueva"
# --to-latest devuelve el servicio a su forma original (latestRevision al 100 %).
run gcloud run services update-traffic "$CR_SERVICE" --to-latest --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --quiet
if is_dry; then
  st_info "DRY_RUN=1: no se comprueba el tráfico ni el smoke público"
else
  for attempt in 1 2 3 4 5 6; do
    probe gcloud run services describe "$CR_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
      || die "No pude leer el servicio ${CR_SERVICE}"
    SERVICE_JSON="$PROBE_OUT"
    cand_pct="$(jq -r --arg r "$CAND_REV" '[.status.traffic[]? | select(.revisionName == $r) | .percent // 0] | add // 0' <<<"$SERVICE_JSON")"
    if [[ "$cand_pct" == "100" ]]; then break; fi
    log "El tráfico aún no está en ${CAND_REV} (${cand_pct} %); reviso otra vez en 5 s (${attempt}/6)"
    sleep 5
  done
  [[ "$cand_pct" == "100" ]] || die "Tras mover el tráfico, ${CAND_REV} tiene ${cand_pct} %. Revisa el servicio en la Consola."
  st_ok "La revisión ${CAND_REV} tiene el 100 % del tráfico"

  SERVICE_URL="$(jq -r '.status.url // ""' <<<"$SERVICE_JSON")"
  [[ -n "$SERVICE_URL" ]] || die "El servicio no informa su URL"
  if ! smoke "$SERVICE_URL"; then
    note "### Falló el smoke test público"
    note "La revisión \`${CAND_REV}\` ya recibe el tráfico y no responde bien. Para volver a la anterior: \`gcloud run services update-traffic ${CR_SERVICE} --to-revisions=${PREV_REV}=100 --project=${GCP_PROJECT_ID} --region=${GCP_REGION}\`."
    die "El smoke test público falló con la revisión ${CAND_REV} ya sirviendo. Para volver a la anterior: gcloud run services update-traffic ${CR_SERVICE} --to-revisions=${PREV_REV}=100 --project=${GCP_PROJECT_ID} --region=${GCP_REGION}"
  fi
  st_ok "El servicio público responde en ${SMOKE_PATH}"
  note "### Despliegue a staging"
  note "- Imagen: \`${IMAGE}\`"
  note "- Revisión nueva: \`${CAND_REV}\` (antes \`${PREV_REV}\`)"
  if (( MIGRATE == 1 )); then note "- Migraciones: ejecutadas"; else note "- Migraciones: **omitidas** (Cloud SQL apagada)"; fi
fi

summary_check
