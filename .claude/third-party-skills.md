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
- Excepción: `logo-design` (ver abajo) ejecuta scripts y vive fuera del repo.
- Skills evaluadas y descartadas (2026-10-05): Impeccable, Taste Skill, `find-skills`, `pick-ui-library`. Diferidas: `improve-codebase-architecture` (Matt Pocock), `emil-design-eng`, `animate-expo`.

## Skills a nivel de usuario (fuera del repo)

| Skill (`~/.claude/skills/`) | Origen | Commit / versión | Licencia | Quién la usa |
|---|---|---|---|---|
| `logo-design` | [kaankiziltug/logo-design-skill](https://github.com/kaankiziltug/logo-design-skill) `skills/logo-design` | `0ecf52e9a4b3ac92b714f7cc6e3148ab8c774134` | MIT (código); los SVG de `assets/library/svg/` son marcas de sus dueños | sesión principal (logo de Kanza) |

Aprobada por Juan David el 2026-10-06 con estas condiciones:
- No se copia al repo: incluye unos 1.400 logos de marcas reales que no tienen licencia MIT. Solo entran al repo los SVG finales del logo de Kanza.
- Ejecuta scripts en Python (`scripts/`). Se revisaron en ese commit: solo usan la biblioteca estándar, no se conectan a la red y solo invocan renderizadores locales (`rsvg-convert`, Inkscape, Chrome) para pasar SVG a PNG. No declara `allowed-tools`.
- Para subir de versión: revisar de nuevo `SKILL.md` y `scripts/` completos y cambiar el commit aquí.
