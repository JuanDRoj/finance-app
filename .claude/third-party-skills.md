# Skills de terceros

Copias fijadas a un commit del repositorio de origen y revisadas antes de entrar. No se actualizan solas: para subir de versión, vuelve a revisar el contenido completo y cambia el commit aquí en el mismo PR.

| Skill (`.claude/skills/`) | Origen | Commit / versión | Licencia | Quién la usa |
|---|---|---|---|---|
| `mobile-native` | [emilkowalski/skills](https://github.com/emilkowalski/skills) `skills/mobile-native` | `e8a175de22ae1e49370fc144c1f3bb9aeedf988d` | MIT | frontend-dev (precargada), reviewer |
| `ask-sonner` | [emilkowalski/skills](https://github.com/emilkowalski/skills) `skills/ask-sonner` | `e8a175de22ae1e49370fc144c1f3bb9aeedf988d` | MIT | frontend-dev (bajo demanda) |
| `break-ui` | [emilkowalski/skills](https://github.com/emilkowalski/skills) `skills/break-ui` | `e8a175de22ae1e49370fc144c1f3bb9aeedf988d` | MIT | frontend-dev (bajo demanda), reviewer |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/react-best-practices` | `063bee94c3f4df8453406c830b0a7df0f2860278` | MIT | frontend-dev (precargada), reviewer |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) `skills/frontend-design` | `683bc88e56f3e09ba94f7055977f3d3aa499f202` | Apache-2.0 | sesión principal (dirección visual y pantallas nuevas) |
| `fastapi` | paquete `fastapi` `fastapi/.agents/skills/fastapi` | FastAPI `0.142.2` | MIT | backend-dev (precargada) |

Reglas:
- Las convenciones del proyecto (`CLAUDE.md` de cada carpeta y `frontend/docs/diseno.md`) ganan sobre cualquier skill.
- Ninguna de estas skills declara `allowed-tools` ni ejecuta scripts.
- Skills evaluadas y descartadas (2026-10-05): Impeccable, Taste Skill, `find-skills`, `pick-ui-library`. Diferidas: `improve-codebase-architecture` (Matt Pocock), `emil-design-eng`, `animate-expo`.
