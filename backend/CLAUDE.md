# Backend — FastAPI

Python **3.14** · FastAPI · SQLAlchemy 2.1 async (asyncpg) · Alembic (async) · PostgreSQL · pytest · uv · ruff · mypy.
Despliegue: Cloud Run (`southamerica-east1`) + Cloud SQL vía Cloud SQL Python Connector.

Patrones de arquitectura con su porqué y un esqueleto de módulo: `docs/arquitectura-backend.md`. **Léelo al crear un módulo, una capa o un patrón nuevo.**

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
| Nueva migración | `uv run alembic upgrade head` y luego `uv run alembic revision --autogenerate -m "<descripción>"` |
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
│   ├── core/                   # config (pydantic-settings), db, seguridad, logging, errors y schemas base (`InputModel`, `ReadModel`, `Amount`, `Timezone`)
│   └── modules/
│       └── <módulo>/           # users, auth, currencies, spaces, accounts, categories, transactions, recurring, dashboard
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
    ├── fakes.py                # `FakeFirebaseAuth`, `unsigned_id_token` y `parse_set_cookie` (sin red ni emulador)
    ├── unit/                   # lógica pura, sin BD            → backend-dev
    ├── db/                     # engine, pool, Connector, sesión por request y migraciones (BD real) → backend-dev
    ├── services/               # reglas de negocio con BD real  → backend-dev
    ├── api/                    # contratos HTTP, 401/422, IDOR  → backend-dev (por endpoint) y qa (integración)
    └── emulator/               # punta a punta contra el emulador de Firebase Auth (docker compose up -d) → backend-dev y qa (integración)
```

## Convenciones de código
- **Capas:** `router → service → repository`. Services y repositories son **funciones async con `session` como primer parámetro** (no clases ni interfaces ABC). El service no conoce HTTP ni hace commit. El repository solo guarda consultas.
- **Entre módulos:** orden fijo `users/auth → currencies → spaces → accounts, categories → transactions → recurring, budgets, goals → dashboard`.
  - Un service solo llama services de módulos **anteriores**; los routers pueden combinar services de cualquier módulo.
  - De otro módulo solo se importan `service`, `schemas` y (desde la capa HTTP: routers y `dependencies.py`) `dependencies`, nunca `repository` ni `models`. Se intercambian schemas (`XRead`) o valores simples, nunca objetos ORM.
  - Si un caso de uso necesita un dato de un módulo posterior, el router lo trae y se lo pasa al service.
  - Los `dependencies.py` son capa HTTP como los routers: pueden combinar `service`/`schemas` de cualquier módulo, y solo pueden importar `dependencies` de módulos de **nivel inferior** (`spaces.dependencies` usa `auth.dependencies`). Un `service.py` o `repository.py` no puede importar las `dependencies` de otro módulo.
  - Lo vigila `tests/unit/test_module_boundaries.py` (`ast`, sin BD): también exige que `service.py`/`repository.py` no llamen `commit()`/`rollback()` ni importen `HTTPException`/`Request`, y que `app/core` no importe módulos. Un módulo nuevo debe añadirse a `ORDER` en ese archivo o el test falla.
- **Multi-espacio:** toda función de repository recibe `space_id` y filtra por él. El borrado suave se filtra en una consulta base del repository, nunca en cada llamada.
- **Dinero:** `int` en Python, `BigInteger` en BD, siempre en la **unidad menor de la moneda** según ISO 4217 (valor × 10^exponente: USD/UYU/COP ×100, CLP/PYG ×1; no siempre centavos). Sin `float` ni `Decimal` en la BD. El exponente sale de la tabla `currencies` (módulo `currencies`), única fuente de las monedas soportadas: sumar una moneda es agregar una fila en una migración de datos, y `spaces.currency` es FK a ella. En los schemas, el tipo común `Amount` (`app/core/schemas.py`): int estricto, > 0, ≤ 2^53 − 1 (el límite seguro de JavaScript). Las columnas se llaman `*_minor` (`amount_minor`), no `*_cents`. Los schemas de entrada validan el formato de la moneda con `CurrencyCode` (`app/modules/currencies/schemas.py`: 3 letras mayúsculas); que esté soportada lo decide `currencies` (service o FK). El signo lo pone el backend según el tipo.
- **IDs:** UUIDv7 generados en Python (`default=uuid.uuid7`).
- **Schemas:** `XCreate` / `XUpdate` (PATCH con `exclude_unset`) / `XRead`. Las entradas heredan de `InputModel` (`extra="forbid"`) y las salidas de `ReadModel` (`from_attributes`), ambas en `app/core/schemas.py`. Crear transacción = unión discriminada por `type`.
- **Endpoints:** `response_model=XRead` devolviendo el objeto ORM, `status_code` explícito (201 al crear, 204 sin cuerpo) y `responses={404: {"model": ErrorResponse}}` con los errores posibles.
- **Tiempo:** momentos como `timestamptz` en UTC; la fecha de una transacción como `date` local del usuario. La zona horaria vive en `spaces.timezone`.
- **Nombres:** tablas en plural y snake_case; JSON en snake_case; URLs con guiones (`/recurring-templates`).
- **Rutas de espacio:** `/spaces/{space_id}/...` con `require_space_member` declarada en el `APIRouter` (`dependencies=[...]`), no endpoint por endpoint. No miembro → **404** (no revelar que existe).
- **Acciones de negocio** como endpoints explícitos: `POST .../confirm`, `/skip`, `/cancel`, `/archive`.
- **Crear por intención:** el cliente manda "gasto de 1550 en Comida desde Itaú"; el backend arma los `entries`.
- **Editar** = rehacer los entries. **Borrar** = `deleted_at` (borrado suave).
- **Paginación por cursor**, orden `date desc, id desc`: cursor opaco (base64 de `date` + `id`), `limit` de 1 a 100, respuesta `Page[T]` (`items`, `next_cursor`). Filtros como modelo de query `Annotated[Filtros, Query()]` con `extra="forbid"`. Nunca ordenar por un texto del cliente.
- **Errores** (`app/core/errors.py`): el service lanza `AppError`: `NotFoundError(code, detail)` 404, `ConflictError` 409, `UnauthenticatedError` 401, `ForbiddenError` 403 (p. ej. `origin_not_allowed`) e `InvalidFieldError(loc, code, msg)` 422 con el formato de validación de FastAPI (`loc` es una tupla o lista, p. ej. `("body", "category_id")`; un `str` suelto da `TypeError`). Lanza siempre una subclase: un `AppError` directo (o una subclase sin su propio status 4xx) es un bug y responde como cualquier error no previsto (500 genérico + traza). Respuesta `{"detail": "<inglés>", "code": "<snake_case estable>"}` (`ErrorResponse`); el frontend traduce `code`. No uses `HTTPException` en código nuevo (si aparece, o un 404/405 del router, se convierte al mismo formato con `code` = frase HTTP: `not_found`, `method_not_allowed`). Un error no previsto da 500 `{"detail": "Internal server error", "code": "internal_error"}` con `X-Request-ID`: lo captura `RequestIdMiddleware`, que loguea **una** traza y **no relanza**. Nunca filtrar trazas ni SQL al cliente.
- **Logs** (`app/core/logging.py`): una línea JSON por evento en stdout, con `severity` (no `level`; es lo que lee Cloud Logging), `message`, `logger`, `timestamp` y `request_id`. Con `GOOGLE_CLOUD_PROJECT` y el header `X-Cloud-Trace-Context` (lo añade Cloud Run) suman `logging.googleapis.com/trace`. Los campos de `extra=` nunca pisan los reservados. El `X-Request-ID` entrante se reutiliza si cumple `[A-Za-z0-9._-]{1,64}`; si no, se genera. Los logs de Uvicorn salen por el mismo formateador desde el `lifespan`; las líneas de arranque anteriores al lifespan ("Started server process"...) siguen en texto hasta que el despliegue use `--log-config`. Nunca loguear tokens, cookies ni datos personales completos.
- **Async:** relaciones con `selectinload` explícito y `lazy="raise"` en toda `relationship()`; nunca lazy loading. Una sesión no se comparte entre tareas (`asyncio.gather` con la misma sesión, no). Librerías síncronas (`firebase-admin`, `google-auth`) con `await asyncio.to_thread(...)`.
- **Cloud Run:** sin `BackgroundTasks` para trabajo importante (la CPU se limita tras responder), sin estado en memoria entre requests y sin caché de respuestas.
- **Skill `fastapi`** (`.claude/skills/fastapi/`, la oficial de FastAPI 0.142.2): síguela en lo que no choque con este archivo. Diferencias conocidas, donde gana el proyecto: SQLAlchemy 2.1 async con modelos ORM separados de los schemas (no SQLModel), mypy (no ty), *path operations* `async` porque el acceso a datos es async de punta a punta (asyncpg), y rutas **sin barra final**: con `prefix`, la colección se declara con `""` y no con `"/"` como en los ejemplos de la skill (que generan `/items/`). La app usa `redirect_slashes=False`: una barra final da 404, no 307 (`tests/api/test_routing.py` vigila que ninguna ruta termine en `/`). Al subir de versión FastAPI, actualiza la copia de la skill desde el paquete instalado.

## Configuración
- Variables vía `pydantic-settings`. La lista completa y comentada está en `backend/.env.example` (nunca leas `.env`).
- `FIREBASE_AUTH_EMULATOR_HOST` solo existe en local: si está definida en staging/prod con **cualquier** valor distinto de vacío (solo espacios incluidos), la app debe negarse a arrancar (la regla vive en `Settings`; nada más la repite). `firebase-admin` solo mira `os.environ` y trata todo valor no vacío como emulador (y entonces no comprueba la firma). Con `ENV=local` vale `localhost:9099` por defecto y vacía (o solo espacios) la desactiva. `Settings` puede venir de `backend/.env`: `create_firebase_auth` hace que `os.environ` coincida siempre con `Settings`, copiando el valor allí o borrando la variable si `Settings` no la tiene.
- **`ENV` y Cloud Run:** si falta `ENV`, la app asume `local`. Para que un olvido en el despliegue no abra los docs, el emulador ni cookies sin `Secure`, el `lifespan` se niega a arrancar con `Settings.ENV == "local"` si existe `K_SERVICE` (Cloud Run lo define siempre; se lee de `os.environ`, nunca del `.env`: `running_on_cloud_run()` en `app/core/config.py`). En staging/prod, `ENV` va en el entorno del servicio. La regla está en el `lifespan` (junto a la de los docs, que también compara el entorno del proceso con `Settings`) y no en `Settings`, para que construir `Settings` (tests, alembic, export) no dependa de dónde corre el proceso.
- `FIREBASE_PROJECT_ID`: proyecto para el que se emiten los ID tokens. Con `ENV=local` vale `demo-finance-local` (el del emulador: debe coincidir con `FIREBASE_EMULATOR_PROJECT_ID` de la raíz y con el del frontend); obligatoria en staging/prod.
- `ALLOWED_ORIGINS`: orígenes del frontend (lista separada por comas, solo `esquema://host[:puerto]`, sin barra final) que pueden crear o cerrar sesión. Con `ENV=local` vale `http://localhost:3000`; obligatoria en staging/prod. Un valor mal formado (o con un puerto inválido) impide arrancar. Se normalizan a minúsculas y sin el puerto por defecto (`:443` en https, `:80` en http), porque los navegadores no lo envían en `Origin`.
- `GOOGLE_CLOUD_PROJECT` (opcional): id del proyecto de GCP para el campo trace de los logs. Cloud Run no lo expone al contenedor, hay que configurarlo en el servicio; sin él solo se pierde la correlación (aviso `gcp_project_not_set` al arrancar fuera de local).
- **Docs de la API:** `/docs`, `/redoc` y `/openapi.json` solo existen con `ENV=local` (o sin definir). `create_app()` lo decide con `docs_enabled()`, que lee `os.environ` y **no** construye `Settings` (el export no puede depender de variables); cualquier otro valor las oculta. El `lifespan` se niega a arrancar si `Settings.ENV` no es `local` y los docs están activos (p. ej. `ENV` solo en un `.env`): en staging/prod, define `ENV` en el entorno del proceso.
- **Base de datos** (`app/core/db.py`):
  - `DATABASE_URL` (driver `postgresql+asyncpg://`): con `ENV=local` tiene valor por defecto; en staging/prod es obligatoria, salvo que exista `INSTANCE_CONNECTION_NAME`.
  - Con `INSTANCE_CONNECTION_NAME` se usa el Cloud SQL Python Connector (`DB_USER`, `DB_PASSWORD`, `DB_NAME` obligatorias; `DB_IP_TYPE` por defecto `PUBLIC`) y `DATABASE_URL` se ignora.
  - Los engines usan `hide_parameters=True`: los errores de SQL no incluyen los valores de los parámetros.
  - Pool pequeño (2–5): `DB_POOL_SIZE=2` + `DB_MAX_OVERFLOW=3`, `DB_POOL_TIMEOUT=30`.
- **Sesión de usuario** (`app/modules/auth/`): `POST /auth/session` (`id_token`, `timezone`) y `DELETE /auth/session` (204). Ambos exigen `Origin` en `ALLOWED_ORIGINS` (`require_allowed_origin`, declarada en el `APIRouter`; ausente o distinto → 403 `origin_not_allowed`). El POST verifica el ID token con `firebase-admin` (`auth_time` de menos de 5 min, si no 401 `recent_sign_in_required`; token inválido o sin `auth_time` 401 `invalid_id_token`; cuenta sin email 401 `email_required`), crea la session cookie de 14 días y, en la misma transacción, hace el upsert del usuario y crea "Mi espacio" (UYU, la zona recibida) si no existe. Firebase se llama antes de tocar la BD (el pool es de 2–5 conexiones).
  - **Cookie:** `session` sin `Secure` con `ENV=local`; `__Host-session` con `Secure` en cualquier otro entorno. Siempre `HttpOnly`, `SameSite=Lax`, `Path=/` y sin `Domain`. El nombre y `Secure` salen de `Settings.session_cookie_name` / `session_cookie_secure`; poner y borrar la cookie pasa por `auth/cookies.py` (un `__Host-` solo se borra con los mismos atributos). `get_current_user` la lee con ese mismo nombre.
  - **`current_user` y `require_space_member`:** `CurrentUser` (`auth/dependencies.py`) lee la cookie, la verifica con `verify_session_cookie(check_revoked=True)` (una llamada a Firebase por request, sin caché) y busca el usuario por `firebase_uid`. Sin cookie → 401 `not_authenticated`; cookie inválida, expirada, revocada, cuenta deshabilitada o borrada, o usuario sin fila en la BD → 401 `invalid_session`. Firebase inaccesible → 500 genérico. `require_space_member` (`spaces/dependencies.py`) no miembro o espacio inexistente → 404 `space_not_found` (el mismo cuerpo, nunca 403). `SpaceMember` es el alias para leer el rol en un endpoint. `tests/api/test_routing.py` comprueba, para toda operación `/spaces/{space_id}/...`, que sin cookie responde 401 `not_authenticated` y que con sesión válida de un usuario sin espacios responde 404 `space_not_found` (una ruta que solo use `CurrentUser` falla); no sustituye al test de IDOR de cada endpoint.
  - **Frontera con Firebase:** `auth/firebase.py` es el único archivo que importa `firebase_admin` (sin tipos: override de mypy en `pyproject.toml`; import perezoso para que importar la app no lo cargue). `FirebaseAuth` es un `Protocol`; `app.state.firebase` se crea y se cierra en el `lifespan`, y `get_firebase_auth` (la dependencia que los tests sobreescriben) lo lee. Los errores de token son 401; cualquier otro fallo de Firebase sale como el 500 genérico.
  - **Composición:** `users` y `auth` son nivel 0 y `spaces` nivel 2, así que el router de `auth` compone `auth.service`, `users.service` y `spaces.service` (los services no se llaman entre sí).
  - `display_name` solo se escribe al crear el usuario; los logins siguientes solo refrescan el `email`; la zona horaria de un espacio existente nunca cambia.
  - `Timezone` (`app/core/schemas.py`) valida contra la lista de `tzdata` (no contra `zoneinfo.available_timezones()`, que depende del sistema); el error es `timezone_invalid`.
- **Sesión y transacción por request:** `DbSession` (`from app.core.db import DbSession`). La dependencia usa `scope="function"`: hace **commit si el endpoint termina bien y rollback si falla, antes de enviar la respuesta**. **Para revertir hay que lanzar** un `AppError`: devolver una respuesta 4xx sin lanzar hace commit. Los services **nunca** llaman `commit()` ni `rollback()`; usan `flush()` si necesitan el id o detectar una restricción (un `IntegrityError` esperable → `ConflictError`). Así, una operación que cruza módulos es una sola transacción. Fuera de HTTP (scripts), commit explícito.
  - `get_sessionmaker` es la dependencia de la que sale la fábrica de sesiones; los tests de API la sobreescriben.
  - Restricción de FastAPI: una dependencia con `yield` y scope por defecto (`request`) no puede depender de una `scope="function"`. Cualquier dependencia **con `yield`** que use `DbSession` debe declararse también con `scope="function"`; las sin `yield` (p. ej. un futuro `get_current_user`) no tienen esa restricción.
- **Modelos ORM:** heredan de `app.core.db.Base`. Toda restricción tiene nombre predecible (convención `pk_`, `fk_`, `uq_`, `ck_`, `ix_`); cada `CheckConstraint` **debe llevar `name=`**. Al crear los modelos de un módulo, importa su `models.py` en `migrations/env.py` para que autogenerate los vea.

## Contrato OpenAPI
- `backend/openapi.json` está **versionado** y se genera con `uv run python -m app.export_openapi`: claves ordenadas, indentación de 2 espacios, UTF-8 y un único `\n` final, así que dos corridas dan los mismos bytes. El frontend genera sus tipos a partir de él.
- Si un cambio toca la API (rutas, schemas, respuestas), **regenéralo en el mismo cambio**. `tests/unit/test_export_openapi.py` falla si el archivo versionado no coincide con la app.
- **Importar la app no debe construir `Settings` ni el engine** (viven en el `lifespan`, que el export no ejecuta): el export tiene que funcionar sin BD ni variables de entorno. No llames a `get_settings()` ni crees engines a nivel de módulo en routers, models o schemas.

## Tests
- **PostgreSQL real** (contenedor de Docker Compose), nunca SQLite. `docker compose up -d postgres` desde la raíz antes de correr la suite.
- `TEST_DATABASE_URL` (por defecto `finance_test`): su nombre **debe terminar en `_test`** o la suite se niega a correr (los tests de migraciones hacen `downgrade base`). `finance_test` solo se crea con el volumen vacío (ver README).
- Fixtures de BD en `tests/conftest.py`: `database` (BD de test compartida, solo lectura), `scratch_database_url` (BD nueva y vacía por test, se borra al terminar: úsala para escribir o migrar) y `settings_factory`.
- **Firebase en los tests:** la API y los services se prueban con `FakeFirebaseAuth` (fixture `fake_firebase`, que sobreescribe `get_firebase_auth`). El adapter real se prueba sin red con `unsigned_id_token(...)` y `FIREBASE_AUTH_EMULATOR_HOST` puesta con `monkeypatch` (en modo emulador `firebase-admin` no comprueba firma ni `exp`, solo `aud`/`iss`/`sub`: la antigüedad la comprueba nuestro `auth_time`). `tests/emulator/` va contra el emulador real: **requiere `docker compose up -d`** y, si no responde, falla con instrucciones (no se salta); el CI deberá levantarlo.
  - Fixtures en `tests/emulator/conftest.py`: `emulator_host`, `real_firebase` (sobreescribe `get_firebase_auth` con el adapter real) y `emulator_user` (factory de cuentas con email único; borra al terminar solo las que creó).
  - Helpers en `tests/emulator/helpers.py`: `sign_up`/`sign_in` (ID token real del emulador), `delete_account`, `old_id_token(age, account)` (token sin firma con `auth_time` pasado: el emulador no emite tokens viejos) y `assert_error_response(response, status, code)` (formato de error único de la API).
  - **Nunca** se vacía el emulador completo (`DELETE /emulator/v1/projects/.../accounts`): lo comparten el frontend y la UI de desarrollo. Cada test borra solo sus cuentas.
- **Tests de services y API: savepoint por test.** La BD de test se migra una vez por sesión de pytest y cada test corre en una transacción que se revierte al final (`join_transaction_mode="create_savepoint"`), así que los `commit()` no dejan datos. Fixtures: `migrated_test_database` (sesión; `alembic upgrade head` sobre `finance_test`; si la BD quedó en una revisión que no existe en la rama, falla con los comandos para recrearla), `db_connection`, `session_factory`, `session` (services) y `api_client` (sobreescribe `get_sessionmaker`, así corre el commit/rollback real de `get_session`; sin requests concurrentes: comparten conexión). `scratch_database_url` queda para los tests de `tests/db` que migran o prueban el engine; los demás (también en `tests/db`, p. ej. `test_savepoint_fixtures.py`) pueden usar `session`.
- **Concurrencia real** (`tests/db/test_first_login_concurrency.py`): el savepoint comparte una conexión y no muestra carreras; para eso, un engine por actor sobre `scratch_database_url` y el solapamiento forzado (la transacción A no confirma hasta que una tercera conexión, en AUTOCOMMIT, ve en `pg_stat_activity` a B esperando un lock), sin `sleep` fijos.
- El `lifespan` escribe `FIREBASE_AUTH_EMULATOR_HOST` en `os.environ`: el fixture autouse `_isolated_settings` lo deja registrado en `monkeypatch` para que no se filtre entre tests (y borra `K_SERVICE`). Un test que llame a `create_firebase_auth` sin ese fixture debe hacer lo mismo.
- `alembic.command.*` llama `asyncio.run` internamente: desde un test async, invócalo con `await asyncio.to_thread(...)`.
- Cada test crea sus datos con funciones async de ayuda (`await make_space(session, ...)`), sin librerías de factories; nada depende del orden de ejecución.
- Las funciones puras (armado de entries, cursor) se prueban en `tests/unit` sin BD.
- Prioridad alta: reglas de negocio (transferencias suman cero, saldo ignora pendientes y borrados, idempotencia del cron) y API (contratos, 422, 401, **IDOR**).
- Nombres que describen comportamiento: `test_non_member_gets_404_on_space_detail`.

## Migraciones
- Revisadas a mano después del autogenerate; con `downgrade` funcional.
- Antes del autogenerate, `uv run alembic upgrade head` sobre la BD local `finance`: autogenerate compara contra ella y falla ("Target database is not up to date") si no está en la última revisión. Después, `uv run alembic check` confirma que no quedan cambios sin migrar.
- Nunca editar una migración que ya está en `main`.
- Revision IDs secuenciales de 4 dígitos (`0001`, `0002`…): `uv run alembic revision --autogenerate --rev-id 0002 -m "<descripción>"`. Su `down_revision` apunta a la anterior (`"0001"`).
- Se aplican como paso separado (Cloud Run Job), **nunca** al arrancar la app.
- `env.py` usa la misma config y el mismo `Database` que la API (Connector incluido). `alembic upgrade head --sql` (modo offline) solo funciona con `DATABASE_URL`.
- Las revisiones generadas se formatean solas con ruff (hook en `alembic.ini`). La primera (`0001`) crea `currencies` con su semilla; las monedas nuevas entran como migración de datos.