# Infraestructura

Entornos: **local** (Docker Compose) y **staging** (GCP + Firebase + Vercel). **Prod no se toca** desde este repo por ahora; se agregará con Terraform antes del lanzamiento.
Región única: **`southamerica-east1`** (GCP) y **`gru1`** (funciones de Vercel).

## Mapa del Hito 0 (qué tarea crea qué)
| Tarea | Resultado |
|---|---|
| KAN-7  INF-01 | Monorepo (`/backend`, `/frontend`, `/infra`), README, protección de `main` |
| KAN-8  INF-02 | `docker-compose.yml`: PostgreSQL + emulador de Firebase Auth |
| KAN-9  INF-03 | Proyecto GCP staging (script idempotente), APIs, Artifact Registry, alerta de presupuesto |
| KAN-10 INF-04 | Cloud SQL staging (instancia mínima, apagable) + secreto de la contraseña |
| KAN-11 INF-05 | Firebase staging: proveedores email y Google (consola → checklist humana) |
| KAN-12 INF-06 | Workload Identity Federation GitHub → GCP |
| KAN-13 INF-07 | Cloud Run: servicio backend + Cloud Run Job de migraciones |
| KAN-14 INF-08 | Vercel staging: proyecto, variables (`BACKEND_URL`…) y región `gru1` en `frontend/vercel.json`. El rewrite `/api/*` vive en `frontend/next.config.ts` (frontend) |
| KAN-15 INF-09 | CI en PR (GitHub Actions) |
| KAN-16 INF-10 | CD a staging en merge a `main` |

## Estructura
```
infra/
├── CLAUDE.md
├── RECURSOS.md            # inventario vivo de lo creado en la nube (actualizar en cada tarea)
├── env/
│   └── staging.env        # IDs y nombres NO secretos (proyecto, región, servicios)
├── artifact-registry/
│   └── cleanup-policies.json  # políticas de limpieza del repositorio de imágenes (las aplica 10_gcp_project.sh)
└── scripts/
    ├── lib.sh             # funciones comunes (log, confirmación, dry-run, estados, probe/retry, enmascarado, step/write)
    ├── lib_sql.sh         # funciones comunes de Cloud SQL (existencia, describe, estado de energía, esperas)
    ├── 10_gcp_project.sh  # numerados en el orden en que se ejecutan
    ├── 20_cloud_sql.sh    # instancia, BD, usuario, secreto de la contraseña e IAM sobre el secreto
    ├── 30_workload_identity.sh  # WIF GitHub→GCP: pool, provider OIDC, cuenta deployer, roles y variables de repo
    ├── 40_cloud_run.sh    # Cloud Run: servicio del backend + job de migraciones (crea si falta, compara si existe) y presupuesto de conexiones
    ├── sql_power.sh       # start | stop | status de la instancia de Cloud SQL (herramienta operativa, sin número)
    ├── sql_check.sh       # prueba de conexión por el proxy + max_connections (solo la corre el humano)
    ├── cloud_run_image.sh # construye la imagen del backend y la sube a Artifact Registry (la sube el humano)
    ├── cloud_run_check.sh # criterios de KAN-13: /health 200, /docs 404 y (RUN_JOB=1) el job de migraciones con código 0
    └── ...
backend/Dockerfile         # imagen del backend (dos etapas, no root); backend/.dockerignore excluye secretos y artefactos locales
docker-compose.yml         # en la raíz del repo (entorno local)
infra/firebase-emulator/   # Dockerfile + firebase.json del emulador de Auth (imagen propia)
infra/postgres/init/       # SQL que corre con el volumen vacío (crea finance_test)
.github/workflows/         # ci.yml (PR), wif-smoke.yml (prueba de humo de WIF) y cd-staging.yml (merge a main, KAN-16)
infra/gitleaks/            # .gitleaksignore (falsos positivos) y VERSION (imagen de gitleaks fijada)
```

## Convenciones de scripts
- Bash con `set -euo pipefail` al inicio. Cargan `infra/env/staging.env` y `infra/scripts/lib.sh`.
- **Idempotentes:** verifican antes de crear (`describe … || create …`). Correrlos dos veces no rompe nada.
- **`--project` y `--region` explícitos** en cada comando `gcloud`, tomados de `staging.env`. Nunca dependas de `gcloud config`.
- **Dry-run:** con `DRY_RUN=1` el script imprime los comandos de escritura sin ejecutarlos (las lecturas sí se hacen). Úsalo para mostrar al humano qué va a pasar.
- **Hook `guard_cloud` y los scripts:** también revisa los comentarios. En una línea que nombre `gcloud` o `firebase` no uses las palabras en inglés `delete`, `remove`, `rm`, `destroy`, `prod` ni `production`, o el script se bloquea.
- Un script por tarea INF; comentarios en español que expliquen el *por qué* de cada recurso.
- Al terminar, actualiza **`infra/RECURSOS.md`**: recurso, tipo, proyecto, región, tarea que lo creó y costo aproximado.

## Nombres de recursos
- Sufijo de entorno: **`-stg`** (ej. `finance-api-stg`, `finance-db-stg`, `finance-migrate-stg`).
- Cuentas de servicio con nombre de función: `run-api-stg@…`, `github-deployer-stg@…`.
- El ID del proyecto lo define KAN-9 y queda en `infra/env/staging.env` como **`GCP_PROJECT_ID`** (y `FIREBASE_PROJECT_ID` si difiere). El hook `guard_cloud` lo lee: todo `gcloud`/`firebase` sin `--project` o con otro proyecto se bloquea; mientras el archivo no exista, pregunta.

## Decisiones fijas
- **Costos mínimos:** Cloud SQL en la instancia más pequeña, apagable cuando no se usa (`--activation-policy=NEVER`); Cloud Run con mínimo 0 instancias; **alerta de presupuesto** en el proyecto de staging.
- **Cloud SQL:** IP pública + Cloud SQL Python Connector (sin VPC en el Hito 0). Contraseña en **Secret Manager**. Pool de 2–5 conexiones por instancia de Cloud Run (el valor por defecto de la app); en staging se reduce a 2+1 (ver Cloud Run KAN-13).
- **Cloud SQL (KAN-10):** `finance-db-stg` (nombre de conexión `kanza-stg:southamerica-east1:finance-db-stg`), BD `finance`, usuario `finance_app`, secreto `finance-db-password-stg`. Sin redes autorizadas y con `sslMode=TRUSTED_CLIENT_CERTIFICATE_REQUIRED`: solo entra el conector o el proxy (un `psql` directo falla por diseño; en local, `cloud-sql-proxy --port 5433 <nombre de conexión>`). Está **apagada** por defecto: enciéndela con `sql_power.sh start` (tarda varios minutos) y apágala al terminar con `sql_power.sh stop`; sin encender, el backend y las migraciones de staging no tienen BD. `max_connections` vale 25: el pool de Cloud Run debe quedar muy por debajo (ver `RECURSOS.md`). `20_cloud_sql.sh` solo **compara** una instancia existente, nunca la modifica ni cambia la contraseña de un usuario que ya existe; BD y usuario solo se pueden verificar con la instancia encendida.
- **Migraciones:** Cloud Run Job separado, ejecutado antes de desplegar la nueva revisión. Nunca al arrancar la app.
- **Cloud Run:** público en el Hito 0, sin header secreto. Cuenta de servicio propia con permisos mínimos (Cloud SQL Client y acceso a sus secretos).
- **Cloud Run (KAN-13):** servicio `finance-api-stg` y job `finance-migrate-stg`, los dos con la **misma imagen** (`southamerica-east1-docker.pkg.dev/kanza-stg/finance-stg/finance-api:<sha>`, nunca `latest`) y la **misma cuenta** `run-api-stg`. Servicio público, de 0 a 2 instancias, 1 CPU y 512 MiB, sin "conexiones de Cloud SQL" (el Connector de Python entra por IP pública). Variables: `ENV=staging`, `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS`, `INSTANCE_CONNECTION_NAME`, `DB_USER`, `DB_NAME`, `GOOGLE_CLOUD_PROJECT` y, en el servicio, `DB_POOL_SIZE=2` y `DB_MAX_OVERFLOW=1`; `DB_PASSWORD` desde el secreto `finance-db-password-stg:latest`. **Nunca** `DATABASE_URL` (anula el Connector) ni `FIREBASE_AUTH_EMULATOR_HOST` (la app no arranca). `ALLOWED_ORIGINS` la exige la app en staging y el job también (alembic construye los mismos `Settings`): vale `https://staging.invalid` (no resuelve, nadie inicia sesión) hasta que KAN-14 cree el proyecto de Vercel; entonces se cambia en el servicio y en `staging.env`. Job: `alembic upgrade head`, 1 tarea, **0 reintentos**, 600 s. Presupuesto de conexiones (criterio 3): 25 − 3 reservadas − 3 internas (medidas el 16/10/2026: 2; se cuentan 3 como colchón) − 1 del job − 2 manuales = 16; peor caso del servicio 2 revisiones × 2 instancias × 3 = 12 (`40_cloud_run.sh`, paso 5, lo comprueba). Arranque: `uvicorn` con `--log-config` (JSON desde la primera línea) y `--timeout-graceful-shutdown 10`. El servicio y el job los crea el humano en la Consola y `40_cloud_run.sh` crea lo que falte y solo **compara** lo que existe (nunca lo modifica). **Rutas reservadas: en Cloud Run no se usan rutas que terminen en `z`.** Google reserva algunas (y recomienda evitarlas todas): `GET /healthz` en la URL de Cloud Run devuelve el 404 HTML de Google y nunca llega a la app. El chequeo de salud en staging es **`GET /health`** (criterio 1 de KAN-13); la app conserva `/healthz` solo para uso local, y `cloud_run_check.sh` lo informa pero nunca lo usa como criterio. **Imagen: etiqueta o digest.** La Consola de Cloud Run guarda la imagen por **digest** (`.../finance-api@sha256:...`) aunque se elija una etiqueta, y `gcloud run deploy --image` con etiqueta la deja por etiqueta; `40_cloud_run.sh` acepta las dos (compara siempre la ruta y, con `IMAGE_TAG`, la etiqueta o el digest de esa etiqueta resuelto en Artifact Registry). **Lo que deja la Consola:** el escalado va a nivel de servicio (`run.googleapis.com/minScale` y `maxScale`) y el acceso público es la verificación de IAM del invocador desactivada (`run.googleapis.com/invoker-iam-disabled=true`) en vez de `allUsers`; el script acepta las dos formas de acceso, lee primero el escalado del servicio y marca [FALLO] si el mínimo no es 0 (una instancia siempre encendida se factura sin tráfico): **al crear o editar el servicio en la Consola, revisa siempre el escalado** (al crearlo quedó en `minScale=1` y hubo que corregirlo a 0). **Para KAN-16:** el CD solo debe cambiar `--image` (un `gcloud run deploy --image` conserva el resto) y no pasar `--allow-unauthenticated` ni flags de escalado, porque `run.developer` no puede tocar IAM; la configuración se cambia en la Consola o en este script a propósito. La imagen se construye con `--provenance=false --sbom=false` (manifiesto simple, no lista de manifiestos). **Estado verificado el 16/10/2026:** imagen vigente `finance-api:cb284fd61d63` (digest `sha256:2d1aaefb...`) en el servicio y en el job; servicio con mínimo 0 y máximo 2; job sin reintentos; los 4 criterios de KAN-13 cumplidos (evidencia en `RECURSOS.md`); Cloud SQL apagada al cierre.
- **Cuentas de servicio (KAN-9):** `run-api-stg` tiene solo `roles/cloudsql.client` a nivel de proyecto; `secretmanager.secretAccessor` se da **sobre cada secreto** (KAN-10), no a nivel de proyecto. Ninguna cuenta de servicio tiene Editor/Owner, salvo el Google APIs Service Agent (`<número>@cloudservices.gserviceaccount.com`), que administra Google; `10_gcp_project.sh` lo verifica y solo acepta esa excepción por patrón exacto.
- **Facturación (KAN-9):** el ID de la cuenta de facturación **nunca va en el repo**: el script lo lee del proyecto vinculado o de `BILLING_ACCOUNT_ID` y lo muestra como `<oculto>`. Presupuesto `kanza-stg-budget`: USD 20/mes, solo alertas; un presupuesto existente que difiere solo se avisa, nunca se modifica solo.
- **GitHub → GCP:** solo Workload Identity Federation, restringido a este repositorio. **Nunca llaves JSON.**
- **WIF (KAN-12):** pool `github-pool-stg`, provider OIDC `github-oidc-stg`, cuenta `github-deployer-stg`. La condición del provider usa IDs numéricos, no `sub` (el repo tiene el sujeto OIDC inmutable): `assertion.repository_id == '1403495096' && assertion.repository_owner_id == '76397954' && assertion.ref == 'refs/heads/main' && assertion.event_name in ['push', 'workflow_dispatch']`. Solo `main` y solo esos dos eventos pueden autenticarse: un PR, una rama distinta, un fork o cualquier otro evento (`pull_request_target`, `issue_comment`, `workflow_run`, `schedule`...) son rechazados. **Para el CD (KAN-16):** debe dispararse con `push` a `main` (o `workflow_dispatch`); un `workflow_run` tras el CI sería rechazado salvo que se amplíe la lista en el script y en el provider. Roles del deployer: `run.admin` (proyecto; sugerencia de bajar a `run.developer` en KAN-13/16), `artifactregistry.writer` solo sobre `finance-stg` y `iam.serviceAccountUser` solo sobre `run-api-stg`; `workloadIdentityUser` sobre el deployer solo para el principalSet por `repository_id`. Los workflows leen las variables de repo `GCP_WIF_PROVIDER` y `GCP_DEPLOYER_SA` (no son secretos) y usan `google-github-actions/auth` con `permissions: id-token: write`. `30_workload_identity.sh` corrige el provider si difiere, pero nunca quita permisos de más ni habilita una cuenta deshabilitada (avisa con `[FALLO]`: deshabilitar `github-deployer-stg` es la palanca de respuesta ante incidentes y no se anula desde un script). `wif-smoke.yml` comprueba las dos direcciones y se queda como smoke permanente: en `main` usa la action `auth` (que canjea en STS ella misma y falla si la condición rechaza); fuera de `main` no usa la action, sino un `curl` directo a STS que debe devolver `unauthorized_client` con "attribute condition" (cualquier otra cosa es rojo, nunca verde).
- **CI (PR, KAN-15):** `.github/workflows/ci.yml` con cuatro jobs, cuyos `name:` son los checks requeridos: **`backend`** (ruff check + format, mypy, `alembic upgrade head` sobre BD vacía, pytest con PostgreSQL 16 y el emulador de Firebase Auth), **`frontend`** (eslint, tsc, prettier, vitest, `next build` con variables de relleno no secretas), **`api-types`** (regenera `openapi.json` y `schema.d.ts` y falla si hay diff) y **`secrets`** (gitleaks sobre los commits del PR).
- **CD (merge a `main`):** build de imagen → Artifact Registry → job de migraciones → deploy a Cloud Run staging. Prod será promoción manual de la **misma imagen**.
- **Vercel:** las previews solo verifican build; en staging, `BACKEND_URL` apunta a Cloud Run y el rewrite `/api/*` de `next.config.ts` la usa.
- **IaC:** scripts `gcloud` en el Hito 0; migrar a Terraform antes de prod.

## Local (Docker Compose)
| Servicio | Puerto |
|---|---|
| PostgreSQL | 5432 |
| Emulador Firebase Auth | 9099 (UI del emulador en 4000) |
| Backend (fuera de compose, con `uv run`) | 8000 |
| Frontend (fuera de compose, con `npm run dev`) | 3000 |

Las variables de los servicios locales van documentadas en `.env.example` (raíz, `backend/` y `frontend/`), nunca con valores reales de staging.

## GitHub
- Protección de `main` (KAN-7): PR obligatorio + CI en verde, sin force push. **Verificar primero** si el plan de GitHub lo permite (repos privados en plan Free no tienen protección de ramas); si no, es una decisión del humano.
- Decisión KAN-7: el repo es **público** (los rulesets no existen en privado/Free). `main` se protege con el ruleset `protect-main` (`infra/scripts/05_github_main_protection.sh`): PR obligatorio, sin force push ni borrado, sin bypass (aplica también al admin). Antes de publicar se corre `infra/scripts/04_scan_history.sh`.
- Excepciones de gitleaks (falsos positivos confirmados) viven en `infra/gitleaks/.gitleaksignore`; el script 04 y el job `secrets` del CI las pasan con `--gitleaks-ignore-path`. La versión de la imagen (`zricethezav/gitleaks`) está fijada en `infra/gitleaks/VERSION` y la leen ambos; para subirla, cambia solo ese archivo.
- Checks requeridos (KAN-15): `backend`, `frontend`, `api-types` y `secrets`, exactamente el `name:` de cada job de `ci.yml` (si renombras un job, renombra el check aquí, o se bloquean todos los merges: el ruleset no tiene bypass). Se aplican **después** de que los checks hayan corrido al menos una vez en un PR (paso del humano). `REQUIRED_CHECKS` vale por defecto esos cuatro nombres, así que volver a correr el script no los quita; `REQUIRED_CHECKS=""` (explícita y vacía) significa "sin checks". Con checks, el script **exige** `CHECKS_REF=<sha o rama donde el CI ya corrió>` y comprueba que cada check exista ahí; `SKIP_CHECKS_VERIFY=1` salta esa verificación a propósito (con aviso). Sin ninguno de los dos, se detiene sin cambiar nada. Si el ruleset actual exige checks que el payload nuevo no incluye, avisa y pide una confirmación aparte. Uso: `DRY_RUN=1 CHECKS_REF=<sha-del-PR> bash infra/scripts/05_github_main_protection.sh` y luego sin `DRY_RUN`. El script recorta espacios en los nombres. Sin filtro `paths:` en el workflow: un check requerido que no se dispara deja el PR sin poder mergear.
- El job `backend` levanta PostgreSQL como service (`postgres:16.15-alpine`, misma versión que el compose) y crea `finance_test` con `psql` (un service no monta `infra/postgres/init`). El emulador se construye con buildx (caché `gha`) desde `infra/firebase-emulator/` y se arranca con `docker compose up -d --no-build --wait firebase-emulator`. Un service de Actions no puede construir imágenes.
- Workflows con `permissions:` explícitos y actions fijadas a una versión.