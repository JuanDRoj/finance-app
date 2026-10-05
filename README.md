# finance-app

App de finanzas personales (web mobile-first). Monorepo: `backend/` (FastAPI), `frontend/` (Next.js), `infra/` (scripts y notas), `docs/` (decisiones y modelo de datos).

## Levantar todo en local

> Estado: el entorno local se va completando por tareas. Cada paso indica qué tarea lo habilita; cuando esa tarea se cierre, reemplaza la nota por el comando real.

### Requisitos
- Docker con Compose v2 (`docker compose version`).
- Python con `uv` (versión exacta: la fija el backend).
- Node.js 24 con npm (fijado en `frontend/.nvmrc`; con nvm o fnm: `nvm use` dentro de `frontend/`).

### Puertos
| Servicio | Puerto |
|---|---|
| PostgreSQL | 5432 |
| Emulador Firebase Auth | 9099 (UI en 4000) |
| Backend | 8000 |
| Frontend | 3000 |

### Pasos
1. (Opcional) `cp .env.example .env` en la raíz para cambiar puertos o credenciales locales; el compose funciona sin él. Backend: `cp backend/.env.example backend/.env` es opcional (el backend funciona con los valores por defecto). Frontend: `cp frontend/.env.example frontend/.env.local` es **obligatorio** (sin él, `npm run dev` y `npm run build` fallan listando las variables que faltan).
2. PostgreSQL y emulador de Firebase Auth: `docker compose up -d` desde la raíz (la primera vez construye la imagen del emulador). Comprueba con `docker compose ps` que ambos estén `healthy`.
   - UI del emulador: <http://localhost:4000> · Auth en `localhost:9099`.
   - PostgreSQL 16 en `localhost:5432` (usuario `finance`, contraseña de desarrollo del `.env.example`). Crea la BD `finance` y `finance_test` (para los tests del backend).
   - `finance_test` solo se crea con el volumen vacío. Si ya existía el volumen: `docker compose exec postgres createdb -U finance finance_test`.
   - Los tests del backend migran `finance_test` una vez por corrida y la dejan migrada. Si cambias a una rama con migraciones más viejas, la suite se detiene pidiendo recrearla: `docker compose exec postgres dropdb -U finance finance_test && docker compose exec postgres createdb -U finance finance_test`.
   - Los datos de PostgreSQL persisten en el volumen `finance_pgdata`; `docker compose down` los conserva y `docker compose down -v` los borra. Los usuarios del emulador no persisten.
3. Backend en el puerto 8000: `cd backend && uv sync && uv run alembic upgrade head && uv run fastapi dev app/main.py` (Python 3.14; uv lo descarga si falta). `alembic upgrade head` aplica las migraciones a la BD `finance`; repítelo cada vez que llegue una migración nueva. Comprueba con `curl localhost:8000/healthz`.
4. Frontend en el puerto 3000: `cd frontend && npm ci && npm run dev` (requiere el `.env.local` del paso 1). Abre <http://localhost:3000>.

## Flujo de trabajo y `main` protegida

- `main` solo recibe cambios por Pull Request: no se admite push directo, force push ni borrado de la rama (tampoco para el administrador).
- Los checks de CI obligatorios se añaden con KAN-15; hasta entonces el ruleset no exige checks.
- La protección se aplica con `infra/scripts/05_github_main_protection.sh` (`DRY_RUN=1` para ver qué hará).
- El repositorio es público: nunca se suben secretos (`.env*`, llaves, credenciales). Usa los `.env.example` como referencia.

## Equipo de agentes (Claude Code)

El desarrollo lo hace un equipo de agentes de Claude Code coordinado con la skill `/tarea KAN-x`. La configuración vive en `.claude/` y en los `CLAUDE.md`.

### Requisitos para trabajar en una máquina nueva
- **Claude Code** reciente (probado con 2.1.289), iniciado **en la terminal** desde la raíz del repo. La extensión de VS Code no lee el `defaultMode` del proyecto.
- **Aceptar el diálogo de confianza** al abrir el repo. Sin eso, los hooks de los subagentes (`guard_scope`) no corren; el hook `check_trust` avisa al iniciar si falta.
- **python3** en el `PATH`: los hooks de `.claude/hooks/` lo usan.
- **Identidad de git**: `git config --global user.name` y `user.email`.
- **GitHub CLI** autenticado (`gh auth login`), para los PRs y `/cierre`.
- **SSH con `ssh-agent`**: Claude no puede escribir la passphrase de la llave, así que un `git push` sin agente falla.
- **Conector de Atlassian de claude.ai** conectado: las reglas de permisos asumen sus nombres (`mcp__claude_ai_Atlassian_MCP__*`).

### Skills
| Skill | Para qué |
|---|---|
| `/tarea KAN-x` | Ciclo completo de una sub-tarea, con tres controles humanos |
| `/repaso [base]` | Explica los cambios de la rama para revisarlos |
| `/cierre` | Pasa a Completado lo que GitHub confirma como mergeado |

### Hooks
Si cambias un hook, corre sus pruebas: `python3 .claude/hooks/tests/test_hooks.py`.
