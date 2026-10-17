#!/usr/bin/env bash
# Prueba del frontend de staging en Vercel (KAN-14, INF-08): deja evidencia repetible de los criterios
# del ticket que se pueden medir desde fuera con curl. Solo hace pedidos HTTP a la URL del frontend:
# no usa las herramientas de la nube ni la CLI de Vercel, no necesita credenciales y no escribe nada.
#
#   Criterio 1  el alias responde: /login da 200 y / redirige (307) a /login (el proxy de rutas privadas
#               corre). Que el alias sea ESTABLE no se prueba en una sola corrida: se corre otra vez tras
#               el siguiente despliegue y debe responder igual (el dominio del despliegue cambia, el alias no).
#   Criterio 2  /api/health responde 200 por el rewrite. NO se usa /api/healthz: el rewrite lo manda a
#               /healthz de Cloud Run, que Google reserva (rutas que terminan en "z") y contesta con su 404
#               HTML sin llegar a la app. Se prueba solo para dejar constancia, como informativo.
#   Criterio 3  el Set-Cookie del backend llega por el rewrite. Ningun endpoint que abre sesion se puede
#               probar sin un token real de Firebase, asi que se usa DELETE /api/auth/session SIN cookie:
#               el backend responde 204 y emite la cookie de cierre (vacia, Max-Age=0) sin tocar la BD, sin
#               llamar a Firebase y sin revocar nada. Exige que el Origin este en ALLOWED_ORIGINS; con otro
#               Origin debe dar 403 sin Set-Cookie (prueba que el rewrite reenvia el Origin y que se aplica).
#   Criterio 6  /api/docs, /api/redoc y /api/openapi.json responden 404 con el JSON de la app (code
#               not_found): solo existen con ENV=local.
#   Criterios 4 y 5  no se miden aqui: son del dashboard de Vercel y de GitHub (ver infra/RECURSOS.md).
#
# Ninguna prueba necesita la instancia de Cloud SQL encendida. El script no envia nunca una cookie (ni
# siquiera una que viniera de ~/.curlrc: curl se llama con -q) y nunca imprime una cookie.
#
# Uso:
#   bash infra/scripts/vercel_check.sh                      # contra FRONTEND_URL de staging.env
#   bash infra/scripts/vercel_check.sh https://otro.dominio # contra otro dominio (argumento)
#   FRONTEND_URL=https://otro.dominio bash infra/scripts/vercel_check.sh   # o por variable
#   ALLOWED_ORIGIN=https://x.example bash infra/scripts/vercel_check.sh    # Origin del criterio 3
#
# Contra un dominio distinto del alias (por ejemplo el que genero Vercel en el primer despliegue) el
# Origin permitido sigue siendo el de STAGING_ALLOWED_ORIGINS: es el unico que el backend acepta, y el
# pedido pasa por el rewrite de ese dominio igualmente.
set -euo pipefail

# La URL a probar y el Origin se guardan ANTES de cargar staging.env, que define su propio FRONTEND_URL.
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
  exit 0
fi
[[ $# -le 1 ]] || { echo "Uso: vercel_check.sh [URL]  (ver --help)" >&2; exit 2; }
URL_OVERRIDE="${1:-${FRONTEND_URL:-}}"
ORIGIN_OVERRIDE="${ALLOWED_ORIGIN:-}"

source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/../env/staging.env"

HTTP_TIMEOUT="${HTTP_TIMEOUT:-90}"            # el primer pedido paga el arranque en frio de Cloud Run
SESSION_COOKIE_NAME="__Host-session"          # el nombre que usa el backend fuera de local
OTHER_ORIGIN="https://evil.invalid"           # un origen que nunca estara permitido

HDR_FILE=""
BODY_FILE=""
ERR_FILE=""
CODE="000"
cleanup() {
  if [[ -n "$HDR_FILE" ]]; then rm -f "$HDR_FILE"; fi
  if [[ -n "$BODY_FILE" ]]; then rm -f "$BODY_FILE"; fi
  if [[ -n "$ERR_FILE" ]]; then rm -f "$ERR_FILE"; fi
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

# curl_cause <codigo de salida de curl>: la causa de que no haya (o llegue incompleta) una respuesta.
curl_cause() {
  case "$1" in
    6) printf 'DNS: no se pudo resolver el nombre del dominio' ;;
    7) printf 'conexion: rechazada o sin ruta al servidor' ;;
    28) printf 'timeout: la conexion tarda mas de 10 s o el pedido mas de %s s' "$HTTP_TIMEOUT" ;;
    35 | 51 | 58 | 59 | 60 | 77 | 82 | 83 | 90 | 91) printf 'TLS: fallo del saludo o del certificado' ;;
    *) printf 'curl termino con el codigo %s' "$1" ;;
  esac
}

# request <metodo> <ruta> [cabecera...]: deja el codigo en $CODE (000 si no hubo respuesta), las cabeceras
# en $HDR_FILE y el cuerpo en $BODY_FILE. Sin redirecciones automaticas y solo por https.
# - `-q` va PRIMERO a proposito (curl solo lo respeta como primer argumento): asi no lee ~/.curlrc, donde un
#   `-b` mandaria una cookie y romperia la promesa de que este script no envia nunca una.
# - El stderr de curl va a $ERR_FILE y no a la pantalla. Sin -v no lleva cabeceras ni cookies; si no hubo
#   respuesta (000) se muestra solo su primera linea, junto con la causa (DNS, TLS, timeout...).
request() {
  local method="$1" path="$2" h rc=0 detail
  local args=()
  shift 2
  for h in "$@"; do args+=(-H "$h"); done
  : >"$HDR_FILE"
  : >"$BODY_FILE"
  : >"$ERR_FILE"
  CODE="$(curl -q -sS --proto '=https' --connect-timeout 10 --max-time "$HTTP_TIMEOUT" -X "$method" "${args[@]+"${args[@]}"}" \
    -D "$HDR_FILE" -o "$BODY_FILE" -w '%{http_code}' "${FRONTEND_URL}${path}" 2>"$ERR_FILE")" || rc=$?
  CODE="${CODE:-000}"
  detail="$(head -n 1 "$ERR_FILE" | tr -d '\r' | cut -c1-200)"
  if [[ "$CODE" == "000" ]]; then
    st_info "Sin respuesta para ${method} ${path} (curl ${rc}) - $(curl_cause "$rc")${detail:+. curl dijo: ${detail}}"
  elif [[ "$rc" != "0" ]]; then
    st_warn "La respuesta de ${method} ${path} (${CODE}) llego incompleta (curl ${rc}) - $(curl_cause "$rc"): los resultados de abajo pueden no ser fiables"
  fi
}

# header <nombre>: valor de esa cabecera de respuesta (sin CR; si se repite, la ultima). Vacio si no esta.
header() {
  tr -d '\r' <"$HDR_FILE" | awk -v n="$1" 'BEGIN { n = tolower(n) ":" } tolower(substr($0, 1, length(n))) == n { sub(/^[^:]*:[ \t]*/, ""); v = $0 } END { print v }'
}

# set_cookies: las lineas Set-Cookie de la respuesta (el valor, sin el nombre de la cabecera).
set_cookies() {
  tr -d '\r' <"$HDR_FILE" | awk 'tolower(substr($0, 1, 11)) == "set-cookie:" { sub(/^[^:]*:[ \t]*/, ""); print }'
}

# body_json: el cuerpo en una linea si es JSON; vacio si no lo es.
body_json() { jq -c . "$BODY_FILE" 2>/dev/null || true; }

# body_code: el campo "code" del JSON de error de la app; vacio si no hay.
body_code() { jq -r '.code // empty' "$BODY_FILE" 2>/dev/null || true; }

# --- Comprobaciones previas ---------------------------------------------------------------------------
step "0/5 Comprobaciones previas"
command -v curl >/dev/null || die "Falta curl"
command -v jq >/dev/null || die "Falta jq"

STAGING_FRONTEND_URL="$FRONTEND_URL"
FRONTEND_URL="${URL_OVERRIDE:-$FRONTEND_URL}"
[[ "$FRONTEND_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] \
  || die "FRONTEND_URL debe ser https://host (sin barra final ni ruta): ${FRONTEND_URL}"
[[ "$VERCEL_REGION" =~ ^[a-z]{3}[0-9]$ ]] || die "VERCEL_REGION no es una region valida: ${VERCEL_REGION}"

# El Origin que el backend acepta: el primero de STAGING_ALLOWED_ORIGINS (o el que se pida a mano).
FIRST_ALLOWED_ORIGIN="${STAGING_ALLOWED_ORIGINS%%,*}"
ALLOWED_ORIGIN="${ORIGIN_OVERRIDE:-$FIRST_ALLOWED_ORIGIN}"
[[ "$ALLOWED_ORIGIN" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] \
  || die "El Origin del criterio 3 no es un origen valido (https://host): ${ALLOWED_ORIGIN}"
[[ "$ALLOWED_ORIGIN" != "$OTHER_ORIGIN" ]] || die "ALLOWED_ORIGIN no puede ser el origen de la prueba negativa (${OTHER_ORIGIN})"

HDR_FILE="$(mktemp)"
BODY_FILE="$(mktemp)"
ERR_FILE="$(mktemp)"
log "Frontend: ${FRONTEND_URL} · Origin permitido para la prueba: ${ALLOWED_ORIGIN} · region esperada: ${VERCEL_REGION}"
# Solo el primer origen: la lista puede llegar a tener varios y los demas no son el alias de staging.
if [[ "$FIRST_ALLOWED_ORIGIN" != "$STAGING_FRONTEND_URL" ]]; then
  st_warn "El primer origen de STAGING_ALLOWED_ORIGINS (${FIRST_ALLOWED_ORIGIN}) no es FRONTEND_URL de staging.env (${STAGING_FRONTEND_URL}): alguno de los dos quedo desactualizado"
fi
if [[ "$FRONTEND_URL" != "$STAGING_FRONTEND_URL" ]]; then
  st_info "Se prueba ${FRONTEND_URL}, que no es el alias de staging (${STAGING_FRONTEND_URL}): no sirve como evidencia del criterio 1"
fi

# --- Criterio 1 ---------------------------------------------------------------------------------------
step "1/5 Criterio 1: el alias responde"
request GET /login
case "$CODE" in
  200) st_ok "GET /login -> 200" ;;
  401) st_fail "GET /login -> 401: la proteccion de despliegues de Vercel pide inicio de sesion en este dominio (Settings > Deployment Protection; el alias de staging debe ser publico)" ;;
  *) st_fail "GET /login -> ${CODE} (se esperaba 200). ¿El dominio esta asignado al proyecto y el ultimo despliegue esta en verde?" ;;
esac

request GET /
location="$(header location)"
if [[ "$CODE" == "307" && "$location" == */login ]]; then
  st_ok "GET / -> 307 a ${location} (sin cookie, el proxy manda a /login)"
else
  st_fail "GET / -> ${CODE}${location:+ a ${location}} (se esperaba 307 a /login)"
fi
# Informativo, nunca un fallo: la cabecera de id es <borde>::<id> y solo lleva un segmento extra con la
# region de la funcion (<borde>::<funcion>::<id>) cuando una funcion atendio el pedido. Ninguna ruta
# publica pasa por una funcion: /login es estatica y / sin cookie la contesta el proxy de rutas privadas
# con su redireccion, asi que lo normal aqui es ver solo la region del BORDE. La region de las funciones
# se confirma en la pagina del despliegue (dashboard), no con este script. Settings > Functions no sirve:
# muestra la region por defecto del proyecto (iad1) y vercel.json la sobrescribe en cada despliegue.
vid="$(header x-vercel-id)"
if [[ "$vid" == *::*::* ]]; then
  rest="${vid#*::}"
  fn_region="${rest%%::*}"
  if [[ "$fn_region" == "$VERCEL_REGION" ]]; then
    st_ok "Region de la funcion (x-vercel-id): ${fn_region}"
  else
    st_warn "Region de la funcion (x-vercel-id): ${fn_region}, se esperaba ${VERCEL_REGION}. Confirma la region efectiva en la pagina del despliegue (dashboard)"
  fi
elif [[ -n "$vid" ]]; then
  st_info "x-vercel-id=${vid}: solo trae la region del borde (${vid%%::*}); no hay segmento de funcion porque este pedido no la invoco. No dice nada de la region de las funciones: se confirma en la pagina del despliegue (dashboard)"
else
  st_info "La respuesta no trae x-vercel-id: la region de las funciones se confirma en la pagina del despliegue (dashboard)"
fi
dep="$(header x-vercel-deployment-url)"
if [[ -n "$dep" ]]; then
  st_info "Despliegue que sirvio la respuesta: ${dep} (cambia con cada despliegue; el alias debe seguir respondiendo)"
else
  st_info "La respuesta no trae la cabecera del despliegue: la estabilidad del alias se confirma en Settings > Domains y repitiendo este script tras el siguiente despliegue"
fi

# --- Criterio 2 ---------------------------------------------------------------------------------------
step "2/5 Criterio 2: /api/health responde 200 por el rewrite"
request GET /api/health
if [[ "$CODE" == "200" ]]; then
  if [[ "$(body_json)" == '{"status":"ok"}' ]]; then
    st_ok "GET /api/health -> 200 {\"status\":\"ok\"}"
  else
    st_ok "GET /api/health -> 200"
    st_warn "El cuerpo de /api/health no es {\"status\":\"ok\"}: $(head -c 200 "$BODY_FILE" | tr -d '\n')"
  fi
else
  st_fail "GET /api/health -> ${CODE} (se esperaba 200). Revisa BACKEND_URL en Vercel (sin barra final) y que el servicio de Cloud Run este desplegado"
fi
# Solo informativo y nunca un fallo: /healthz es una ruta reservada de Cloud Run (termina en "z").
request GET /api/healthz
if grep -qi '<html' "$BODY_FILE" 2>/dev/null; then
  st_info "GET /api/healthz -> ${CODE} con HTML de Google: ruta reservada de Cloud Run, no llega a la app; por eso el criterio usa /api/health"
else
  st_info "GET /api/healthz -> ${CODE} (informativo): en Cloud Run no se usan rutas que terminen en z; el criterio es /api/health"
fi

# --- Criterio 3 ---------------------------------------------------------------------------------------
step "3/5 Criterio 3: el Set-Cookie del backend llega por el rewrite"
request DELETE /api/auth/session "Origin: ${ALLOWED_ORIGIN}"
if [[ "$CODE" == "204" ]]; then
  st_ok "DELETE /api/auth/session con Origin ${ALLOWED_ORIGIN} -> 204"
  cookie_line="$(set_cookies | grep -E "^${SESSION_COOKIE_NAME}=" | head -n 1 || true)"
  if [[ -z "$cookie_line" ]]; then
    st_fail "La respuesta 204 no trae Set-Cookie para ${SESSION_COOKIE_NAME}: el rewrite (o Vercel) lo quito, o el backend no corre con ENV=staging"
  else
    # Nunca se imprime la linea: solo se comprueba. Aqui la cookie debe ir vacia (es la de cierre de sesion).
    problems=()
    grep -qE "^${SESSION_COOKIE_NAME}=(\"\")?(;|$)" <<<"$cookie_line" || problems+=("la cookie no esta vacia")
    for attr in 'Max-Age=0' 'Path=/' 'Secure' 'HttpOnly' 'SameSite=lax'; do
      grep -qiE "(^|;[[:space:]]*)${attr}[[:space:]]*(;|\$)" <<<"$cookie_line" || problems+=("falta ${attr}")
    done
    if grep -qiE ';[[:space:]]*Domain=' <<<"$cookie_line"; then problems+=("lleva Domain (una cookie __Host- no puede)"); fi
    if (( ${#problems[@]} == 0 )); then
      st_ok "Set-Cookie ${SESSION_COOKIE_NAME}: vacia, Max-Age=0, Path=/, Secure, HttpOnly, SameSite=lax y sin Domain"
    else
      st_fail "Set-Cookie ${SESSION_COOKIE_NAME} con problemas: ${problems[*]}"
    fi
  fi
elif [[ "$CODE" == "403" ]]; then
  st_fail "DELETE /api/auth/session -> 403 (${ALLOWED_ORIGIN} no esta permitido): ALLOWED_ORIGINS del servicio de Cloud Run no coincide con STAGING_ALLOWED_ORIGINS, o Vercel no reenvia el Origin"
else
  st_fail "DELETE /api/auth/session -> ${CODE} (se esperaba 204)"
fi

request DELETE /api/auth/session "Origin: ${OTHER_ORIGIN}"
if [[ "$CODE" == "403" && "$(body_code)" == "origin_not_allowed" ]]; then
  if [[ -z "$(set_cookies)" ]]; then
    st_ok "Con Origin ${OTHER_ORIGIN} -> 403 origin_not_allowed y sin Set-Cookie (el rewrite reenvia el Origin y el backend lo aplica)"
  else
    st_fail "Con Origin ${OTHER_ORIGIN} -> 403 pero con Set-Cookie: no debia emitir ninguna cookie"
  fi
else
  st_fail "Con Origin ${OTHER_ORIGIN} -> ${CODE} code=$(body_code) (se esperaba 403 origin_not_allowed): ¿el backend admite cualquier origen?"
fi

# --- Criterio 6 ---------------------------------------------------------------------------------------
step "4/5 Criterio 6: /api/docs, /api/redoc y /api/openapi.json responden 404"
for path in /api/docs /api/redoc /api/openapi.json; do
  request GET "$path"
  if [[ "$CODE" == "404" ]]; then
    # El 404 de la app es JSON con code=not_found; uno distinto (HTML de Next o de Google) significa que
    # el pedido no llego a la app y el 404 no demuestra que los docs esten apagados.
    if [[ "$(body_code)" == "not_found" ]]; then
      st_ok "GET ${path} -> 404 (el JSON de la app)"
    else
      st_fail "GET ${path} -> 404 pero no es el de la app (cuerpo: $(head -c 120 "$BODY_FILE" | tr -d '\n')): ¿el rewrite llega al backend?"
    fi
  else
    st_fail "GET ${path} -> ${CODE} (se esperaba 404): ¿falta ENV=staging en el servicio de Cloud Run?"
  fi
done

# --- Resumen ------------------------------------------------------------------------------------------
step "5/5 Resumen"
st_info "No se mide aqui: criterio 4 (el build falla con NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST en Vercel) y criterio 5 (la preview del PR compila): son del dashboard de Vercel y de GitHub, ver infra/RECURSOS.md"
st_info "No se mide aqui: el alias en Settings > Domains y la region efectiva de las funciones, que se ve en la pagina del despliegue (Settings > Functions muestra la region por defecto del proyecto, no la efectiva; desde fuera no se mide: ninguna ruta publica invoca una funcion)"
summary_check
