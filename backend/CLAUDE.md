# Backend — FastAPI

Python **3.14** · FastAPI · SQLAlchemy 2.0 async (asyncpg) · Alembic (async) · PostgreSQL · pytest · uv · ruff · mypy.
Despliegue: Cloud Run (`southamerica-east1`) + Cloud SQL vía Cloud SQL Python Connector.

> ⚠️ Los comandos de abajo son la convención acordada. Los fija **KAN-17 [BE-01]**: si esa tarea (o una posterior) los cambia, **actualiza este archivo en la misma tarea**.

## Comandos (siempre desde `/backend`)
| Para | Comando |
|---|---|
| Instalar dependencias | `uv sync` |
| Levantar la API en local | `uv run fastapi dev app/main.py` |
| Tests (todos) | `uv run pytest` |
| Tests de un archivo | `uv run pytest tests/api/test_spaces.py -q` |
| Lint | `uv run ruff check .` |
| Formato (verificar) | `uv run ruff format --check .` |
| Tipos | `uv run mypy .` |
| Nueva migración | `uv run alembic revision --autogenerate -m "<descripción>"` |
| Aplicar migraciones | `uv run alembic upgrade head` |
| Exportar OpenAPI | `uv run python scripts/export_openapi.py` → `backend/openapi.json` |

La BD local y el emulador de Firebase Auth se levantan con `docker compose up -d` desde la raíz del repo.

## Estructura
```
backend/
├── app/
│   ├── main.py                 # crea la app, registra routers y middlewares
│   ├── core/                   # config (pydantic-settings), db, seguridad, logging
│   └── modules/
│       └── <módulo>/           # spaces, accounts, categories, transactions, recurring, dashboard
│           ├── router.py       # HTTP: valida entrada, llama al service, arma la respuesta
│           ├── service.py      # reglas de negocio; único punto de entrada para otros módulos
│           ├── repository.py   # consultas SQLAlchemy
│           ├── models.py       # modelos ORM
│           ├── schemas.py      # schemas Pydantic de la API (separados de los ORM)
│           └── dependencies.py # dependencias FastAPI del módulo (si aplica)
├── migrations/                 # Alembic (env.py en modo async)
├── scripts/                    # utilidades (export de OpenAPI, etc.)
└── tests/
    ├── conftest.py             # fixtures: BD de test, cliente HTTP, usuarios y sesiones
    ├── unit/                   # lógica pura, sin BD            → backend-dev
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

## Configuración
- Variables vía `pydantic-settings`. La lista completa y comentada está en `backend/.env.example` (nunca leas `.env`).
- `FIREBASE_AUTH_EMULATOR_HOST` solo existe en local: si está definida en staging/prod, la app debe negarse a arrancar.
- Pool de conexiones pequeño (2–5).

## Tests
- **PostgreSQL real** (contenedor de Docker Compose), nunca SQLite.
- Cada test crea sus datos; nada depende del orden de ejecución.
- Prioridad alta: reglas de negocio (transferencias suman cero, saldo ignora pendientes y borrados, idempotencia del cron) y API (contratos, 422, 401, **IDOR**).
- Nombres que describen comportamiento: `test_non_member_gets_404_on_space_detail`.

## Migraciones
- Revisadas a mano después del autogenerate; con `downgrade` funcional.
- Nunca editar una migración que ya está en `main`.
- Se aplican como paso separado (Cloud Run Job), **nunca** al arrancar la app.