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
└── scripts/
    ├── lib.sh             # funciones comunes (log, confirmación, dry-run)
    ├── 10_gcp_project.sh  # numerados en el orden en que se ejecutan
    ├── 20_cloud_sql.sh
    └── ...
docker-compose.yml         # en la raíz del repo (entorno local)
infra/firebase-emulator/   # Dockerfile + firebase.json del emulador de Auth (imagen propia)
infra/postgres/init/       # SQL que corre con el volumen vacío (crea finance_test)
.github/workflows/         # ci.yml (PR) y cd-staging.yml (merge a main)
```

## Convenciones de scripts
- Bash con `set -euo pipefail` al inicio. Cargan `infra/env/staging.env` y `infra/scripts/lib.sh`.
- **Idempotentes:** verifican antes de crear (`describe … || create …`). Correrlos dos veces no rompe nada.
- **`--project` y `--region` explícitos** en cada comando `gcloud`, tomados de `staging.env`. Nunca dependas de `gcloud config`.
- **Dry-run:** con `DRY_RUN=1` el script imprime los comandos sin ejecutarlos. Úsalo para mostrar al humano qué va a pasar.
- Un script por tarea INF; comentarios en español que expliquen el *por qué* de cada recurso.
- Al terminar, actualiza **`infra/RECURSOS.md`**: recurso, tipo, proyecto, región, tarea que lo creó y costo aproximado.

## Nombres de recursos
- Sufijo de entorno: **`-stg`** (ej. `finance-api-stg`, `finance-db-stg`, `finance-migrate-stg`).
- Cuentas de servicio con nombre de función: `run-api-stg@…`, `github-deployer-stg@…`.
- El ID del proyecto lo define KAN-9 y queda en `infra/env/staging.env` como **`GCP_PROJECT_ID`** (y `FIREBASE_PROJECT_ID` si difiere). El hook `guard_cloud` lo lee: todo `gcloud`/`firebase` sin `--project` o con otro proyecto se bloquea; mientras el archivo no exista, pregunta.

## Decisiones fijas
- **Costos mínimos:** Cloud SQL en la instancia más pequeña, apagable cuando no se usa (`--activation-policy=NEVER`); Cloud Run con mínimo 0 instancias; **alerta de presupuesto** en el proyecto de staging.
- **Cloud SQL:** IP pública + Cloud SQL Python Connector (sin VPC en el Hito 0). Contraseña en **Secret Manager**. Pool de 2–5 conexiones por instancia de Cloud Run.
- **Migraciones:** Cloud Run Job separado, ejecutado antes de desplegar la nueva revisión. Nunca al arrancar la app.
- **Cloud Run:** público en el Hito 0, sin header secreto. Cuenta de servicio propia con permisos mínimos (Cloud SQL Client y acceso a sus secretos).
- **GitHub → GCP:** solo Workload Identity Federation, restringido a este repositorio. **Nunca llaves JSON.**
- **CI (PR):** ruff + mypy · eslint + tsc · tests backend con PostgreSQL · `alembic upgrade` sobre BD vacía · tipos TS regenerados sin diferencias · build del frontend.
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
- Excepciones de gitleaks (falsos positivos confirmados) viven en `infra/gitleaks/.gitleaksignore`; el script 04 las pasa con `--gitleaks-ignore-path`. **KAN-15** debe usar el mismo flag y archivo en el CI.
- Checks requeridos: el ruleset nace **sin** checks porque aún no hay CI. **KAN-15** debe poner los nombres de sus jobs en `REQUIRED_CHECKS` (ej. `REQUIRED_CHECKS=backend,frontend`) y volver a correr el script 05.
- Workflows con `permissions:` explícitos y actions fijadas a una versión.