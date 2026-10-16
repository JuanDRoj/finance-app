#!/usr/bin/env bash
# Prueba de conexión a Cloud SQL de staging por el Cloud SQL Auth Proxy (KAN-10, INF-04). Deja evidencia
# repetible de dos criterios del ticket: que se conecta por el proxy con el usuario de la app y con la
# contraseña del secreto, y cuánto vale max_connections (para dimensionar el pool de Cloud Run en KAN-13).
#
# SOLO LO CORRE EL HUMANO, con la instancia ENCENDIDA (bash infra/scripts/sql_power.sh start).
#
# Requisitos: cloud-sql-proxy v2 y psql en el PATH, y credenciales por defecto de Google
# (gcloud auth application-default login), las mismas que ya usaste en la prueba manual del 15/10/2026.
#
# Uso:
#   bash infra/scripts/sql_check.sh              # abre el proxy en 127.0.0.1:5433, consulta y lo cierra
#   DRY_RUN=1 bash infra/scripts/sql_check.sh    # solo comprueba requisitos y estado; no abre el proxy
#   SQL_PROXY_PORT=5434 bash infra/scripts/sql_check.sh   # otro puerto local
#
# La contraseña se lee del secreto a una variable y viaja solo en el entorno de psql: no se imprime,
# no se escribe en disco y el script no la pasa como argumento; se niega a correr con xtrace (bash -x)
# porque la traza la mostraría. La conexión del proxy al servidor va
# cifrada y con certificado de cliente (lo pone el proxy); entre psql y el proxy es local (sslmode=disable).
set -euo pipefail

source "$(dirname "$0")/lib.sh"
refuse_xtrace
source "$(dirname "$0")/../env/staging.env"
source "$(dirname "$0")/lib_sql.sh"

export CLOUDSDK_CORE_DISABLE_PROMPTS=1

SQL_PROXY_PORT="${SQL_PROXY_PORT:-5433}"
PROXY_PID=""
PROXY_LOG=""

cleanup() {
  if [[ -n "$PROXY_PID" ]]; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
  if [[ -n "$PROXY_LOG" ]]; then
    rm -f "$PROXY_LOG"
  fi
}
trap cleanup EXIT
# Ctrl+C, kill o cierre de la terminal: salir también dispara cleanup y no deja el proxy abierto.
trap 'exit 1' INT TERM HUP

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/${SQL_PROXY_PORT}") 2>/dev/null; }

step "0/4 Comprobaciones previas"
sql_preflight
[[ "$SQL_PROXY_PORT" =~ ^[0-9]{4,5}$ ]] || die "SQL_PROXY_PORT no válido: ${SQL_PROXY_PORT}"
command -v cloud-sql-proxy >/dev/null || die "Falta cloud-sql-proxy (v2) en el PATH"
command -v psql >/dev/null || die "Falta psql en el PATH"
if is_dry; then
  log "DRY_RUN=1: solo comprueba requisitos y estado; no abre el proxy ni consulta"
fi
if port_in_use; then
  die "El puerto local ${SQL_PROXY_PORT} ya está en uso. Cierra lo que lo usa o elige otro con SQL_PROXY_PORT=<puerto>"
fi
st_ok "Herramientas y puerto local ${SQL_PROXY_PORT} disponibles"

step "1/4 La instancia debe estar encendida"
sql_instance_exists || die "La instancia ${SQL_INSTANCE} no existe. Se crea con bash infra/scripts/20_cloud_sql.sh"
sql_describe
if [[ "$(sql_power_state)" != "running" ]]; then
  die "La instancia ${SQL_INSTANCE} no está encendida. Enciéndela con bash infra/scripts/sql_power.sh start y vuelve a correr este script."
fi
st_ok "Instancia ${SQL_INSTANCE} encendida"

if is_dry; then
  log "Se abriría: cloud-sql-proxy --port ${SQL_PROXY_PORT} ${SQL_CONNECTION_NAME}"
  log "Se consultaría como ${DB_USER} a ${DB_NAME} con la contraseña del secreto ${DB_PASSWORD_SECRET} (sin mostrarla)"
  step "4/4 Resumen"
  summary
  exit 0
fi

step "2/4 Proxy en 127.0.0.1:${SQL_PROXY_PORT}"
PROXY_LOG="$(mktemp)"
cloud-sql-proxy --port "$SQL_PROXY_PORT" "$SQL_CONNECTION_NAME" >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
ready=0
for i in $(seq 1 30); do
  # El proxy imprime "ready for new connections" cuando ya acepta conexiones. Si ese texto no
  # apareciera (otra versión del proxy), pasados 8 s se acepta que el puerto responda.
  if grep -qi 'ready for new connections' "$PROXY_LOG" || { (( i >= 8 )) && port_in_use; }; then
    ready=1
    break
  fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    PROXY_PID=""
    die "El proxy se cerró al arrancar: $(tail -n 5 "$PROXY_LOG")"
  fi
  sleep 1
done
(( ready )) || die "El proxy no abrió el puerto ${SQL_PROXY_PORT} en 30 s: $(tail -n 5 "$PROXY_LOG")"
st_ok "Proxy de ${SQL_CONNECTION_NAME} escuchando en 127.0.0.1:${SQL_PROXY_PORT}"

step "3/4 Consulta como ${DB_USER}"
# La contraseña queda en una variable local; redact_add evita que salga si algún mensaje la incluyera.
db_password="$(gcloud secrets versions access latest --secret="$DB_PASSWORD_SECRET" --project="$GCP_PROJECT_ID")" \
  || die "No pude leer el secreto ${DB_PASSWORD_SECRET}"
redact_add "$db_password"
# Solo cuentan para max_connections las conexiones de cliente (backend_type = 'client backend'). Los
# procesos de fondo de PostgreSQL (autovacuum launcher, checkpointer, walwriter, bgwriter, replicación
# lógica...) también salen en pg_stat_activity pero NO consumen conexiones, así que se excluyen. De las
# de cliente se separan las de usuarios internos de Cloud SQL (cloudsqladmin y similares) de las demás
# (incluida esta misma). Una sola consulta.
query="select current_user, current_database(), current_setting('server_version'),
  current_setting('max_connections'), current_setting('superuser_reserved_connections'),
  count(*) filter (where backend_type = 'client backend'),
  count(*) filter (where backend_type = 'client backend' and coalesce(usename, '') like 'cloudsql%'),
  count(*) filter (where backend_type = 'client backend' and coalesce(usename, '') not like 'cloudsql%'),
  pg_has_role(current_user, 'cloudsqlsuperuser', 'member')
  from pg_stat_activity"
if ! result="$(PGPASSWORD="$db_password" PGCONNECT_TIMEOUT=15 psql -X -A -t -F '|' -c "$query" \
      "host=127.0.0.1 port=${SQL_PROXY_PORT} dbname=${DB_NAME} user=${DB_USER} sslmode=disable" 2>&1)"; then
  db_password=""
  die "psql no pudo consultar: ${result:0:400}"
fi
db_password=""
IFS='|' read -r r_user r_db r_version r_max r_reserved r_clients r_internal r_others r_super <<<"$result"
st_ok "Conexión por el proxy como ${r_user} a la base ${r_db} (PostgreSQL ${r_version})"
st_info "max_connections=${r_max} · reservadas=${r_reserved} · clientes totales=${r_clients} · internas de Cloud SQL=${r_internal} · otras=${r_others} (solo conexiones de cliente: los procesos de fondo no consumen max_connections)"
st_info "Anota max_connections para dimensionar el pool de Cloud Run en KAN-13 (ver la cuenta en infra/RECURSOS.md)"
if [[ "$r_super" == "t" ]]; then
  st_info "${DB_USER} es miembro de cloudsqlsuperuser (aceptado en staging; en prod, un usuario de mínimos privilegios)"
fi

step "4/4 Resumen"
summary
