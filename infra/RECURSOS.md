# Recursos de infraestructura

Inventario vivo de lo creado. Actualizar en cada tarea INF.

| Recurso | Tipo | Proyecto / ámbito | Región | Tarea | Costo aprox. |
|---|---|---|---|---|---|
| Ruleset `protect-main` (PR obligatorio, sin force push, sin borrado, sin bypass) | GitHub ruleset | `JuanDRoj/finance-app` (público) | n/a | KAN-7 | gratis |
| Checks requeridos del ruleset `protect-main`: `backend`, `frontend`, `api-types`, `secrets` (se aplican con `infra/scripts/05_github_main_protection.sh` tras la primera ejecución del CI) | GitHub ruleset (regla `required_status_checks`) | `JuanDRoj/finance-app` | n/a | KAN-15 | gratis |
| Workflow `CI` (`.github/workflows/ci.yml`): 4 jobs en `pull_request` a `main`; cachés de uv, npm y capas Docker (`gha`) | GitHub Actions | `JuanDRoj/finance-app` (público: minutos gratis) | n/a | KAN-15 | gratis |
| Compose local: `finance-postgres` (postgres:16.15-alpine, volumen `finance_pgdata`) y `finance-firebase-emulator` (imagen propia) | Docker Compose | local (sin nube) | n/a | KAN-8 | gratis |
