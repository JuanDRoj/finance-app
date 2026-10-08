# Personal Finance App

App de finanzas personales: web responsive (se diseña desde el celular y se amplía hasta escritorio); la app móvil nativa llega después. Monorepo:
- `/backend` — FastAPI + SQLAlchemy 2.0 async + Alembic + PostgreSQL (Cloud Run + Cloud SQL)
- `/frontend` — Next.js + TypeScript (Vercel)
- `/infra` — scripts gcloud, notas de infraestructura
- `/docs` — decisiones de producto (`decisiones-producto.md`), modelo de datos (`modelo-de-datos.md`) y patrones del backend (`arquitectura-backend.md`). Léelos cuando la tarea lo requiera; no los cargues completos sin necesidad. El plan por hitos vive en Jira.

Cada carpeta tiene su propio `CLAUDE.md` con convenciones y comandos.

## Equipo
Un humano (Juan David) aprueba en los momentos clave. El trabajo lo hace un equipo de agentes que coordina la sesión principal con la skill `/tarea KAN-x`.
Cada subagente recibe su rol en su propio prompt: si eres un subagente, sigue ese prompt y las reglas globales de abajo.

## Reglas globales (todos)
- Idioma: **código, BD, commits y nombres en inglés**; interfaz de usuario y conversación con el humano en **español**.
- Nunca leas, muestres ni escribas secretos (`.env*`, llaves, tokens). Usa `.env.example` como referencia.
- Nunca debilites, saltes ni borres un test para que pase. Si un test parece incorrecto, detente y explícalo.
- Si los tests o el lint fallan, corrige como máximo 3 veces; después detente y explica.
- Nunca hagas push a `main`, force push, ni `git reset --hard`.
- Nada en producción. La nube solo en el proyecto de **staging** y siempre con permiso.
- Cambios fuera del alcance de la sub-tarea: no los hagas; anótalos como sugerencia.
- Si un hook bloquea una acción, no busques otra forma de hacer lo mismo: repórtalo.
- Si algo es ambiguo, pregunta. Es mejor una pregunta que una suposición.

## Convenciones de git
- Rama: `kan-<n>-<slug>` (ej. `kan-21-be-05-auth-deps`). Cambios de configuración del equipo: `chore/<slug>`.
- Commit: `KAN-<n> <tipo>(<alcance>): <descripción>` — tipos: feat, fix, test, refactor, chore, docs, ci. En ramas `chore/`: `<tipo>(<alcance>): <descripción>`, sin clave.
- PR: título `KAN-<n> [<código>] <título de la sub-tarea>`; el cuerpo lo arma `/tarea`.
- Ramas, commits y PRs los hace la sesión principal; los subagentes solo usan git de lectura.

## Jira
- Proyecto **KAN** en `pawnkiller123.atlassian.net`. Toda operación de Jira la hace `jira-manager`.
- Estados: **Tareas por hacer → En progreso → En revisión → Completado**. Toda transición pide permiso.
- "Completado" solo con el PR verificado como `MERGED` en GitHub (`/cierre`) o, en tareas sin código, con la aprobación explícita del humano.

## Sesión principal (orquestador)
- Con `/tarea` coordinas el ciclo de una sub-tarea con tres controles humanos que nunca se saltan: **aprobación del plan**, **"¿Genero el PR?"** y **el merge**, que hace el humano en GitHub.
- Durante `/tarea` no escribes código de producción: lo delegas al agente del label (un hook lo impone). Fuera de `/tarea`, el humano puede pedirte cambios directos.
- **Una sub-tarea a la vez.** No empieces otra hasta que la actual tenga PR o esté pausada.
- Otras skills: `/repaso` (explica los cambios de la rama) y `/cierre` (cierra en Jira lo ya mergeado).
- Al reportar al humano: resúmenes cortos con qué se hizo, qué falta y qué necesita su decisión. Sin repetir el diff completo.
