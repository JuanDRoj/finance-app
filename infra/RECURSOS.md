# Recursos de infraestructura

Inventario vivo de lo creado. Actualizar en cada tarea INF.

| Recurso | Tipo | Proyecto / ámbito | Región | Tarea | Costo aprox. |
|---|---|---|---|---|---|
| Ruleset `protect-main` (PR obligatorio, sin force push, sin borrado, sin bypass) | GitHub ruleset | `JuanDRoj/finance-app` (público) | n/a | KAN-7 | gratis |
| Checks requeridos del ruleset `protect-main`: `backend`, `frontend`, `api-types`, `secrets` **pendiente de aplicar** (paso del humano tras la primera ejecución del CI, con `infra/scripts/05_github_main_protection.sh`; hoy el ruleset no exige checks) | GitHub ruleset (regla `required_status_checks`) | `JuanDRoj/finance-app` | n/a | KAN-15 | gratis |
| Workflow `CI` (`.github/workflows/ci.yml`): 4 jobs en `pull_request` a `main`; cachés de uv, npm y capas Docker (`gha`) | GitHub Actions | `JuanDRoj/finance-app` (público: minutos gratis) | n/a | KAN-15 | gratis |
| Compose local: `finance-postgres` (postgres:16.15-alpine, volumen `finance_pgdata`) y `finance-firebase-emulator` (imagen propia) | Docker Compose | local (sin nube) | n/a | KAN-8 | gratis |
| Proyecto `kanza-stg` (cuenta personal, sin organización; etiqueta `env=staging` **pendiente**, se pone en la consola). Creado a mano el 14-15/10/2026; `infra/scripts/10_gcp_project.sh` lo refleja y sirve para recrearlo | Proyecto GCP | `kanza-stg` | global | KAN-9 | gratis |
| Vínculo del proyecto a la cuenta de facturación (cuenta completa con crédito). El ID de la cuenta no se guarda en el repo | Facturación | `kanza-stg` | n/a | KAN-9 | gratis |
| APIs habilitadas: `run`, `sqladmin`, `artifactregistry`, `secretmanager`, `iamcredentials`, `sts` y `cloudresourcemanager`; `iam` y `billingbudgets` **pendientes** (las habilita el script: `iam` la necesita un proyecto nuevo para crear cuentas de servicio y `billingbudgets` es la que usa `gcloud billing budgets`) | Service Usage | `kanza-stg` | n/a | KAN-9 | gratis (cada recurso cobra aparte) |
| Repositorio `finance-stg` (Docker, estándar, sin etiquetas inmutables, clave de Google, escaneo desactivado). Limpieza en modo eliminar: `delete-old` (anterior a 30 días) y `keep-recent` (conserva las 10 versiones más recientes), en `infra/artifact-registry/cleanup-policies.json`. Ruta: `southamerica-east1-docker.pkg.dev/kanza-stg/finance-stg` | Artifact Registry | `kanza-stg` | southamerica-east1 | KAN-9 | ~USD 0.10/GB-mes sobre 0.5 GB gratis; centavos a esta escala |
| Cuenta de servicio `run-api-stg` (identidad de Cloud Run; sin llaves). Rol de proyecto: solo `roles/cloudsql.client`. `secretAccessor` se da **sobre el secreto** en KAN-10, no a nivel de proyecto (más estricto que el texto del ticket) | Cuenta de servicio + IAM | `kanza-stg` | n/a | KAN-9 | gratis |
| `roles/editor` quitado a la cuenta de servicio predeterminada de Compute (la cuenta se conserva) | Cambio de IAM | `kanza-stg` | n/a | KAN-9 | gratis |
| Presupuesto `kanza-stg-budget`: USD 20/mes, solo alertas al 50/90/100 % del gasto real, solo este proyecto, todos los servicios, correo a los administradores de facturación; los créditos promocionales no se descuentan | Presupuesto de Cloud Billing | cuenta de facturación (alcance `kanza-stg`) | n/a | KAN-9 | gratis |
