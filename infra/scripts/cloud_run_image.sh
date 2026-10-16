#!/usr/bin/env bash
# Construye la imagen del backend y la sube a Artifact Registry de staging (KAN-13, INF-07). La misma
# imagen sirve para el servicio de Cloud Run y para el job de migraciones. Es la parte manual de
# "build -> registro": el CD automático (KAN-16) hará lo mismo desde GitHub Actions.
#
# Uso:
#   bash infra/scripts/cloud_run_image.sh                    # construye y sube; pregunta antes de subir
#   DRY_RUN=1 bash infra/scripts/cloud_run_image.sh          # solo imprime los comandos
#   IMAGE_TAG=mi-prueba bash infra/scripts/cloud_run_image.sh   # etiqueta propia (nunca "latest")
#
# Etiqueta por defecto: el sha corto del commit (12 caracteres); si backend/ tiene cambios sin
# commitear, termina en -dirty. Así cada imagen se puede rastrear a un commit, o se sabe que no se
# puede. No se usa "latest": no dice qué hay desplegado.
#
# Requisito (una sola vez, lo corre el humano): que Docker pueda subir al registro con tu sesión de
# gcloud:
#   gcloud auth configure-docker southamerica-east1-docker.pkg.dev
# Esto escribe ~/.docker/config.json (un ayudante de credenciales, no una llave). El script no lee
# ese archivo: si falta, el push falla y el mensaje te lo recuerda.
#
# La imagen se construye para linux/amd64 (la arquitectura de Cloud Run) y sin atestaciones de
# BuildKit (--provenance=false --sbom=false), para subir un manifiesto de imagen simple y no una lista
# de manifiestos con entradas "unknown/unknown".
#
# Con DRY_RUN=1 las lecturas SÍ se hacen contra la nube; solo se omiten las escrituras.
set -euo pipefail

source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/../env/staging.env"

export CLOUDSDK_CORE_DISABLE_PROMPTS=1

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"
AR_HOST="${GCP_REGION}-docker.pkg.dev"
IMAGE_PATH="${AR_HOST}/${GCP_PROJECT_ID}/${AR_REPOSITORY}/${IMAGE_NAME}"

step "0/3 Comprobaciones previas"
[[ -n "$(command -v gcloud)" ]] || die "Falta gcloud"
[[ -n "$(command -v docker)" ]] || die "Falta docker"
[[ "$GCP_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "GCP_PROJECT_ID no válido: ${GCP_PROJECT_ID}"
[[ "$GCP_PROJECT_ID" == *-stg ]] || die "GCP_PROJECT_ID debe terminar en -stg (recibido: ${GCP_PROJECT_ID})"
[[ "$GCP_REGION" == "southamerica-east1" ]] || die "Región inesperada: ${GCP_REGION}"
[[ "$AR_REPOSITORY" == *-stg ]] || die "AR_REPOSITORY debe terminar en -stg (recibido: ${AR_REPOSITORY})"
[[ -f "${BACKEND_DIR}/Dockerfile" ]] || die "No encuentro ${BACKEND_DIR}/Dockerfile"
docker info >/dev/null 2>&1 || die "Docker no responde: ¿está encendido el servicio de Docker?"

IMAGE_TAG="${IMAGE_TAG:-}"
GIT_SHA=""
if [[ -z "$IMAGE_TAG" ]]; then
  GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)" || die "No pude leer el commit actual"
  IMAGE_TAG="$GIT_SHA"
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- backend)" ]]; then
    IMAGE_TAG="${GIT_SHA}-dirty"
    st_warn "backend/ tiene cambios sin commitear: la etiqueta será ${IMAGE_TAG} (no corresponde a un commit exacto)"
  fi
fi
[[ "$IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$ ]] || die "IMAGE_TAG no válida: ${IMAGE_TAG}"
[[ "$IMAGE_TAG" != "latest" ]] || die "No se usa la etiqueta latest: elige una que identifique la imagen"
IMAGE="${IMAGE_PATH}:${IMAGE_TAG}"
if is_dry; then
  log "DRY_RUN=1: solo lecturas; ninguna escritura se ejecuta"
fi
log "Proyecto ${GCP_PROJECT_ID} · región ${GCP_REGION} · imagen ${IMAGE}"

step "1/3 Construir la imagen (local, sin nube)"
BUILD_ARGS=(--platform linux/amd64 --provenance=false --sbom=false --tag "$IMAGE")
if [[ -n "$GIT_SHA" ]]; then
  BUILD_ARGS+=(--label "org.opencontainers.image.revision=${GIT_SHA}")
fi
run docker build "${BUILD_ARGS[@]}" "$BACKEND_DIR"
st_ok "Imagen construida: ${IMAGE}"

step "2/3 Subir a Artifact Registry de ${GCP_PROJECT_ID}"
ask_apply
if ! run docker push "$IMAGE"; then
  die "No pude subir la imagen. Si el error es de autenticación, corre una vez: gcloud auth configure-docker ${AR_HOST}  (y vuelve a correr este script)"
fi
st_created "Imagen ${IMAGE} en ${AR_REPOSITORY}"

step "3/3 Comprobar lo subido"
if is_dry; then
  log "DRY_RUN=1: no se consulta el digest porque la imagen no se subió"
else
  probe gcloud artifacts docker images describe "$IMAGE" --project="$GCP_PROJECT_ID" --format='value(image_summary.digest)' \
    || die "La imagen no aparece en ${AR_REPOSITORY} tras subirla"
  st_ok "En el registro: ${IMAGE_PATH}@${PROBE_OUT}"
fi
st_info "Para crear o comparar el servicio y el job: IMAGE_TAG=${IMAGE_TAG} bash infra/scripts/40_cloud_run.sh"
st_info "En la Consola de Cloud Run, la imagen se elige en Artifact Registry > ${AR_REPOSITORY} > ${IMAGE_NAME} > ${IMAGE_TAG}"

summary
