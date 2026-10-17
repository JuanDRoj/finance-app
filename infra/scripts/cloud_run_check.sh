#!/usr/bin/env bash
# Prueba de Cloud Run de staging (KAN-13, INF-07): deja evidencia repetible de los criterios del ticket.
#
#   Criterio 1  /health responde 200 en la URL del servicio. En Cloud Run las rutas que terminan en "z"
#               están reservadas por Google (su frontal responde con un 404 HTML y la petición nunca llega
#               a la app), así que la app no define ninguna (KAN-43).
#   Criterio 4  /docs, /redoc y /openapi.json responden 404 (solo existen con ENV=local).
#   Criterio 2  (con RUN_JOB=1) el job de migraciones termina con código 0. Es la primera prueba REAL
#               del Cloud SQL Connector: /health no toca la BD, así que sin el job no queda probado.
#   Criterio 3  no se mide aquí: lo calcula 40_cloud_run.sh (paso 5) y lo contrasta con sql_check.sh.
#
# Uso:
#   bash infra/scripts/cloud_run_check.sh                    # solo el servicio (funciona con la BD apagada)
#   RUN_JOB=1 bash infra/scripts/cloud_run_check.sh          # además ejecuta el job (BD ENCENDIDA)
#   RUN_JOB=1 JOB_RUNS=1 bash infra/scripts/cloud_run_check.sh   # una sola ejecución del job
#   DRY_RUN=1 RUN_JOB=1 bash infra/scripts/cloud_run_check.sh    # imprime las ejecuciones sin hacerlas
#
# El job se ejecuta JOB_RUNS veces (2 por defecto): la primera aplica las migraciones y la segunda debe
# ser un no-op (idempotencia: sin líneas "Running upgrade").
#
# Con RUN_JOB=1 la instancia de Cloud SQL tiene que estar encendida (bash infra/scripts/sql_power.sh
# start); el script no la enciende ni la apaga. Una cuenta de servicio con permisos mínimos no ejecuta
# esto: lo corre el humano (o un agente con permiso) con su sesión de gcloud.
#
# Con DRY_RUN=1 las lecturas y las llamadas HTTP SÍ se hacen; solo se omiten las ejecuciones del job.
set -euo pipefail

source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/../env/staging.env"
source "$(dirname "$0")/lib_sql.sh"

# Sin preguntas interactivas de gcloud: la única confirmación es la de este script.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

RUN_JOB="${RUN_JOB:-0}"
JOB_RUNS="${JOB_RUNS:-2}"
HTTP_TIMEOUT="${HTTP_TIMEOUT:-90}"   # el primer pedido paga el arranque en frío

BODY_FILE=""
cleanup() {
  if [[ -n "$BODY_FILE" ]]; then rm -f "$BODY_FILE"; fi
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

# http_status <ruta>: imprime el código HTTP (000 si no hubo respuesta) y deja el cuerpo en $BODY_FILE.
http_status() {
  local code
  # Si curl falla (sin respuesta, tiempo agotado), -w ya imprime 000 y el código de salida no importa.
  code="$(curl -sS --max-time "$HTTP_TIMEOUT" -o "$BODY_FILE" -w '%{http_code}' "${SERVICE_URL}$1" 2>/dev/null)" || true
  printf '%s' "${code:-000}"
}

step "0/4 Comprobaciones previas"
sql_preflight
command -v curl >/dev/null || die "Falta curl"
[[ "$RUN_JOB" == "0" || "$RUN_JOB" == "1" ]] || die "RUN_JOB debe ser 0 o 1"
[[ "$JOB_RUNS" =~ ^[1-5]$ ]] || die "JOB_RUNS debe ser un número de 1 a 5"
[[ "$CR_SERVICE" =~ ^[a-z][a-z0-9-]*-stg$ ]] || die "CR_SERVICE no válido o sin sufijo -stg: ${CR_SERVICE}"
[[ "$CR_JOB" =~ ^[a-z][a-z0-9-]*-stg$ ]] || die "CR_JOB no válido o sin sufijo -stg: ${CR_JOB}"
BODY_FILE="$(mktemp)"
if is_dry; then
  log "DRY_RUN=1: solo lecturas y llamadas HTTP; el job no se ejecuta"
fi
log "Proyecto ${GCP_PROJECT_ID} · región ${GCP_REGION} · servicio ${CR_SERVICE} · job ${CR_JOB} · RUN_JOB=${RUN_JOB}"

probe gcloud run services list --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
  || die "No pude listar los servicios de Cloud Run"
SERVICE_URL="$(jq -r --arg n "$CR_SERVICE" '[.[]? | select(.metadata.name == $n)] | first | .status.url // empty' <<<"$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")")"
[[ -n "$SERVICE_URL" ]] || die "No encuentro el servicio ${CR_SERVICE} (o no tiene URL). Créalo en la Consola o con bash infra/scripts/40_cloud_run.sh"
[[ "$SERVICE_URL" == https://* ]] || die "La URL del servicio no es https: ${SERVICE_URL}"
st_ok "Servicio ${CR_SERVICE}: ${SERVICE_URL}"

step "1/4 Criterio 1: /health responde 200"
code="$(http_status /health)"
if [[ "$code" == "200" ]]; then
  if [[ "$(jq -c . "$BODY_FILE" 2>/dev/null || true)" == '{"status":"ok"}' ]]; then
    st_ok "GET /health -> 200 {\"status\":\"ok\"}"
  else
    # El criterio es el 200; un cuerpo distinto solo se avisa (la forma de la respuesta es de la app).
    st_ok "GET /health -> 200"
    st_warn "El cuerpo de /health no es {\"status\":\"ok\"}: $(head -c 200 "$BODY_FILE")"
  fi
else
  st_fail "GET /health -> ${code} (se esperaba 200). Mira los logs: gcloud run services logs read ${CR_SERVICE} --project=${GCP_PROJECT_ID} --region=${GCP_REGION} --limit=30"
fi

step "2/4 Criterio 4: /docs, /redoc y /openapi.json responden 404"
for path in /docs /redoc /openapi.json; do
  code="$(http_status "$path")"
  if [[ "$code" == "404" ]]; then
    st_ok "GET ${path} -> 404"
    # El 404 de la app es JSON con code=not_found; uno distinto (p. ej. HTML de Google) significa que la
    # petición no llegó a la app y el 404 no demuestra que los docs estén apagados.
    if [[ "$(jq -r '.code // empty' "$BODY_FILE" 2>/dev/null || true)" != "not_found" ]]; then
      st_warn "El 404 de ${path} no es el de la app (cuerpo: $(head -c 120 "$BODY_FILE" | tr -d '\n')): ¿la petición llegó a la app?"
    fi
  else
    st_fail "GET ${path} -> ${code} (se esperaba 404): ¿falta ENV=staging en el servicio?"
  fi
done

step "3/4 Criterio 2: el job ${CR_JOB} termina con código 0"
if [[ "$RUN_JOB" != "1" ]]; then
  st_info "Omitido (RUN_JOB=0). Con la instancia encendida: RUN_JOB=1 bash infra/scripts/cloud_run_check.sh"
else
  sql_instance_exists || die "La instancia ${SQL_INSTANCE} no existe. Se crea con bash infra/scripts/20_cloud_sql.sh"
  sql_describe
  if [[ "$(sql_power_state)" != "running" ]]; then
    die "La instancia ${SQL_INSTANCE} no está encendida: sin BD el job fallaría. Enciéndela con bash infra/scripts/sql_power.sh start y vuelve a correr."
  fi
  st_ok "Instancia ${SQL_INSTANCE} encendida"
  probe gcloud run jobs list --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format=json \
    || die "No pude listar los jobs de Cloud Run"
  [[ "$(jq -r --arg n "$CR_JOB" '[.[]? | select(.metadata.name == $n)] | length' <<<"$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")")" == "1" ]] \
    || die "No encuentro el job ${CR_JOB}. Créalo en la Consola o con bash infra/scripts/40_cloud_run.sh"
  confirm "Ejecutar ${CR_JOB} ${JOB_RUNS} vez/veces en ${GCP_PROJECT_ID}? (aplica las migraciones a la BD ${DB_NAME} de staging)" || die "Cancelado"

  prev_exec=""
  for run_n in $(seq 1 "$JOB_RUNS"); do
    log "Ejecución ${run_n}/${JOB_RUNS}"
    if is_dry; then
      run gcloud run jobs execute "$CR_JOB" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --wait
      continue
    fi
    # --wait espera a que termine. Si la ejecución falla, el comando sale con error y no se sigue.
    if ! gcloud run jobs execute "$CR_JOB" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --wait --format=none; then
      st_fail "La ejecución ${run_n} del job falló (código distinto de 0). Mira los logs en la Consola: Cloud Run > Jobs > ${CR_JOB} > Ejecuciones"
      break
    fi
    # La ejecución más reciente (la que acaba de terminar).
    probe gcloud run jobs executions list --job="$CR_JOB" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --limit=5 --format=json \
      || die "No pude listar las ejecuciones de ${CR_JOB}"
    exec_json="$(jq -c '[.[]?] | sort_by(.metadata.creationTimestamp) | last // empty' <<<"$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")")"
    exec_name="$(jq -r '.metadata.name // empty' <<<"$exec_json")"
    ok_n="$(jq -r '.status.succeededCount // 0' <<<"$exec_json")"
    bad_n="$(jq -r '.status.failedCount // 0' <<<"$exec_json")"
    if [[ -z "$exec_name" || "$exec_name" == "$prev_exec" ]]; then
      st_fail "No pude identificar la ejecución nueva del job (última vista: ${exec_name:-ninguna})"
      break
    fi
    prev_exec="$exec_name"
    if [[ "$ok_n" == "1" && "$bad_n" == "0" ]]; then
      st_ok "Ejecución ${exec_name}: succeededCount=${ok_n} failedCount=${bad_n}"
    else
      st_fail "Ejecución ${exec_name}: succeededCount=${ok_n} failedCount=${bad_n} (se esperaba 1 y 0)"
      break
    fi

    # Logs de esa ejecución: confirman que pasó por el Connector y qué migraciones aplicó. Pueden tardar
    # unos segundos en aparecer, así que se reintenta; si no aparecen, es un aviso y no un fallo.
    logs=""
    for attempt in 1 2 3 4 5 6; do
      probe gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${CR_JOB}\" AND labels.\"run.googleapis.com/execution_name\"=\"${exec_name}\"" \
        --project="$GCP_PROJECT_ID" --freshness=1h --order=asc --limit=200 --format=json \
        || die "No pude leer los logs de la ejecución"
      logs="$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")"
      if [[ "$(jq -r '[.[]? | select(.jsonPayload.message == "db_engine_created")] | length' <<<"${logs:-[]}")" != "0" ]]; then
        break
      fi
      logs=""
      sleep 8
    done
    if [[ -z "$logs" ]]; then
      st_warn "Los logs de ${exec_name} aún no aparecen en Cloud Logging; revísalos en la Consola"
      continue
    fi
    mode="$(jq -r '[.[]? | select(.jsonPayload.message == "db_engine_created") | .jsonPayload.db_mode] | first // ""' <<<"$logs")"
    if [[ "$mode" == "cloud_sql_connector" ]]; then
      st_ok "Logs: el job se conectó con el Cloud SQL Connector (db_mode=${mode})"
    else
      st_fail "Logs: db_mode=${mode:-<vacío>} (se esperaba cloud_sql_connector)"
    fi
    upgrades="$(jq -r '[.[]? | select((.jsonPayload.message // "") | startswith("Running upgrade")) | .jsonPayload.message] | join(" | ")' <<<"$logs")"
    errors="$(jq -r '[.[]? | select(.severity == "ERROR" or .severity == "CRITICAL")] | length' <<<"$logs")"
    if [[ -n "$upgrades" ]]; then
      st_info "Migraciones aplicadas en esta ejecución: ${upgrades}"
    else
      st_info "Sin líneas \"Running upgrade\": la BD ya estaba en la última revisión (no-op)"
    fi
    if [[ "$errors" != "0" ]]; then
      st_fail "Los logs de ${exec_name} tienen ${errors} línea(s) de severidad ERROR"
    fi
  done
fi

step "4/4 Resumen"
if [[ "$RUN_JOB" == "1" ]]; then
  st_info "Cuando termines, apaga la instancia: bash infra/scripts/sql_power.sh stop"
fi
summary_check
