#!/usr/bin/env bash
# Enciende, apaga o consulta la instancia de Cloud SQL de staging (KAN-10, INF-04).
# Apagada (política NEVER) no cobra el cómputo, solo el disco; encendida, cobra por hora.
#
# Uso:
#   bash infra/scripts/sql_power.sh status            # solo lectura
#   bash infra/scripts/sql_power.sh start             # enciende; tarda varios minutos
#   bash infra/scripts/sql_power.sh stop              # apaga; corta las conexiones activas
#   DRY_RUN=1 bash infra/scripts/sql_power.sh start   # solo lecturas: imprime lo que haría
#
# Al encender, recuerda volver a correr el CD (KAN-16): los merges hechos con la instancia apagada se
# desplegaron sin migrar.
#
# Idempotente: si la instancia ya está en el estado pedido, no cambia nada ni pregunta.
# El cambio se envía con --async y se espera con `sql operations wait`: el patch simple se
# corta ("taking longer than expected") antes de que la instancia termine de arrancar.
set -euo pipefail

source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/../env/staging.env"
source "$(dirname "$0")/lib_sql.sh"

# Sin preguntas interactivas de gcloud: la única confirmación es la de este script.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

ACTION="${1:-}"
case "$ACTION" in
  start | stop | status) ;;
  *) die "Uso: bash infra/scripts/sql_power.sh start|stop|status" ;;
esac

# Espera a que la instancia llegue al estado de energía pedido (running o stopped). Termina las
# operaciones pendientes y vuelve a leer: la lista de operaciones puede tardar unos segundos en
# mostrar la que acabamos de enviar.
await_power() {
  local want="$1" i
  for i in 1 2 3 4 5; do
    sql_wait_pending
    sql_describe
    if [[ "$(sql_power_state)" == "$want" ]]; then
      return 0
    fi
    log "Todavía no está en estado ${want}; reviso otra vez en 10 s (${i}/5)"
    sleep 10
  done
  return 1
}

# Envía el cambio de política (always = encendida, never = apagada) y espera el resultado.
# Devuelve 0 si la instancia quedó en el estado pedido.
set_power() {
  local policy="$1" want="stopped" started="$SECONDS"
  if [[ "$policy" == "always" ]]; then
    want="running"
  fi
  if is_dry; then
    run gcloud sql instances patch "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --activation-policy="$policy" --async --format=none
    run gcloud sql operations wait OPERATION_ID --project="$GCP_PROJECT_ID" --timeout="$SQL_WAIT_SECONDS"
    return 0
  fi
  gcloud sql instances patch "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --activation-policy="$policy" --async --format=none \
    || die "No pude enviar el cambio a ${SQL_INSTANCE}"
  if await_power "$want"; then
    log "Tardó $((SECONDS - started)) s"
    return 0
  fi
  log "Pasaron $((SECONDS - started)) s sin llegar al estado ${want}"
  return 1
}

step "0/2 Comprobaciones previas"
sql_preflight
if is_dry; then
  log "DRY_RUN=1: solo lecturas; ninguna escritura se ejecuta"
fi
log "Proyecto ${GCP_PROJECT_ID} · instancia ${SQL_INSTANCE} · acción ${ACTION}"

step "1/2 ${ACTION} ${SQL_INSTANCE}"
sql_instance_exists || die "La instancia ${SQL_INSTANCE} no existe. Se crea con bash infra/scripts/20_cloud_sql.sh"
sql_wait_pending
sql_describe
power="$(sql_power_state)"
log "Estado: $(jq -r '.state // "?"' <<<"$SQL_JSON") · política: $(jq -r '.settings.activationPolicy // "?"' <<<"$SQL_JSON") · tier: $(jq -r '.settings.tier // "?"' <<<"$SQL_JSON")"

case "$ACTION" in
  status)
    case "$power" in
      running) st_info "ENCENDIDA: cobra por hora. Apágala con: bash infra/scripts/sql_power.sh stop" ;;
      stopped) st_info "APAGADA: solo se cobra el disco" ;;
      *) st_warn "Estado intermedio o inesperado; espera unos minutos y vuelve a consultar" ;;
    esac
    ;;
  start)
    case "$power" in
      running) st_ok "La instancia ya está encendida" ;;
      stopped)
        confirm "Encender ${SQL_INSTANCE}? Empieza el cobro por hora y tarda varios minutos (el 15/10/2026 tardó unos 12)." || die "Cancelado"
        CONFIRMED=1
        if set_power always; then
          st_fixed "Instancia encendida"
          st_info "Cuando termines, apágala con: bash infra/scripts/sql_power.sh stop"
          # KAN-16: con la instancia apagada el CD omite las migraciones. Para aplicar las pendientes hay
          # que volver a correr el CD (migra y vuelve a desplegar main; es idempotente).
          st_info "Si hubo merges a main con la instancia apagada, hay migraciones pendientes: gh workflow run cd-staging.yml --ref main"
        else
          st_fail "La instancia no llegó a estar encendida (estado actual: $(jq -r '.state // "?"' <<<"$SQL_JSON")); revisa la consola de Cloud SQL"
        fi
        ;;
      *) die "La instancia está en un estado intermedio o inesperado; reintenta en unos minutos" ;;
    esac
    ;;
  stop)
    case "$power" in
      stopped) st_ok "La instancia ya está apagada" ;;
      running)
        confirm "Apagar ${SQL_INSTANCE}? Corta las conexiones activas: el backend de staging no podrá usar la BD hasta que la enciendas." || die "Cancelado"
        CONFIRMED=1
        if set_power never; then
          st_fixed "Instancia apagada"
        else
          st_fail "La instancia no llegó a estar apagada (estado actual: $(jq -r '.state // "?"' <<<"$SQL_JSON")); revisa la consola de Cloud SQL"
        fi
        ;;
      *) die "La instancia está en un estado intermedio o inesperado; reintenta en unos minutos" ;;
    esac
    ;;
esac

step "2/2 Resumen"
summary
