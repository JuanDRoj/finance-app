# Backend — FastAPI

Python **3.14** · FastAPI · SQLAlchemy 2.0 async (asyncpg) · Alembic (async) · PostgreSQL · pytest · uv · ruff · mypy.
Despliegue: Cloud Run (`southamerica-east1`) + Cloud SQL vía Cloud SQL Python Connector.

> **Nota:** los comandos de abajo son la convención acordada. Los fija **KAN-17 [BE-01]**: si esa tarea (o una posterior) los cambia, **actualiza este archivo en la misma tarea**.

## Comandos (siempre desde `/backend`)
| Para | Comando |
|---|---|
| Instalar dependencias | `uv sync` (usa `uv add <paquete>` solo si el plan aprobado lo incluye) |
| Levantar la API en local | `uv run fastapi dev app/main.py` |
| Tests (todos) | `uv run pytest` |
| Tests de un archivo | `uv run pytest tests/api/test_spaces.py -q` |
| Lint | `uv run ruff check .` |
| Formato (verificar) | `uv run ruff format --check .` |
| Tipos | `uv run mypy .` |
| Nueva migración | `uv run alembic revision --autogenerate -m "<descripción>"` |
| Aplicar migraciones | `uv run alembic upgrade head` |
| Exportar OpenAPI | `uv run python -m app.export_openapi` → `backend/openapi.json` (opcional `-o <ruta>`; no levanta el servidor ni necesita BD) |
| Regenerar tipos TS (si cambió la API) | `cd ../frontend && npm run gen:api` → `frontend/src/lib/api/schema.d.ts` (el CI falla si difieren) |

La BD local y el emulador de Firebase Auth se levantan con `docker compose up -d` desde la raíz del repo.

## Estructura
```
backend/
├── app/
│   ├── main.py                 # crea la app, registra routers y middlewares
│   ├── export_openapi.py       # CLI: escribe openapi.json sin levantar el servidor
│   ├── core/                   # config (pydantic-settings), db, seguridad, logging
│   └── modules/
│       └── <módulo>/           # spaces, accounts, categories, transactions, recurring, dashboard
│           ├── router.py       # HTTP: valida entrada, llama al service, arma la respuesta
│           ├── service.py      # reglas de negocio; único punto de entrada para otros módulos
│           ├── repository.py   # consultas SQLAlchemy
│           ├── models.py       # modelos ORM
│           ├── schemas.py      # schemas Pydantic de la API (separados de los ORM)
│           └── dependencies.py # dependencias FastAPI del módulo (si aplica)
├── alembic.ini                 # config de Alembic (la BD se lee de la config de la app, no de aquí)
├── migrations/                 # Alembic (env.py en modo async)
├── openapi.json                # contrato de la API, GENERADO por app.export_openapi (nunca a mano)
├── scripts/                    # utilidades sueltas (aún no existe; el export de OpenAPI vive en app/)
└── tests/
    ├── conftest.py             # fixtures: BD de test, cliente HTTP, usuarios y sesiones
    ├── unit/                   # lógica pura, sin BD            → backend-dev
    ├── db/                     # engine, pool, Connector, sesión por request y migraciones (BD real) → backend-dev
    ├── services/               # reglas de negocio con BD real  → backend-dev
    └── api/                    # contratos HTTP, 401/422, IDOR  → backend-dev (por endpoint) y qa (integración)
```

## Convenciones de código
- **Capas:** `router → service → repository`. Un módulo usa otro **solo vía su `service`**. Las operaciones que cruzan módulos van en **una sola transacción**.
- **Dinero:** `int` en Python, `BigInteger` en BD, siempre **centavos**. Sin `float` ni `Decimal` en la BD.
- **Tiempo:** momentos como `timestamptz` en UTC; la fecha de una transacción como `date` local del usuario. La zona horaria vive en `spaces.timezone`.
- **Nombres:** tablas en plural y snake_case; JSON en snake_case; URLs con guiones (`/recurring-templates`).
- **Rutas de espacio:** `/spaces/{space_id}/...` con la dependencia `require_space_member`. No miembro → **404** (no revelar que existe).
- **Acciones de negocio** como endpoints explícitos: `POST .../confirm`, `/skip`, `/cancel`, `/archive`.
- **Crear por intención:** el cliente manda "gasto de 1550 en Comida desde Itaú"; el backend arma los `entries`.
- **Editar** = rehacer los entries. **Borrar** = `deleted_at` (borrado suave).
- **Paginación por cursor**, orden `date desc, id desc`.
- **Errores:** `HTTPException` con mensajes en inglés y códigos estables; nunca filtrar trazas ni SQL al cliente.
- **Logs:** JSON con `request_id`. Nunca loguear tokens, cookies ni datos personales completos.
- **Async:** relaciones con `selectinload` explícito; nunca lazy loading.
- **Skill `fastapi`** (`.claude/skills/fastapi/`, la oficial de FastAPI 0.142.2): síguela en lo que no choque con este archivo. Diferencias conocidas, donde gana el proyecto: SQLAlchemy 2.0 async con modelos ORM separados de los schemas (no SQLModel), mypy (no ty), y *path operations* `async` porque el acceso a datos es async de punta a punta (asyncpg). Al subir de versión FastAPI, actualiza la copia de la skill desde el paquete instalado.

## Configuración
- Variables vía `pydantic-settings`. La lista completa y comentada está en `backend/.env.example` (nunca leas `.env`).
- `FIREBASE_AUTH_EMULATOR_HOST` solo existe en local: si está definida en staging/prod, la app debe negarse a arrancar.
- **Base de datos** (`app/core/db.py`):
  - `DATABASE_URL` (driver `postgresql+asyncpg://`): con `ENV=local` tiene valor por defecto; en staging/prod es obligatoria, salvo que exista `INSTANCE_CONNECTION_NAME`.
  - Con `INSTANCE_CONNECTION_NAME` se usa el Cloud SQL Python Connector (`DB_USER`, `DB_PASSWORD`, `DB_NAME` obligatorias; `DB_IP_TYPE` por defecto `PUBLIC`) y `DATABASE_URL` se ignora.
  - Pool pequeño (2–5): `DB_POOL_SIZE=2` + `DB_MAX_OVERFLOW=3`, `DB_POOL_TIMEOUT=30`.
- **Sesión por request:** `DbSession` (`from app.core.db import DbSession`). La dependencia **no hace commit**: el service es la unidad de trabajo y llama `await session.commit()`; lo que quede sin commit se revierte al terminar el request. Una operación que cruza módulos usa la misma sesión y un solo commit.
- **Modelos ORM:** heredan de `app.core.db.Base`. Toda restricción tiene nombre predecible (convención `pk_`, `fk_`, `uq_`, `ck_`, `ix_`); cada `CheckConstraint` **debe llevar `name=`**. Al crear los modelos de un módulo, importa su `models.py` en `migrations/env.py` para que autogenerate los vea.

## Contrato OpenAPI
- `backend/openapi.json` está **versionado** y se genera con `uv run python -m app.export_openapi`: claves ordenadas, indentación de 2 espacios, UTF-8 y un único `\n` final, así que dos corridas dan los mismos bytes. El frontend genera sus tipos a partir de él.
- Si un cambio toca la API (rutas, schemas, respuestas), **regenéralo en el mismo cambio**. `tests/unit/test_export_openapi.py` falla si el archivo versionado no coincide con la app.
- **Importar la app no debe construir `Settings` ni el engine** (viven en el `lifespan`, que el export no ejecuta): el export tiene que funcionar sin BD ni variables de entorno. No llames a `get_settings()` ni crees engines a nivel de módulo en routers, models o schemas.

## Tests
- **PostgreSQL real** (contenedor de Docker Compose), nunca SQLite. `docker compose up -d postgres` desde la raíz antes de correr la suite.
- `TEST_DATABASE_URL` (por defecto `finance_test`): su nombre **debe terminar en `_test`** o la suite se niega a correr (los tests de migraciones hacen `downgrade base`). `finance_test` solo se crea con el volumen vacío (ver README).
- Fixtures de BD en `tests/conftest.py`: `database` (BD de test compartida, solo lectura), `scratch_database_url` (BD nueva y vacía por test, se borra al terminar: úsala para escribir o migrar) y `settings_factory`.
- `alembic.command.*` llama `asyncio.run` internamente: desde un test async, invócalo con `await asyncio.to_thread(...)`.
- Cada test crea sus datos; nada depende del orden de ejecución.
- Prioridad alta: reglas de negocio (transferencias suman cero, saldo ignora pendientes y borrados, idempotencia del cron) y API (contratos, 422, 401, **IDOR**).
- Nombres que describen comportamiento: `test_non_member_gets_404_on_space_detail`.

## Migraciones
- Revisadas a mano después del autogenerate; con `downgrade` funcional.
- Nunca editar una migración que ya está en `main`.
- Se aplican como paso separado (Cloud Run Job), **nunca** al arrancar la app.
- `env.py` usa la misma config y el mismo `Database` que la API (Connector incluido). `alembic upgrade head --sql` (modo offline) solo funciona con `DATABASE_URL`.
- Las revisiones generadas se formatean solas con ruff (hook en `alembic.ini`). Aún no hay revisiones: la primera llega con los modelos (BE-03).