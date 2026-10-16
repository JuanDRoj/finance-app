#!/usr/bin/env bash
# Funciones comunes de los scripts de Cloud SQL (20_cloud_sql.sh, sql_power.sh y sql_check.sh).
# Se usa con `source`, DESPUÉS de lib.sh y de infra/env/staging.env.

SQL_CONNECTION_NAME="${GCP_PROJECT_ID}:${GCP_REGION}:${SQL_INSTANCE}"

# Tiempo máximo de espera de una operación de Cloud SQL. El 15/10/2026 encender la instancia
# detenida tardó unos 12 minutos y apagarla unos 30 segundos, así que el margen es generoso.
# Se puede cambiar solo para una corrida: SQL_WAIT_SECONDS=2400 bash infra/scripts/sql_power.sh start
SQL_WAIT_SECONDS="${SQL_WAIT_SECONDS:-1500}"

# Resultado de sql_describe (JSON de la instancia).
SQL_JSON=""

# Comprobaciones previas comunes. Red de seguridad: estos scripts solo tocan staging.
sql_preflight() {
  [[ -n "$(command -v gcloud)" ]] || die "Falta gcloud"
  command -v jq >/dev/null || die "Falta jq (instálalo con el gestor de paquetes del sistema)"
  [[ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)')" ]] \
    || die "No hay sesión activa de gcloud: ejecuta gcloud auth login"
  [[ "$GCP_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "GCP_PROJECT_ID no válido: ${GCP_PROJECT_ID}"
  [[ "$GCP_PROJECT_ID" == *-stg ]] || die "GCP_PROJECT_ID debe terminar en -stg (recibido: ${GCP_PROJECT_ID})"
  [[ "$GCP_REGION" == "southamerica-east1" ]] || die "Región inesperada: ${GCP_REGION}"
  [[ "$SQL_INSTANCE" =~ ^[a-z][a-z0-9-]*-stg$ ]] || die "SQL_INSTANCE no válida o sin sufijo -stg: ${SQL_INSTANCE}"
  [[ "$SQL_WAIT_SECONDS" =~ ^[0-9]+$ ]] || die "SQL_WAIT_SECONDS debe ser un número de segundos"
}

# ¿Existe la instancia? Se usa `list` y no `describe` para no depender del texto del error cuando falta.
sql_instance_exists() {
  probe gcloud sql instances list --project="$GCP_PROJECT_ID" --filter="name=${SQL_INSTANCE}" --format='value(name)' \
    || die "No pude listar las instancias de Cloud SQL"
  [[ "$PROBE_OUT" == "$SQL_INSTANCE" ]]
}

# Lee la instancia entera y la deja en SQL_JSON. Funciona también con la instancia detenida.
sql_describe() {
  probe gcloud sql instances describe "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --format=json \
    || die "No encuentro la instancia ${SQL_INSTANCE}"
  # gcloud puede anteponer líneas informativas al JSON: se toma desde la primera llave.
  SQL_JSON="$(sed -n '/^{/,$p' <<<"$PROBE_OUT")"
}

# Estado de energía según SQL_JSON: running (RUNNABLE + política always), stopped (STOPPED)
# u other (arrancando, apagando, mantenimiento, fallo...). Una instancia detenida NO queda
# en RUNNABLE: su estado es STOPPED (calibrado el 15/10/2026).
sql_power_state() {
  local state policy
  state="$(jq -r '.state // ""' <<<"$SQL_JSON")"
  policy="$(jq -r '.settings.activationPolicy // ""' <<<"$SQL_JSON")"
  if [[ "$state" == "RUNNABLE" && "$policy" == "ALWAYS" ]]; then
    printf 'running'
  elif [[ "$state" == "STOPPED" ]]; then
    printf 'stopped'
  else
    printf 'other'
  fi
}

# Espera una operación de Cloud SQL. Si agota el tiempo o falla, se detiene con el comando para seguir
# esperando (volver a correr el script también es seguro).
sql_wait_op() {
  local op="$1"
  log "Esperando la operación ${op} (máximo ${SQL_WAIT_SECONDS}s)"
  gcloud sql operations wait "$op" --project="$GCP_PROJECT_ID" --timeout="$SQL_WAIT_SECONDS" >/dev/null </dev/null \
    || die "La operación ${op} no terminó bien en ${SQL_WAIT_SECONDS}s. Para seguir esperando: gcloud sql operations wait ${op} --project=${GCP_PROJECT_ID} --timeout=${SQL_WAIT_SECONDS}  (también se ve en la consola de Cloud SQL)"
}

# Espera, con límite de SQL_WAIT_SECONDS, a que la instancia llegue al estado pedido (p. ej. RUNNABLE) y
# deja el JSON actualizado en SQL_JSON. Complementa a sql_wait_op: justo tras un create --async la lista
# de operaciones puede tardar en mostrar la nueva y la instancia aparece primero en PENDING_CREATE.
sql_wait_state() {
  local want="$1" waited=0 state
  while true; do
    sql_describe
    state="$(jq -r '.state // ""' <<<"$SQL_JSON")"
    if [[ "$state" == "$want" ]]; then
      return 0
    fi
    if [[ "$state" == "FAILED" || "$state" == "SUSPENDED" ]]; then
      die "La instancia ${SQL_INSTANCE} quedó en estado ${state}. Revísala en la consola de Cloud SQL."
    fi
    if (( waited >= SQL_WAIT_SECONDS )); then
      die "La instancia ${SQL_INSTANCE} sigue en estado ${state:-desconocido} tras ${SQL_WAIT_SECONDS}s (se esperaba ${want}). Revísala en la consola de Cloud SQL y vuelve a correr el script."
    fi
    log "Estado ${state:-desconocido}; esperando ${want} (${waited}/${SQL_WAIT_SECONDS}s)"
    sleep 15
    waited=$((waited + 15))
  done
}

# Espera las operaciones aún no terminadas de la instancia (evita el error por operación en curso).
# Sirve igual tras un patch o un create lanzados con --async: no hace falta leer el id de la operación.
sql_wait_pending() {
  local op
  probe gcloud sql operations list --instance="$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --filter="status!=DONE" --format='value(name)' \
    || die "No pude listar las operaciones de ${SQL_INSTANCE}"
  while IFS= read -r op; do
    [[ -n "$op" ]] || continue
    st_info "Operación pendiente ${op}: se espera a que termine"
    sql_wait_op "$op"
  done <<<"$PROBE_OUT"
}
