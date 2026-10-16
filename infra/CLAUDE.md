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
    ├── sql_power.sh       # start | stop | status de la instancia de Cloud SQL (herramienta operativa, sin número)
    ├── sql_check.sh       # prueba de conexión por el proxy + max_connections (solo la corre el humano)
    └── ...
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
- **Cloud SQL:** IP pública + Cloud SQL Python Connector (sin VPC en el Hito 0). Contraseña en **Secret Manager**. Pool de 2–5 conexiones por instancia de Cloud Run.
- **Cloud SQL (KAN-10):** `finance-db-stg` (nombre de conexión `kanza-stg:southamerica-east1:finance-db-stg`), BD `finance`, usuario `finance_app`, secreto `finance-db-password-stg`. Sin redes autorizadas y con `sslMode=TRUSTED_CLIENT_CERTIFICATE_REQUIRED`: solo entra el conector o el proxy (un `psql` directo falla por diseño; en local, `cloud-sql-proxy --port 5433 <nombre de conexión>`). Está **apagada** por defecto: enciéndela con `sql_power.sh start` (tarda varios minutos) y apágala al terminar con `sql_power.sh stop`; sin encender, el backend y las migraciones de staging no tienen BD. `max_connections` vale 25: el pool de Cloud Run debe quedar muy por debajo (ver `RECURSOS.md`). `20_cloud_sql.sh` solo **compara** una instancia existente, nunca la modifica ni cambia la contraseña de un usuario que ya existe; BD y usuario solo se pueden verificar con la instancia encendida.
- **Migraciones:** Cloud Run Job separado, ejecutado antes de desplegar la nueva revisión. Nunca al arrancar la app.
- **Cloud Run:** público en el Hito 0, sin header secreto. Cuenta de servicio propia con permisos mínimos (Cloud SQL Client y acceso a sus secretos).
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