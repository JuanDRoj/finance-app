# finance-app

App de finanzas personales (web mobile-first). Monorepo: `backend/` (FastAPI), `frontend/` (Next.js), `infra/` (scripts y notas), `docs/` (decisiones y modelo de datos).

## Levantar todo en local

> Estado: el entorno local se va completando por tareas. Cada paso indica qué tarea lo habilita; cuando esa tarea se cierre, reemplaza la nota por el comando real.

### Requisitos
- Docker con Compose v2 (`docker compose version`).
- Python con `uv` (versión exacta: la fija el backend).
- Node.js LTS con npm (versión exacta: la fija el frontend).

### Puertos
| Servicio | Puerto |
|---|---|
| PostgreSQL | 5432 |
| Emulador Firebase Auth | 9099 (UI en 4000) |
| Backend | 8000 |
| Frontend | 3000 |

### Pasos
1. Copiar los `.env.example` (raíz, `backend/`, `frontend/`) a `.env` y ajustar. Pendiente: los archivos los crean KAN-8 y las tareas de backend y frontend.
2. PostgreSQL y emulador de Firebase Auth con `docker compose up -d`. Pendiente: `docker-compose.yml` llega con KAN-8.
3. Backend en el puerto 8000 con `uv run`. Pendiente: comando exacto con las tareas de backend.
4. Frontend en el puerto 3000 con `npm run dev`. Pendiente: disponible con las tareas de frontend.

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
