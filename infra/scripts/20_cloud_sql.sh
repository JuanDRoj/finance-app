#!/usr/bin/env bash
# Cloud SQL de staging (KAN-10, INF-04): instancia, base de datos, usuario de la app, secreto con su
# contraseña y acceso de lectura de la cuenta de Cloud Run SOLO a ese secreto. Idempotente: lee lo que
# ya existe y solo crea o corrige lo que falta. Refleja el estado creado a mano en la consola
# (15/10/2026), así que en kanza-stg una corrida debería limitarse a verificar (ver los avisos de cada
# paso) y sirve también para recrear staging desde cero.
#
# Uso:
#   DRY_RUN=1 bash infra/scripts/20_cloud_sql.sh   # solo lecturas: imprime lo que haría
#   bash infra/scripts/20_cloud_sql.sh             # aplica; pide confirmación antes del primer cambio
#
# Reglas que este script nunca rompe:
#   - Una instancia existente solo se COMPARA: las diferencias se avisan, nunca se modifican (varios
#     cambios reinician la instancia o exigen mantenimiento).
#   - Nunca enciende ni apaga la instancia (eso es sql_power.sh). Con la instancia apagada, la base de
#     datos y el usuario no se pueden consultar (la API responde "instance is not running"): se avisa.
#     Para verificarlos: sql_power.sh start, este script, sql_power.sh stop.
#   - Nunca cambia ni regenera la contraseña de un usuario que ya existe. La contraseña solo se genera
#     cuando el usuario NO existe; vive en una variable en memoria y viaja por stdin al secreto: no se
#     imprime, no queda en el historial ni en el log de archivo de gcloud (ver provision_user) y el
#     script se niega a correr con xtrace.
#   - Nunca lee el valor del secreto (solo sus metadatos y la lista de versiones).
#
# Una instancia creada desde cero queda ENCENDIDA (así lo hace la creación): al final se avisa para que
# la apagues con sql_power.sh stop.
#
# Con DRY_RUN=1 las lecturas SÍ se hacen contra la nube; solo se omiten las escrituras.
set -euo pipefail

source "$(dirname "$0")/lib.sh"
refuse_xtrace
source "$(dirname "$0")/../env/staging.env"
source "$(dirname "$0")/lib_sql.sh"

# Sin preguntas interactivas de gcloud: la única confirmación es la de este script.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

# --- Estado deseado -----------------------------------------------------------------------------

RUN_SA_EMAIL="${RUN_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
SECRET_ACCESSOR_ROLE="roles/secretmanager.secretAccessor"

# Política de contraseñas de la instancia tal como quedó en la consola: complejidad por defecto
# (mayúsculas, minúsculas, números y un carácter no alfanumérico), mínimo 8 y sin el nombre de usuario
# dentro de la contraseña. La contraseña que genera este script la cumple.
PW_COMPLEXITY="COMPLEXITY_DEFAULT"
PW_MIN_LENGTH=8

# APIs que usa este script (las habilita 10_gcp_project.sh).
NEEDED_APIS=(
  sqladmin.googleapis.com
  secretmanager.googleapis.com
  iam.googleapis.com
  cloudresourcemanager.googleapis.com
)

# El tipo de disco de la API es PD_SSD / PD_HDD; en staging.env va como SSD / HDD.
case "$SQL_STORAGE_TYPE" in
  SSD) WANT_DISK="PD_SSD" ;;
  HDD) WANT_DISK="PD_HDD" ;;
  *) die "SQL_STORAGE_TYPE no soportado por este script: ${SQL_STORAGE_TYPE}" ;;
esac
WANT_EDITION="${SQL_EDITION^^}"
# El tipo del secreto se escribe other-db-credentials en la CLI y OTHER_DB_CREDENTIALS en la API.
WANT_SECRET_TYPE="${DB_SECRET_TYPE//-/_}"
WANT_SECRET_TYPE="${WANT_SECRET_TYPE^^}"

# Diferencias entre la instancia viva y lo declarado, en texto. La etiqueta se revisa aparte porque
# no se puede poner con la CLI. Los campos opcionales ausentes cuentan como "apagado".
DRIFT_JQ='
  def chk($name; $got; $want):
    if ($got | tostring) == ($want | tostring) then empty
    else "\($name)=\($got | tostring) (esperado \($want | tostring))" end;
  . as $i | (.settings // {}) as $s | ($s.ipConfiguration // {}) as $ip | ($s.passwordValidationPolicy // {}) as $pw | [
    chk("versión"; $i.databaseVersion; $ver),
    chk("región"; $i.region; $region),
    chk("edición"; $s.edition; $edition),
    chk("tier"; $s.tier; $tier),
    chk("tipo de disco"; $s.dataDiskType; $disk),
    chk("tamaño de disco (GB)"; $s.dataDiskSizeGb; $gb),
    chk("aumento automático de disco"; ($s.storageAutoResize // false); false),
    chk("disponibilidad"; $s.availabilityType; "ZONAL"),
    chk("copias automáticas"; ($s.backupConfiguration.enabled // false); false),
    chk("recuperación a un punto en el tiempo"; ($s.backupConfiguration.pointInTimeRecoveryEnabled // false); false),
    chk("copias retenidas tras eliminar la instancia"; ($s.retainBackupsOnDelete // false); false),
    chk("copia final"; ($s.finalBackupConfig.enabled // false); false),
    chk("IP pública"; ($ip.ipv4Enabled // false); true),
    chk("redes autorizadas"; (($ip.authorizedNetworks // []) | length); 0),
    chk("red privada"; ($ip.privateNetwork // ""); ""),
    chk("modo SSL"; $ip.sslMode; $ssl),
    chk("modo de CA del servidor"; $ip.serverCaMode; $ca),
    chk("protección contra eliminación"; ($s.deletionProtectionEnabled // false); true),
    chk("flag cloudsql.iam_authentication"; ([($s.databaseFlags // [])[] | select(.name == "cloudsql.iam_authentication") | .value] | (first // "")); "on"),
    chk("Query Insights"; ($s.insightsConfig.queryInsightsEnabled // false); true),
    chk("IP de clientes en Query Insights"; ($s.insightsConfig.recordClientAddress // false); false),
    chk("etiquetas de app en Query Insights"; ($s.insightsConfig.recordApplicationTags // false); false),
    chk("política de contraseñas"; ($pw.enablePasswordPolicy // false); true),
    chk("complejidad de contraseñas"; $pw.complexity; $complexity),
    chk("largo mínimo de contraseña"; $pw.minLength; $minlen)
  ] | join(", ")'

# --- Utilidades del script ------------------------------------------------------------------------

# Contraseña aleatoria: 24 hex en mayúsculas, un guion y 24 hex en minúsculas. Cumple la complejidad
# por defecto (mayúscula, minúscula, número y carácter no alfanumérico) y no tiene caracteres que
# haya que escapar en una URL o en una línea de comandos. Se reintenta si faltara una clase.
gen_password() {
  local hex pw i
  for i in 1 2 3 4 5; do
    hex="$(openssl rand -hex 24)"
    pw="${hex:0:24}"
    pw="${pw^^}-${hex:24}"
    if [[ "$pw" =~ [[:upper:]] && "$pw" =~ [[:lower:]] && "$pw" =~ [[:digit:]] ]]; then
      printf '%s' "$pw"
      return 0
    fi
  done
  return 1
}

# Guarda NEW_PW en el secreto por stdin (printf es un comando interno: la contraseña no pasa por argv).
# Si el secreto existe añade una versión; si no, lo crea con replicación solo en la región y el tipo
# de la consola. Sin --location: esa opción crearía un secreto regional, que es otro recurso.
store_password_in_secret() {
  if (( SECRET_EXISTS )); then
    printf '%s' "$NEW_PW" | gcloud secrets versions add "$DB_PASSWORD_SECRET" --project="$GCP_PROJECT_ID" --data-file=- --format=none
  else
    printf '%s' "$NEW_PW" | gcloud secrets create "$DB_PASSWORD_SECRET" --project="$GCP_PROJECT_ID" \
      --replication-policy=user-managed --locations="$GCP_REGION" \
      --labels="env=${ENV_LABEL}" --secret-type="$DB_SECRET_TYPE" --data-file=- --format=none
  fi
}

# Crea el usuario de la app con su contraseña y la guarda en el secreto. Solo se llama cuando el
# usuario NO existe. Primero el secreto y después el usuario: si algo falla entre los dos, la
# siguiente corrida ve "usuario ausente", genera otra contraseña y deja todo consistente.
#
# La contraseña en disco y en argumentos:
#   - El secreto la recibe por stdin (printf es un comando interno y --data-file=- solo lleva un guion en
#     los argumentos), así que no figura en ninguna línea de comandos.
#   - sql users create solo acepta --password (sin archivo, stdin ni petición interactiva), así que va
#     en los argumentos. gcloud guarda los argumentos de cada comando en su log de archivo
#     (~/.config/gcloud/logs), de modo que ESE comando corre con CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1
#     (propiedad core/disable_file_logging, verificada en el SDK 589). Sin eso la contraseña quedaría en
#     texto plano en disco.
#   - Riesgo residual aceptado: durante los segundos que dura ese comando los argumentos son visibles
#     en `ps` de la misma máquina. Es una máquina de un solo usuario y solo ocurre al crear el usuario
#     desde cero (no en las corridas normales, donde el usuario ya existe).
provision_user() {
  if is_dry; then
    if (( SECRET_EXISTS )); then
      printf '[dry-run] %s\n' "printf '%s' <contraseña generada> | gcloud secrets versions add ${DB_PASSWORD_SECRET} --project=${GCP_PROJECT_ID} --data-file=-"
    else
      printf '[dry-run] %s\n' "printf '%s' <contraseña generada> | gcloud secrets create ${DB_PASSWORD_SECRET} --project=${GCP_PROJECT_ID} --replication-policy=user-managed --locations=${GCP_REGION} --labels=env=${ENV_LABEL} --secret-type=${DB_SECRET_TYPE} --data-file=-"
    fi
    printf '[dry-run] %s\n' "CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud sql users create ${DB_USER} --instance=${SQL_INSTANCE} --project=${GCP_PROJECT_ID} --password=<contraseña generada>"
    SECRET_PLANNED=1
    return 0
  fi
  command -v openssl >/dev/null || die "Falta openssl (hace falta para generar la contraseña)"
  if (( SECRET_EXISTS && SECRET_VERSIONS > 0 )); then
    confirm "El secreto ${DB_PASSWORD_SECRET} ya tiene una versión y el usuario ${DB_USER} no existe: se añadirá una versión nueva con la contraseña del usuario nuevo (la anterior queda como versión previa). ¿Continuar?" \
      || die "Cancelado"
  fi
  ask_apply
  NEW_PW="$(gen_password)" || die "No pude generar una contraseña que cumpla la política"
  redact_add "$NEW_PW"
  store_password_in_secret || { NEW_PW=""; die "No pude guardar la contraseña en el secreto ${DB_PASSWORD_SECRET}; no se creó el usuario"; }
  SECRET_EXISTS=1
  SECRET_VERSIONS=$((SECRET_VERSIONS + 1))
  if ! CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --password="$NEW_PW" --format=none; then
    NEW_PW=""
    die "La contraseña nueva ya está en el secreto, pero no pude crear el usuario ${DB_USER}. Vuelve a correr el script: generará otra y la guardará como versión nueva."
  fi
  NEW_PW=""
}

# --- 0. Comprobaciones previas --------------------------------------------------------------------

step "0/7 Comprobaciones previas"
sql_preflight
[[ "$DB_PASSWORD_SECRET" =~ ^[a-z][a-z0-9-]*-stg$ ]] || die "DB_PASSWORD_SECRET no válido o sin sufijo -stg: ${DB_PASSWORD_SECRET}"
[[ "$DB_NAME" =~ ^[a-z][a-z0-9_]*$ ]] || die "DB_NAME no válido: ${DB_NAME}"
[[ "$DB_USER" =~ ^[a-z][a-z0-9_]*$ ]] || die "DB_USER no válido: ${DB_USER}"
if is_dry; then
  log "DRY_RUN=1: solo lecturas; ninguna escritura se ejecuta"
fi
log "Proyecto ${GCP_PROJECT_ID} · región ${GCP_REGION} · instancia ${SQL_INSTANCE}"

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
st_ok "Cuenta de servicio ${RUN_SA_EMAIL}"

# --- 1. Instancia ---------------------------------------------------------------------------------
# PostgreSQL 16 en la instancia más pequeña (db-f1-micro, núcleo compartido), zonal, 10 GB de SSD sin
# aumento automático, IP pública SIN redes autorizadas: solo se entra con el Cloud SQL Connector o el
# proxy, y el modo SSL exige certificado de cliente de confianza (el conector lo trae). Sin copias
# automáticas ni recuperación a un punto en el tiempo (staging, el costo manda) y con protección contra
# eliminación. cloudsql.iam_authentication=on viene del preset de la consola y se conserva.
# No se fija la zona, la ventana de mantenimiento, la rotación de certificados, la contraseña de
# postgres ni la integración con Dataplex: quedan como los deja Google. La integración con IA no se
# activa. La etiqueta env=staging no se puede poner con la CLI de este SDK: se pone en la consola.

step "1/7 Instancia ${SQL_INSTANCE}"
INSTANCE_EXISTS=0
SIMULATED_NEW=0
JUST_CREATED=0
if sql_instance_exists; then
  INSTANCE_EXISTS=1
  sql_wait_pending
  sql_describe
  drift="$(jq -r \
    --arg ver "$SQL_DATABASE_VERSION" --arg region "$GCP_REGION" --arg edition "$WANT_EDITION" \
    --arg tier "$SQL_TIER" --arg disk "$WANT_DISK" --arg gb "$SQL_STORAGE_GB" \
    --arg ssl "$SQL_SSL_MODE" --arg ca "$SQL_SERVER_CA_MODE" \
    --arg complexity "$PW_COMPLEXITY" --argjson minlen "$PW_MIN_LENGTH" \
    "$DRIFT_JQ" <<<"$SQL_JSON")"
  if [[ -z "$drift" ]]; then
    st_ok "Instancia ${SQL_INSTANCE} coincide con lo declarado (${SQL_DATABASE_VERSION}, ${SQL_EDITION}, ${SQL_TIER}, ${SQL_STORAGE_GB} GB ${SQL_STORAGE_TYPE}, IP pública sin redes autorizadas, ${SQL_SSL_MODE})"
  else
    st_warn "La instancia ${SQL_INSTANCE} difiere en: ${drift}. No se modifica sola: varios cambios reinician la instancia o exigen mantenimiento."
  fi
  label_env="$(jq -r '.settings.userLabels.env // ""' <<<"$SQL_JSON")"
  if [[ "$label_env" == "$ENV_LABEL" ]]; then
    st_ok "Etiqueta env=${ENV_LABEL} en la instancia"
  else
    st_warn "La instancia no tiene la etiqueta env=${ENV_LABEL}. Esta versión de la CLI no permite ponerla: hazlo en la consola (Cloud SQL, la instancia, Editar, Etiquetas)."
  fi
  st_info "Nombre de conexión: ${SQL_CONNECTION_NAME} · versión instalada: $(jq -r '.databaseInstalledVersion // "?"' <<<"$SQL_JSON") · zona: $(jq -r '.gceZone // "?"' <<<"$SQL_JSON")"
  if [[ "$(jq -r '.settings.connectorEnforcement // ""' <<<"$SQL_JSON")" != "REQUIRED" ]]; then
    st_info "connectorEnforcement no es REQUIRED: la API admite conexiones sin conector, pero el modo SSL exige certificado de cliente, así que en la práctica solo entra el conector o el proxy"
  fi
else
  create_args=(
    --database-version="$SQL_DATABASE_VERSION" --edition="$SQL_EDITION" --tier="$SQL_TIER"
    --availability-type=zonal
    --storage-type="$SQL_STORAGE_TYPE" --storage-size="$SQL_STORAGE_GB" --no-storage-auto-increase
    --no-backup --deletion-protection --assign-ip
    --ssl-mode="$SQL_SSL_MODE" --server-ca-mode="$SQL_SERVER_CA_MODE"
    --database-flags=cloudsql.iam_authentication=on
    --insights-config-query-insights-enabled
    --no-insights-config-record-client-address --no-insights-config-record-application-tags
    --enable-password-policy --password-policy-complexity="$PW_COMPLEXITY"
    --password-policy-min-length="$PW_MIN_LENGTH" --password-policy-disallow-username-substring
    --async
  )
  if is_dry; then
    write gcloud sql instances create "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" "${create_args[@]}" --format='value(name)'
    SIMULATED_NEW=1
  else
    ask_apply
    create_op="$(gcloud sql instances create "$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" "${create_args[@]}" --format='value(name)')" \
      || die "No pude crear la instancia ${SQL_INSTANCE}"
    JUST_CREATED=1
    # La creación tarda varios minutos. Se espera la operación por su id; si el id no se pudo leer, o
    # la lista de operaciones aún no la muestra, se espera por el estado de la instancia (RUNNABLE),
    # con límite. Así nunca se sigue con la instancia en PENDING_CREATE.
    if [[ "$create_op" =~ ^[0-9a-f-]{20,}$ ]]; then
      sql_wait_op "$create_op"
    else
      st_info "No pude leer el id de la operación de creación; se espera por el estado de la instancia"
    fi
    sql_wait_state RUNNABLE
    INSTANCE_EXISTS=1
  fi
  st_created "Instancia ${SQL_INSTANCE} (${SQL_DATABASE_VERSION}, ${SQL_EDITION}, ${SQL_TIER}, ${SQL_STORAGE_GB} GB ${SQL_STORAGE_TYPE}, ${GCP_REGION})"
  st_warn "La etiqueta env=${ENV_LABEL} de la instancia no se puede poner con la CLI de este SDK: hazlo en la consola (Cloud SQL, la instancia, Editar, Etiquetas)."
fi

# --- 2. Energía -----------------------------------------------------------------------------------
# Detenida, una instancia queda en estado STOPPED (política NEVER). Este script solo lo lee.

step "2/7 Encendida o apagada"
if [[ -z "$SQL_JSON" ]]; then
  SQL_JSON='{}'
fi
POWER="unknown"
if (( INSTANCE_EXISTS )); then
  POWER="$(sql_power_state)"
elif (( SIMULATED_NEW )); then
  POWER="running"
  st_info "Simulado: una instancia recién creada queda encendida"
fi
case "$POWER" in
  running) st_info "La instancia está ENCENDIDA (se cobra por hora)" ;;
  stopped) st_ok "La instancia está APAGADA (solo se cobra el disco)" ;;
  *) st_warn "La instancia está en un estado intermedio o inesperado ($(jq -r '.state // "?"' <<<"$SQL_JSON")); BD y usuario no se verifican" ;;
esac

# --- 3. Secreto -----------------------------------------------------------------------------------
# Contraseña de la app en Secret Manager, con replicación administrada por el usuario solo en la
# región única, etiqueta env=staging y tipo "otras credenciales de bases de datos". Sin rotación,
# vencimiento ni destrucción retrasada. Solo se leen sus metadatos y la lista de versiones: el valor
# nunca se lee. Si no existe, se crea en el paso 4 junto con el usuario (así la contraseña del secreto
# y la del usuario salen del mismo valor).

step "3/7 Secreto ${DB_PASSWORD_SECRET}"
SECRET_EXISTS=0
SECRET_PLANNED=0
SECRET_VERSIONS=0
if probe gcloud secrets describe "$DB_PASSWORD_SECRET" --project="$GCP_PROJECT_ID" --format=json; then
  SECRET_EXISTS=1
  secret_json="$(sed -n '/^{/,$p' <<<"$PROBE_OUT")"

  replicas="$(jq -r '[(.replication.userManaged.replicas // [])[] | .location] | sort | join(",")' <<<"$secret_json")"
  if [[ "$replicas" == "$GCP_REGION" ]]; then
    st_ok "Replicación administrada por el usuario solo en ${GCP_REGION}"
  else
    st_warn "La replicación del secreto es '${replicas:-automática}' y se esperaba solo ${GCP_REGION}. No se puede cambiar en un secreto existente: decisión humana."
  fi

  secret_type="$(jq -r '.secretType // ""' <<<"$secret_json")"
  if [[ -z "$secret_type" ]]; then
    st_info "La API no devolvió el tipo del secreto; no se compara"
  elif [[ "$secret_type" == "$WANT_SECRET_TYPE" ]]; then
    st_ok "Tipo de secreto ${secret_type}"
  else
    st_warn "El tipo del secreto es ${secret_type} y se esperaba ${WANT_SECRET_TYPE}. Se avisa; no se cambia."
  fi

  extras="$(jq -r '[(if .expireTime then "vencimiento" else empty end), (if .ttl then "ttl" else empty end),
    (if .rotation then "rotación" else empty end), (if .versionDestroyTtl then "destrucción retrasada" else empty end),
    (if ((.topics // []) | length) > 0 then "notificaciones" else empty end)] | join(", ")' <<<"$secret_json")"
  if [[ -n "$extras" ]]; then
    st_warn "El secreto tiene configurado: ${extras}. Se esperaba sin nada de eso (un vencimiento lo borraría solo)."
  fi

  if [[ "$(jq -r '.labels.env // ""' <<<"$secret_json")" == "$ENV_LABEL" ]]; then
    st_ok "Etiqueta env=${ENV_LABEL} en el secreto"
  else
    write gcloud secrets update "$DB_PASSWORD_SECRET" --project="$GCP_PROJECT_ID" --update-labels="env=${ENV_LABEL}" --format=none
    st_fixed "Etiqueta env=${ENV_LABEL} en el secreto"
  fi

  # Versiones: solo metadatos (versions list), nunca el valor.
  probe gcloud secrets versions list "$DB_PASSWORD_SECRET" --project="$GCP_PROJECT_ID" --format=json \
    || die "No pude listar las versiones del secreto"
  versions_json="$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")"
  SECRET_VERSIONS="$(jq '[.[] | select((.state // "" | ascii_downcase) == "enabled")] | length' <<<"${versions_json:-[]}")"
  if (( SECRET_VERSIONS > 0 )); then
    st_ok "El secreto tiene ${SECRET_VERSIONS} versión(es) habilitada(s) (el valor no se lee)"
  else
    st_warn "El secreto no tiene ninguna versión habilitada. Si el usuario ${DB_USER} no existe se añadirá una en el paso 4."
  fi
else
  st_info "El secreto ${DB_PASSWORD_SECRET} no existe: se creará en el paso 4 junto con el usuario ${DB_USER}"
fi

# --- 4. Base de datos y usuario -------------------------------------------------------------------
# La BD y el usuario solo se pueden leer con la instancia encendida. Usuario integrado (BUILT_IN) en
# cloudsqlsuperuser: aceptado en staging; en prod convendrá un usuario de mínimos privilegios y otro
# para migraciones. La contraseña del usuario que ya existe no se toca.

step "4/7 Base de datos ${DB_NAME} y usuario ${DB_USER}"
if [[ "$POWER" != "running" ]]; then
  st_warn "No verificable con la instancia apagada o en transición: la base de datos ${DB_NAME} y el usuario ${DB_USER} no se pueden consultar. Enciéndela con bash infra/scripts/sql_power.sh start, vuelve a correr este script y apágala al terminar."
else
  DB_PRESENT=0
  USER_PRESENT=0
  user_type="BUILT_IN"
  if (( INSTANCE_EXISTS )); then
    probe gcloud sql databases list --instance="$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --format=json \
      || die "No pude listar las bases de datos de ${SQL_INSTANCE}"
    dbs_json="$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")"
    if jq -e --arg n "$DB_NAME" 'any(.[]; .name == $n)' <<<"${dbs_json:-[]}" >/dev/null; then
      DB_PRESENT=1
      charset="$(jq -r --arg n "$DB_NAME" '.[] | select(.name == $n) | .charset // ""' <<<"$dbs_json")"
      if [[ -z "$charset" || "$charset" == "UTF8" ]]; then
        st_ok "Base de datos ${DB_NAME}"
      else
        st_warn "La base de datos ${DB_NAME} usa el juego de caracteres ${charset} y se esperaba UTF8"
      fi
    fi

    probe gcloud sql users list --instance="$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --format=json \
      || die "No pude listar los usuarios de ${SQL_INSTANCE}"
    users_json="$(sed -n '/^\[/,$p' <<<"$PROBE_OUT")"
    if jq -e --arg u "$DB_USER" 'any(.[]; .name == $u)' <<<"${users_json:-[]}" >/dev/null; then
      USER_PRESENT=1
      user_type="$(jq -r --arg u "$DB_USER" '.[] | select(.name == $u) | .type // "BUILT_IN"' <<<"$users_json")"
    fi
  fi

  if (( ! DB_PRESENT )); then
    write gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" --project="$GCP_PROJECT_ID" --format=none
    st_created "Base de datos ${DB_NAME}"
  fi

  if (( USER_PRESENT )); then
    if [[ "$user_type" == "BUILT_IN" ]]; then
      st_ok "Usuario ${DB_USER} (integrado, contraseña propia)"
    else
      st_warn "El usuario ${DB_USER} es de tipo ${user_type} y se esperaba BUILT_IN"
    fi
    if (( SECRET_EXISTS && SECRET_VERSIONS > 0 )); then
      st_ok "La contraseña de ${DB_USER} está en el secreto ${DB_PASSWORD_SECRET}; no se toca"
    else
      st_fail "El usuario ${DB_USER} existe pero el secreto ${DB_PASSWORD_SECRET} no existe o no tiene versión habilitada: la contraseña actual no se puede recuperar desde aquí. Decisión humana: restablecerla y guardarla en el secreto."
    fi
  else
    provision_user
    st_created "Usuario ${DB_USER} y secreto ${DB_PASSWORD_SECRET} con su contraseña (nunca impresa)"
  fi
fi

# --- 5. Acceso al secreto -------------------------------------------------------------------------
# La cuenta de Cloud Run lee ESTE secreto y ningún otro: el rol va sobre el secreto, no a nivel de
# proyecto (más estricto que el texto del ticket).

step "5/7 Acceso de ${RUN_SA_NAME} al secreto"
if (( SECRET_EXISTS )); then
  probe gcloud secrets get-iam-policy "$DB_PASSWORD_SECRET" --project="$GCP_PROJECT_ID" --format=json \
    || die "No pude leer la política IAM del secreto"
  policy_json="$(sed -n '/^{/,$p' <<<"$PROBE_OUT")"
  if jq -e --arg r "$SECRET_ACCESSOR_ROLE" --arg m "serviceAccount:${RUN_SA_EMAIL}" \
       'any(.bindings[]?; .role == $r and ((.members // []) | index($m) != null))' <<<"$policy_json" >/dev/null; then
    st_ok "${RUN_SA_NAME} tiene ${SECRET_ACCESSOR_ROLE} sobre el secreto"
  else
    write_retry 3 10 gcloud secrets add-iam-policy-binding "$DB_PASSWORD_SECRET" --project="$GCP_PROJECT_ID" \
      --member="serviceAccount:${RUN_SA_EMAIL}" --role="$SECRET_ACCESSOR_ROLE" --condition=None --format=none
    st_created "${SECRET_ACCESSOR_ROLE} para ${RUN_SA_NAME} sobre el secreto"
  fi
  others="$(jq -r --arg r "$SECRET_ACCESSOR_ROLE" --arg m "serviceAccount:${RUN_SA_EMAIL}" \
    '[.bindings[]? | .role as $role | (.members // [])[] | select(($role + " " + .) != ($r + " " + $m)) | $role + " " + .] | join("; ")' <<<"$policy_json")"
  if [[ -n "$others" ]]; then
    st_warn "El secreto tiene otros accesos además de ${RUN_SA_NAME}: ${others}"
  fi
elif (( SECRET_PLANNED )); then
  write_retry 3 10 gcloud secrets add-iam-policy-binding "$DB_PASSWORD_SECRET" --project="$GCP_PROJECT_ID" \
    --member="serviceAccount:${RUN_SA_EMAIL}" --role="$SECRET_ACCESSOR_ROLE" --condition=None --format=none
  st_created "${SECRET_ACCESSOR_ROLE} para ${RUN_SA_NAME} sobre el secreto"
else
  st_info "El secreto aún no existe; el acceso se otorga cuando se cree (corrida con la instancia encendida)"
fi

# --- 6. Verificaciones ----------------------------------------------------------------------------
# A nivel de proyecto la cuenta de Cloud Run no debe tener ningún rol de Secret Manager.

step "6/7 Verificaciones"
probe gcloud projects get-iam-policy "$GCP_PROJECT_ID" --flatten='bindings[].members' --format='value(bindings.role,bindings.members)' \
  || die "No pude leer la política IAM del proyecto"
sm_roles="$(awk -F'\t' -v m="serviceAccount:${RUN_SA_EMAIL}" '$2 == m && $1 ~ /^roles\/secretmanager\./ {print $1}' <<<"$PROBE_OUT")"
if [[ -n "$sm_roles" ]]; then
  st_fail "${RUN_SA_NAME} tiene roles de Secret Manager a nivel de proyecto: $(tr '\n' ' ' <<<"$sm_roles")"
else
  st_ok "${RUN_SA_NAME} no tiene roles de Secret Manager a nivel de proyecto (solo sobre el secreto)"
fi
st_info "max_connections no se lee aquí (hace falta la instancia encendida): lo imprime bash infra/scripts/sql_check.sh"
# El aviso sale siempre que la instancia se haya creado en esta corrida (queda encendida), aunque
# POWER no lo refleje, y siempre que esté encendida.
if (( JUST_CREATED )) || [[ "$POWER" == "running" ]]; then
  st_warn "La instancia ${SQL_INSTANCE} está ENCENDIDA y se cobra por hora. Cuando termines, apágala con: bash infra/scripts/sql_power.sh stop"
fi

# --- 7. Resumen -----------------------------------------------------------------------------------

step "7/7 Resumen"
summary
