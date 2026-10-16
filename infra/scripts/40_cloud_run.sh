#!/usr/bin/env bash
# Cloud Run de staging (KAN-13, INF-07): servicio del backend y job de migraciones, los dos con la
# MISMA imagen y la misma cuenta de servicio (run-api-stg). Idempotente: lee lo que ya existe, crea lo
# que falta y, si algo ya existe, solo lo COMPARA con lo declarado (avisa de las diferencias, nunca lo
# modifica). Refleja el estado que el humano crea a mano en la Consola, así que en kanza-stg una
# corrida debería limitarse a verificar, y sirve también para recrear staging desde cero.
#
# Qué declara:
#   - Servicio finance-api-stg: público (sin autenticación en el Hito 0), de 0 a 2 instancias,
#     DB_PASSWORD desde Secret Manager y el resto de variables de infra/env/staging.env.
#   - Job finance-migrate-stg: `alembic upgrade head`, una tarea, sin reintentos, 10 minutos máximo.
#   - Presupuesto de conexiones a Cloud SQL (criterio 3): falla si instancias x pool no cabe.
#
# Uso:
#   DRY_RUN=1 bash infra/scripts/40_cloud_run.sh                      # solo lecturas: imprime lo que haría
#   IMAGE_TAG=<etiqueta> bash infra/scripts/40_cloud_run.sh           # crea lo que falte (pide confirmación)
#
# IMAGE_TAG es la etiqueta que subió cloud_run_image.sh. Solo hace falta si hay que crear algo: si el
# servicio y el job ya existen, el script solo compara y no usa la imagen.
#
# Reglas que este script nunca rompe:
#   - Un servicio o job existente solo se COMPARA. Una revisión nueva cambia lo que corre en staging, y
#     el CD (KAN-16) solo cambiará la imagen; la configuración se cambia en la Consola o aquí, a propósito.
#   - Nunca enciende ni apaga Cloud SQL (eso es sql_power.sh) ni ejecuta el job (eso es cloud_run_check.sh).
#   - Nunca lee el valor de un secreto: solo se referencia por nombre y versión.
#   - Nunca define DATABASE_URL ni FIREBASE_AUTH_EMULATOR_HOST. Si el servicio o el job las tienen, es
#     un [FALLO]: con la segunda la app se niega a arrancar y con la primera ignora el Connector.
#
# Con DRY_RUN=1 las lecturas SÍ se hacen contra la nube; solo se omiten las escrituras.
set -euo pipefail

source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/../env/staging.env"
source "$(dirname "$0")/lib_sql.sh"

# Sin preguntas interactivas de gcloud: la única confirmación es la de este script.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

# --- Estado deseado -----------------------------------------------------------------------------

RUN_SA_EMAIL="${RUN_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
AR_HOST="${GCP_REGION}-docker.pkg.dev"
IMAGE_PATH="${AR_HOST}/${GCP_PROJECT_ID}/${AR_REPOSITORY}/${IMAGE_NAME}"
IMAGE_TAG="${IMAGE_TAG:-}"
IMAGE="${IMAGE_PATH}:${IMAGE_TAG:-<IMAGE_TAG>}"

SECRET_ACCESSOR_ROLE="roles/secretmanager.secretAccessor"
SQL_CLIENT_ROLE="roles/cloudsql.client"
INVOKER_ROLE="roles/run.invoker"
# DB_PASSWORD viene del secreto, siempre en su última versión (decisión de KAN-13 para staging).
SECRET_VERSION="latest"
JOB_COMMAND="alembic"
JOB_ARGS="upgrade,head"

# Valores por defecto de Settings en backend/app/core/config.py (si el servicio no define el pool).
APP_DEFAULT_POOL_SIZE=2
APP_DEFAULT_MAX_OVERFLOW=3

# APIs que usa este script (las habilita 10_gcp_project.sh). sqladmin la usa el Connector en runtime.
NEEDED_APIS=(
  run.googleapis.com
  artifactregistry.googleapis.com
  secretmanager.googleapis.com
  sqladmin.googleapis.com
  iam.googleapis.com
  cloudresourcemanager.googleapis.com
)

# Variables en texto plano, una por línea (KEY=valor). Las del servicio y las del job difieren solo en
# el pool y en GOOGLE_CLOUD_PROJECT (el job no sirve peticiones ni usa pool: abre 1 conexión sin pool).
# FIREBASE_PROJECT_ID y ALLOWED_ORIGINS van en el job aunque no los use: alembic construye los mismos
# Settings que la API, y sin ellos fallaría la validación al arrancar.
desired_env() {
  printf '%s\n' \
    "ENV=staging" \
    "FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}" \
    "ALLOWED_ORIGINS=${STAGING_ALLOWED_ORIGINS}" \
    "INSTANCE_CONNECTION_NAME=${SQL_CONNECTION_NAME}" \
    "DB_USER=${DB_USER}" \
    "DB_NAME=${DB_NAME}"
  if [[ "$1" == "service" ]]; then
    printf '%s\n' \
      "GOOGLE_CLOUD_PROJECT=${GCP_PROJECT_ID}" \
      "DB_POOL_SIZE=${CR_DB_POOL_SIZE}" \
      "DB_MAX_OVERFLOW=${CR_DB_MAX_OVERFLOW}"
  fi
}

# Argumento de gcloud con un delimitador propio (^@^): ALLOWED_ORIGINS puede llevar comas.
env_arg() {
  local out="^@^" first=1 line
  while IFS= read -r line; do
    if (( first )); then out+="$line"; first=0; else out+="@${line}"; fi
  done < <(desired_env "$1")
  printf '%s' "$out"
}

# Filtros de jq comunes. El servicio y el job tienen formas distintas: en el job, el contenedor y sus
# opciones cuelgan de spec.template.spec.template.spec.
JQ_DEFS='
  def ctr: ((.spec.template.spec.containers // .spec.template.spec.template.spec.containers // [])[0] // {});
  def tspec: (if .kind == "Job" then .spec.template.spec.template.spec else .spec.template.spec end);
'
# Variables del contenedor como líneas KEY=valor; un secreto se muestra como KEY=secret:<nombre>:<versión>.
JQ_ENV='ctr | (.env // []) | map(
  if .valueFrom.secretKeyRef then "\(.name)=secret:\(.valueFrom.secretKeyRef.name):\(.valueFrom.secretKeyRef.key)"
  else "\(.name)=\(.value // "")" end) | sort | .[]'

# Lectura de un campo de un recurso ya cargado (primer argumento: el JSON).
live() { jq -r "${JQ_DEFS} $2" <<<"$1"; }

# 1000m y 1 son lo mismo: la API devuelve milésimas.
norm_cpu() {
  if [[ "$1" =~ ^[0-9]+$ ]]; then printf '%sm' "$(( $1 * 1000 ))"; else printf '%s' "$1"; fi
}

DRIFT=()
expect() { # etiqueta, valor leído, valor esperado
  if [[ "$2" != "$3" ]]; then
    DRIFT+=("$1=${2:-<vacío>} (esperado ${3:-<vacío>})")
  fi
}

# Compara las variables de un recurso con las declaradas (más la referencia al secreto).
compare_env() { # JSON del recurso, "service" o "job", nombre para mostrar
  local -A got want
  local line key
  while IFS= read -r line; do
    [[ -n "$line" ]] && got["${line%%=*}"]="${line#*=}"
  done < <(live "$1" "$JQ_ENV")
  while IFS= read -r line; do
    want["${line%%=*}"]="${line#*=}"
  done < <(desired_env "$2"; printf 'DB_PASSWORD=secret:%s:%s\n' "$DB_PASSWORD_SECRET" "$SECRET_VERSION")
  for key in "${!want[@]}"; do
    if [[ ! -v got[$key] ]]; then
      DRIFT+=("falta la variable ${key}")
    elif [[ "${got[$key]}" != "${want[$key]}" ]]; then
      DRIFT+=("${key}=${got[$key]} (esperado ${want[$key]})")
    fi
  done
  for key in "${!got[@]}"; do
    [[ -v want[$key] ]] && continue
    case "$key" in
      DATABASE_URL | FIREBASE_AUTH_EMULATOR_HOST)
        st_fail "${3} define ${key}: no debe estar (con FIREBASE_AUTH_EMULATOR_HOST la app no arranca; DATABASE_URL anula el Connector)" ;;
      *) DRIFT+=("variable de más: ${key}") ;;
    esac
  done
}

report_drift() { # etiqueta del recurso
  if (( ${#DRIFT[@]} == 0 )); then
    st_ok "$1 coincide con lo declarado"
  else
    local d
    for d in "${DRIFT[@]}"; do
      st_warn "$1: ${d}"
    done
  fi
  DRIFT=()
}

# Comparaciones con lo declarado. Son funciones (y no código suelto) para poder probarlas sin la nube,
# con un JSON de ejemplo en SERVICE_JSON / JOB_JSON.

check_service() {
  local got_image got_image_path ingress
  got_image="$(live "$SERVICE_JSON" 'ctr.image // ""')"
  # Sin etiqueta ni digest: la imagen cambia en cada despliegue, la ruta no.
  got_image_path="$(sed -E 's/@sha256:[0-9a-f]+$//; s/:[^/:]+$//' <<<"$got_image")"
  expect "ruta de la imagen" "$got_image_path" "$IMAGE_PATH"
  expect "cuenta de servicio" "$(live "$SERVICE_JSON" 'tspec.serviceAccountName // ""')" "$RUN_SA_EMAIL"
  expect "mínimo de instancias" "$(live "$SERVICE_JSON" '.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"] // "0"')" "$CR_MIN_INSTANCES"
  expect "máximo de instancias" "$(live "$SERVICE_JSON" '.spec.template.metadata.annotations["autoscaling.knative.dev/maxScale"] // ""')" "$CR_MAX_INSTANCES"
  expect "CPU" "$(norm_cpu "$(live "$SERVICE_JSON" 'ctr.resources.limits.cpu // ""')")" "$(norm_cpu "$CR_CPU")"
  expect "memoria" "$(live "$SERVICE_JSON" 'ctr.resources.limits.memory // ""')" "$CR_MEMORY"
  expect "puerto" "$(live "$SERVICE_JSON" '(ctr.ports // [])[0].containerPort // 8080')" "$CR_PORT"
  expect "comando (debe ser el de la imagen)" "$(live "$SERVICE_JSON" '(ctr.command // []) | join(" ")')" ""
  expect "argumentos (deben ser los de la imagen)" "$(live "$SERVICE_JSON" '(ctr.args // []) | join(" ")')" ""
  ingress="$(live "$SERVICE_JSON" '.metadata.annotations["run.googleapis.com/ingress"] // ""')"
  if [[ -n "$ingress" ]]; then expect "entrada (ingress)" "$ingress" "all"; fi
  expect "etiqueta env" "$(live "$SERVICE_JSON" '.metadata.labels.env // ""')" "$ENV_LABEL"
  compare_env "$SERVICE_JSON" service "El servicio ${CR_SERVICE}"
  # También tras crearlo: si lo recién creado difiere de lo declarado, hay que saberlo.
  report_drift "Servicio ${CR_SERVICE}"
  SERVICE_URL="$(live "$SERVICE_JSON" '.status.url // ""')"
  [[ -z "$SERVICE_URL" ]] || st_info "URL del servicio: ${SERVICE_URL}"
}

check_job() {
  local got_image got_image_path
  got_image="$(live "$JOB_JSON" 'ctr.image // ""')"
  got_image_path="$(sed -E 's/@sha256:[0-9a-f]+$//; s/:[^/:]+$//' <<<"$got_image")"
  expect "ruta de la imagen" "$got_image_path" "$IMAGE_PATH"
  expect "cuenta de servicio" "$(live "$JOB_JSON" 'tspec.serviceAccountName // ""')" "$RUN_SA_EMAIL"
  expect "comando" "$(live "$JOB_JSON" '(ctr.command // []) | join(" ")')" "$JOB_COMMAND"
  expect "argumentos" "$(live "$JOB_JSON" '(ctr.args // []) | join(",")')" "$JOB_ARGS"
  expect "tareas" "$(live "$JOB_JSON" '.spec.template.spec.taskCount // 1 | tostring')" "1"
  expect "paralelismo" "$(live "$JOB_JSON" '.spec.template.spec.parallelism // 1 | tostring')" "1"
  expect "reintentos máximos" "$(live "$JOB_JSON" 'tspec.maxRetries // 0 | tostring')" "$CR_JOB_MAX_RETRIES"
  expect "tiempo máximo de la tarea (s)" "$(live "$JOB_JSON" 'tspec.timeoutSeconds // "" | tostring')" "$CR_JOB_TIMEOUT_SECONDS"
  expect "CPU" "$(norm_cpu "$(live "$JOB_JSON" 'ctr.resources.limits.cpu // ""')")" "$(norm_cpu "$CR_CPU")"
  expect "memoria" "$(live "$JOB_JSON" 'ctr.resources.limits.memory // ""')" "$CR_MEMORY"
  expect "etiqueta env" "$(live "$JOB_JSON" '.metadata.labels.env // ""')" "$ENV_LABEL"
  compare_env "$JOB_JSON" job "El job ${CR_JOB}"
  report_drift "Job ${CR_JOB}"
}

# Máximo de instancias x tamaño del pool tiene que caber en max_connections (criterio 3). Usa los valores
# VIVOS del servicio si existe y, si no, los declarados.
check_budget() {
  local max_inst="$CR_MAX_INSTANCES" pool="$CR_DB_POOL_SIZE" overflow="$CR_DB_MAX_OVERFLOW"
  local per_instance literal usable worst
  if [[ -n "$SERVICE_JSON" ]]; then
    max_inst="$(live "$SERVICE_JSON" '.spec.template.metadata.annotations["autoscaling.knative.dev/maxScale"] // ""')"
    pool="$(live "$SERVICE_JSON" '(ctr.env // []) | map(select(.name == "DB_POOL_SIZE") | .value) | first // empty')"
    overflow="$(live "$SERVICE_JSON" '(ctr.env // []) | map(select(.name == "DB_MAX_OVERFLOW") | .value) | first // empty')"
    pool="${pool:-$APP_DEFAULT_POOL_SIZE}"
    overflow="${overflow:-$APP_DEFAULT_MAX_OVERFLOW}"
  fi
  if [[ ! "$max_inst" =~ ^[0-9]+$ || ! "$pool" =~ ^[0-9]+$ || ! "$overflow" =~ ^[0-9]+$ ]]; then
    st_fail "No puedo hacer la cuenta: el servicio no tiene un máximo de instancias numérico (máx=${max_inst:-<sin límite>}, pool=${pool}, overflow=${overflow})"
  else
    per_instance=$(( pool + overflow ))
    literal=$(( max_inst * per_instance ))
    usable=$(( SQL_MAX_CONNECTIONS - SQL_RESERVED_CONNECTIONS - SQL_INTERNAL_CONNECTIONS - JOB_CONNECTIONS - ADMIN_CONNECTIONS ))
    worst=$(( CR_REVISIONS_IN_ROLLOUT * max_inst * per_instance ))
    st_info "max_connections=${SQL_MAX_CONNECTIONS} - reservadas ${SQL_RESERVED_CONNECTIONS} - internas ${SQL_INTERNAL_CONNECTIONS} (estimación) - job ${JOB_CONNECTIONS} - manuales ${ADMIN_CONNECTIONS} = ${usable} para el servicio"
    st_info "Servicio: ${max_inst} instancias x (pool ${pool} + overflow ${overflow}) = ${literal}; con ${CR_REVISIONS_IN_ROLLOUT} revisiones a la vez en un despliegue = ${worst}"
    if (( literal <= SQL_MAX_CONNECTIONS )); then
      st_ok "Criterio 3: ${max_inst} x ${per_instance} = ${literal} <= max_connections (${SQL_MAX_CONNECTIONS})"
    else
      st_fail "Criterio 3: ${max_inst} x ${per_instance} = ${literal} supera max_connections (${SQL_MAX_CONNECTIONS})"
    fi
    if (( worst <= usable )); then
      st_ok "Peor caso de un despliegue: ${worst} <= ${usable} disponibles (margen ${usable} - ${worst} = $(( usable - worst )))"
      if (( usable - worst < per_instance )); then
        st_warn "El margen (${usable} - ${worst}) es menor que una instancia extra (${per_instance}): Cloud Run puede superar el máximo un instante"
      fi
    else
      st_fail "Peor caso de un despliegue: ${worst} supera las ${usable} conexiones disponibles. Baja CR_DB_POOL_SIZE, CR_DB_MAX_OVERFLOW o CR_MAX_INSTANCES"
    fi
  fi
}

# --- 0. Comprobaciones previas --------------------------------------------------------------------

step "0/7 Comprobaciones previas"
sql_preflight
[[ "$CR_SERVICE" =~ ^[a-z][a-z0-9-]*-stg$ ]] || die "CR_SERVICE no válido o sin sufijo -stg: ${CR_SERVICE}"
[[ "$CR_JOB" =~ ^[a-z][a-z0-9-]*-stg$ ]] || die "CR_JOB no válido o sin sufijo -stg: ${CR_JOB}"
[[ "$AR_REPOSITORY" == *-stg ]] || die "AR_REPOSITORY debe terminar en -stg (recibido: ${AR_REPOSITORY})"
[[ "$DB_PASSWORD_SECRET" =~ ^[a-z][a-z0-9-]*-stg$ ]] || die "DB_PASSWORD_SECRET no válido o sin sufijo -stg: ${DB_PASSWORD_SECRET}"
for n in CR_PORT CR_MIN_INSTANCES CR_MAX_INSTANCES CR_JOB_TIMEOUT_SECONDS CR_JOB_MAX_RETRIES CR_DB_POOL_SIZE CR_DB_MAX_OVERFLOW \
         SQL_MAX_CONNECTIONS SQL_RESERVED_CONNECTIONS SQL_INTERNAL_CONNECTIONS JOB_CONNECTIONS ADMIN_CONNECTIONS CR_REVISIONS_IN_ROLLOUT; do
  [[ "${!n}" =~ ^[0-9]+$ ]] || die "${n} debe ser un entero (recibido: ${!n})"
done
(( CR_MIN_INSTANCES == 0 )) || die "CR_MIN_INSTANCES debe ser 0 en staging (costo mínimo): hoy vale ${CR_MIN_INSTANCES}"
(( CR_MAX_INSTANCES >= 1 )) || die "CR_MAX_INSTANCES debe ser al menos 1"
(( CR_DB_POOL_SIZE >= 1 )) || die "CR_DB_POOL_SIZE debe ser al menos 1"
[[ "$CR_MEMORY" =~ ^[0-9]+(Mi|Gi)$ ]] || die "CR_MEMORY no válida (ej. 512Mi): ${CR_MEMORY}"
[[ "$CR_CPU" =~ ^[0-9]+$ ]] || die "CR_CPU debe ser un entero de CPU (ej. 1): ${CR_CPU}"
# El delimitador de --set-env-vars es @: ningún valor puede llevarlo.
if desired_env service | grep -q '.@'; then
  die "Algún valor de variable contiene @, que se usa como delimitador de gcloud: revisa staging.env"
fi
[[ -n "$STAGING_ALLOWED_ORIGINS" ]] || die "STAGING_ALLOWED_ORIGINS está vacío: la app exige ALLOWED_ORIGINS en staging"
if is_dry; then
  log "DRY_RUN=1: solo lecturas; ninguna escritura se ejecuta"
fi
log "Proyecto ${GCP_PROJECT_ID} · región ${GCP_REGION} · servicio ${CR_SERVICE} · job ${CR_JOB}"

probe gcloud services list --enabled --project="$GCP_PROJECT_ID" --format='value(config.name)' \
  || die "No pude listar las APIs habilitadas"
missing_apis=()
for api in "${NEEDED_APIS[@]}"; do
  grep -Fxq -- "$api" <<<"$PROBE_OUT" || missing_apis+=("$api")
done
if (( ${#missing_apis[@]} > 0 )); then
  die "Faltan APIs habilitadas: ${missing_apis[*]}. Corre primero bash infra/scripts/10_gcp_project.sh"
fi
st_ok "APIs necesarias habilitadas"

probe gcloud iam service-accounts describe "$RUN_SA_EMAIL" --project="$GCP_PROJECT_ID" --format=json \
  || die "No existe la cuenta de servicio ${RUN_SA_EMAIL}. Corre primero bash infra/scripts/10_gcp_project.sh"
st_ok "Cuenta de servicio de runtime ${RUN_SA_EMAIL}"

# El runtime necesita: Cloud SQL Client (proyecto) para el Connector y leer SOLO el secreto de la contraseña.
probe gcloud projects get-iam-policy "$GCP_PROJECT_ID" --flatten='bindings[].members' --format='value(bindings.role,bindings.members)' \
  || die "No pude leer la política IAM del proyecto"
if awk -F'\t' -v m="serviceAccount:${RUN_SA_EMAIL}" -v r="$SQL_CLIENT_ROLE" '$2 == m && $1 == r {found=1} END {exit !found}' <<<"$PROBE_OUT"; then
  st_ok "${RUN_SA_NAME} tiene ${SQL_CLIENT_ROLE} (el Connector lo necesita)"
else
  st_fail "${RUN_SA_NAME} no tiene ${SQL_CLIENT_ROLE}: el Connector no podrá conectar. Corre bash infra/scripts/10_gcp_project.sh"
fi
probe gcloud secrets get-iam-policy "$DB_PASSWORD_SECRET" --project="$GCP_PROJECT_ID" --format=json \
  || die "No existe el secreto ${DB_PASSWORD_SECRET}. Corre primero bash infra/scripts/20_cloud_sql.sh"
if jq -e --arg r "$SECRET_ACCESSOR_ROLE" --arg m "serviceAccount:${RUN_SA_EMAIL}" \
     'any(.bindings[]?; .role == $r and ((.members // []) | index($m) != null))' <<<"$(sed -n '/^{/,$p' <<<"$PROBE_OUT")" >/dev/null; then
  st_ok "${RUN_SA_NAME} puede leer el secreto ${DB_PASSWORD_SECRET}"
else
  st_fail "${RUN_SA_NAME} no tiene ${SECRET_ACCESSOR_ROLE} sobre ${DB_PASSWORD_SECRET}: el servicio y el job no arrancarían. Corre bash infra/scripts/20_cloud_sql.sh"
fi

# Lo que ya existe en Cloud Run. Se usa `list` y no `describe`: el texto del error de un recurso que
# falta no es estable, y la lista ya trae el recurso completo.
probe gcloud run services list --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
  || die "No pude listar los servicios de Cloud Run"
SERVICE_JSON="$(jq -c --arg n "$CR_SERVICE" '[.[]? | select(.metadata.name == $n)] | first // empty' <<<"$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")")"
probe gcloud run jobs list --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
  || die "No pude listar los jobs de Cloud Run"
JOB_JSON="$(jq -c --arg n "$CR_JOB" '[.[]? | select(.metadata.name == $n)] | first // empty' <<<"$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")")"
if [[ -n "$SERVICE_JSON" ]]; then st_info "El servicio ${CR_SERVICE} existe: se compara"; else st_info "El servicio ${CR_SERVICE} no existe"; fi
if [[ -n "$JOB_JSON" ]]; then st_info "El job ${CR_JOB} existe: se compara"; else st_info "El job ${CR_JOB} no existe"; fi

# --- 1. Imagen ------------------------------------------------------------------------------------
# Solo hace falta si hay que crear algo. La imagen se sube antes con cloud_run_image.sh.

step "1/7 Imagen"
if [[ -n "$SERVICE_JSON" && -n "$JOB_JSON" ]]; then
  st_info "El servicio y el job ya existen: no hace falta imagen (solo se compara su ruta)"
elif [[ -z "$IMAGE_TAG" ]]; then
  if is_dry; then
    st_warn "Falta IMAGE_TAG para crear lo que falta; los comandos de abajo llevan <IMAGE_TAG> como relleno"
  else
    die "Hay que crear recursos y falta IMAGE_TAG. Sube la imagen con bash infra/scripts/cloud_run_image.sh y vuelve a correr con IMAGE_TAG=<etiqueta>"
  fi
else
  if probe gcloud artifacts docker images describe "$IMAGE" --project="$GCP_PROJECT_ID" --format='value(image_summary.digest)'; then
    st_ok "La imagen ${IMAGE} está en Artifact Registry (${PROBE_OUT})"
  elif is_dry; then
    st_warn "La imagen ${IMAGE} no está en Artifact Registry todavía (en dry-run solo se avisa)"
  else
    die "La imagen ${IMAGE} no está en Artifact Registry. Súbela con bash infra/scripts/cloud_run_image.sh"
  fi
fi

# --- 2. Servicio ----------------------------------------------------------------------------------
# Público (Hito 0: sin autenticación ni header secreto) y barato: mínimo 0 instancias, máximo 2 como freno
# de costo y de conexiones. El Connector de Python entra por IP pública, así que NO se añade ninguna
# "conexión de Cloud SQL" al servicio. La CPU se factura solo mientras atiende peticiones. El comando
# de arranque es el CMD de la imagen (uvicorn con logs JSON): aquí no se sobrescribe.

step "2/7 Servicio ${CR_SERVICE}"
if [[ -z "$SERVICE_JSON" ]]; then
  write gcloud run deploy "$CR_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
    --image="$IMAGE" --service-account="$RUN_SA_EMAIL" --port="$CR_PORT" \
    --min-instances="$CR_MIN_INSTANCES" --max-instances="$CR_MAX_INSTANCES" \
    --cpu="$CR_CPU" --memory="$CR_MEMORY" --ingress=all --allow-unauthenticated \
    --set-env-vars="$(env_arg service)" --set-secrets="DB_PASSWORD=${DB_PASSWORD_SECRET}:${SECRET_VERSION}" \
    --labels="env=${ENV_LABEL}" --quiet
  st_created "Servicio ${CR_SERVICE}"
  if ! is_dry; then
    probe gcloud run services list --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
      || die "No pude releer el servicio creado"
    SERVICE_JSON="$(jq -c --arg n "$CR_SERVICE" '[.[]? | select(.metadata.name == $n)] | first // empty' <<<"$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")")"
  fi
fi
if [[ -n "$SERVICE_JSON" ]]; then
  check_service
fi

# --- 3. Acceso público ----------------------------------------------------------------------------
# allUsers con roles/run.invoker: cualquiera puede llamar al servicio (decisión del Hito 0). Lo abre
# --allow-unauthenticated al crear. Si el servicio ya existía y no es público, es [FALLO] (el criterio 1
# no se cumpliría): no se cambia solo.

step "3/7 Acceso público de ${CR_SERVICE}"
if [[ -z "$SERVICE_JSON" ]]; then
  st_info "El servicio se crearía con --allow-unauthenticated (acceso público)"
else
  probe gcloud run services get-iam-policy "$CR_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
    || die "No pude leer la política IAM del servicio"
  if jq -e --arg r "$INVOKER_ROLE" 'any(.bindings[]?; .role == $r and ((.members // []) | index("allUsers") != null))' \
       <<<"$(sed -n '/^{/,$p' <<<"$PROBE_OUT")" >/dev/null; then
    st_ok "allUsers tiene ${INVOKER_ROLE} sobre el servicio (público)"
  else
    st_fail "El servicio no es público (falta allUsers con ${INVOKER_ROLE}). En la Consola: Seguridad > Autenticación > Permitir acceso público; o gcloud run services add-iam-policy-binding ${CR_SERVICE} --project=${GCP_PROJECT_ID} --region=${GCP_REGION} --member=allUsers --role=${INVOKER_ROLE}"
  fi
fi

# --- 4. Job de migraciones ------------------------------------------------------------------------
# Misma imagen, otro comando: `alembic upgrade head`. Una tarea y SIN reintentos: una migración rota
# debe fallar a la vista y no repetirse sola sobre un estado a medias. Misma cuenta de servicio que el
# servicio (el usuario de BD es el mismo, así que otra cuenta no aislaría nada). Se ejecuta con
# cloud_run_check.sh, nunca al arrancar la app.

step "4/7 Job ${CR_JOB}"
if [[ -z "$JOB_JSON" ]]; then
  write gcloud run jobs create "$CR_JOB" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
    --image="$IMAGE" --service-account="$RUN_SA_EMAIL" \
    --command="$JOB_COMMAND" --args="$JOB_ARGS" \
    --tasks=1 --parallelism=1 --max-retries="$CR_JOB_MAX_RETRIES" --task-timeout="${CR_JOB_TIMEOUT_SECONDS}s" \
    --cpu="$CR_CPU" --memory="$CR_MEMORY" \
    --set-env-vars="$(env_arg job)" --set-secrets="DB_PASSWORD=${DB_PASSWORD_SECRET}:${SECRET_VERSION}" \
    --labels="env=${ENV_LABEL}"
  st_created "Job ${CR_JOB}"
  if ! is_dry; then
    probe gcloud run jobs list --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
      || die "No pude releer el job creado"
    JOB_JSON="$(jq -c --arg n "$CR_JOB" '[.[]? | select(.metadata.name == $n)] | first // empty' <<<"$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")")"
  fi
fi
if [[ -n "$JOB_JSON" ]]; then
  check_job
fi

# --- 5. Presupuesto de conexiones (criterio 3) ----------------------------------------------------
# Máximo de instancias x tamaño del pool tiene que caber en max_connections. La cuenta completa está en
# infra/RECURSOS.md: de las 25 conexiones se descuentan las reservadas para superusuarios, las internas
# de Cloud SQL (estimación hasta medirlas con sql_check.sh), la del job y las manuales; lo que queda
# se reparte entre las revisiones que pueden convivir en un despliegue. Se usan los valores VIVOS del
# servicio si existe, y si no los declarados.

step "5/7 Presupuesto de conexiones a Cloud SQL"
check_budget

# --- 6. Cloud SQL y siguientes pasos --------------------------------------------------------------
# Solo lectura: este script no enciende ni apaga la instancia.

step "6/7 Estado de Cloud SQL"
if sql_instance_exists; then
  sql_describe
  case "$(sql_power_state)" in
    running) st_warn "La instancia ${SQL_INSTANCE} está ENCENDIDA y se cobra por hora. Cuando termines, apágala con: bash infra/scripts/sql_power.sh stop" ;;
    stopped) st_info "La instancia ${SQL_INSTANCE} está apagada: el job de migraciones fallará hasta que la enciendas (bash infra/scripts/sql_power.sh start)" ;;
    *) st_info "La instancia ${SQL_INSTANCE} está en un estado intermedio" ;;
  esac
else
  st_warn "No existe la instancia ${SQL_INSTANCE}: corre bash infra/scripts/20_cloud_sql.sh"
fi
st_info "Siguiente: con la instancia encendida, RUN_JOB=1 bash infra/scripts/cloud_run_check.sh"

step "7/7 Resumen"
summary
