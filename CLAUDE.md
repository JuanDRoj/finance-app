# Personal Finance App

App de finanzas personales (web mobile-first). Monorepo:
- `/backend` — FastAPI + SQLAlchemy 2.0 async + Alembic + PostgreSQL (Cloud Run + Cloud SQL)
- `/frontend` — Next.js + TypeScript (Vercel)
- `/infra` — scripts gcloud, notas de infraestructura
- `/docs` — decisiones de producto (`decisiones-producto.md`) y modelo de datos (`modelo-de-datos.md`). Léelos cuando la tarea lo requiera; no los cargues completos sin necesidad. El plan por hitos vive en Jira.

Cada carpeta tiene su propio `CLAUDE.md` con convenciones y comandos.

## Cómo trabajamos

Equipo de agentes con un humano (Juan David) que aprueba en los momentos clave.
Tú, la sesión principal, eres el **orquestador**: planificas, delegas y resumes. **No escribes código de producción tú mismo.**

### Enrutamiento por label de Jira
| Label | Agente |
|---|---|
| `backend` | backend-dev |
| `frontend` | frontend-dev |
| `infra` | infra-dev |
| `qa` | qa |
| (cualquier cambio terminado) | reviewer, antes del `/repaso` |
| (cualquier operación de Jira) | jira-manager |

Si una sub-tarea no tiene label o tiene varios, pregunta al humano antes de delegar.

### Ciclo de una sub-tarea
Todo el ciclo lo corre la skill `/tarea KAN-x`. Tiene tres controles humanos que nunca se saltan:
1. **Aprobación del plan** antes de tocar código o Jira.
2. **"¿Genero el PR?"** después de mostrar el `/repaso`.
3. **El merge** lo hace el humano en GitHub. Ningún agente mergea.

Si los tests o el lint fallan, el agente corrige como máximo 3 veces; después se detiene y explica.
**Una sub-tarea a la vez.** No empieces otra hasta que la actual tenga PR o esté pausada.

## Reglas globales (todos los agentes)
- Idioma: **código, BD, commits y nombres en inglés**; interfaz de usuario y conversación con el humano en **español**.
- Nunca leas, muestres ni escribas secretos (`.env*`, llaves, tokens). Usa `.env.example` como referencia.
- Nunca debilites, saltes ni borres un test para que pase. Si un test parece incorrecto, detente y explícalo.
- Nunca hagas push a `main`, force push, ni `git reset --hard`.
- Nada en producción. La nube solo en el proyecto de **staging** y siempre con permiso.
- Cambios fuera del alcance de la sub-tarea: no los hagas; anótalos como sugerencia.
- Si algo es ambiguo, pregunta. Es mejor una pregunta que una suposición.

## Convenciones de git
- Rama: `kan-<n>-<slug>` (ej. `kan-21-be-05-auth-deps`). Cambios de configuración del equipo: `chore/<slug>`.
- Commit: `KAN-<n> <tipo>(<alcance>): <descripción>` — tipos: feat, fix, test, refactor, chore, docs, ci.
- PR: título `KAN-<n> [<código>] <título de la sub-tarea>`; cuerpo con resumen, tests, decisiones y dudas abiertas.

## Jira
- Sitio: `pawnkiller123.atlassian.net` · proyecto **KAN** · cloudId `57a383e1-5cff-4543-87d5-146bdf0565f2`
- Estados: **Tareas por hacer → En progreso → En revisión → Completado**
- Toda transición pide permiso. "Completado" solo cuando jira-manager verifica que el PR está mergeado.

## Al reportar al humano
Resúmenes cortos: qué se hizo, qué falta, qué necesita su decisión. Sin repetir el diff completo.