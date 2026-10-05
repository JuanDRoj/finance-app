# Arquitectura del backend

Última actualización: 2026-10-05

Patrones y buenas prácticas del backend (FastAPI + SQLAlchemy async + PostgreSQL), con su porqué. Las reglas cortas que se aplican en cada tarea viven en `backend/CLAUDE.md`; este documento explica las razones y trae un esqueleto de módulo. **Léelo al crear un módulo, una capa o un patrón nuevo** (errores, paginación, transacciones, tests de BD).

Fuentes: el artículo *FastAPI Best Practices and Design Patterns* (SOLID, DAO, Service Layer), el repo `Aavache/fastapi-designs`, la documentación oficial (FastAPI 0.142, SQLAlchemy 2.1, Python 3.14, Cloud Run) y pruebas propias contra PostgreSQL. Lo que se descartó de las fuentes está al final, con el motivo.

> **Estado.** Algunas piezas aún no existen en el código. Están marcadas como *(pendiente)*. **KAN-37 [BE-10] Base de arquitectura** (bloquea a KAN-19 [BE-03]) implementa el commit por request, `core/schemas.py`, el test de fronteras y la fixture de savepoint. **KAN-35 [BE-08]** implementa `core/errors.py`, antes de auth y spaces. La unidad de los montos la fija **KAN-36 [BE-09]**.

---

## 1. Capas

Cada módulo de `app/modules/<módulo>/` tiene las mismas capas:

| Capa | Hace | No hace |
|---|---|---|
| `router.py` | Recibe HTTP, declara dependencias, llama a services y define la respuesta (`response_model`, status, `responses`) | Reglas de negocio, consultas |
| `service.py` | Reglas de negocio y casos de uso. Es el único punto de entrada para otros módulos | Conocer HTTP (`Request`, `HTTPException`), hacer commit |
| `repository.py` | Consultas SQLAlchemy reutilizables, siempre filtradas por espacio | Reglas, commit |
| `models.py` | Modelos ORM | Lógica |
| `schemas.py` | Schemas Pydantic de entrada y salida | Acceso a datos |
| `dependencies.py` | Dependencias FastAPI del módulo (ej. `require_space_member` en `spaces`) | Reglas de negocio |

**Services y repositories son funciones async con `session: AsyncSession` como primer parámetro**, no clases inyectadas:

```python
async def archive_account(session: AsyncSession, space_id: UUID, account_id: UUID) -> Account: ...
```

Por qué: llamar a otro módulo es una llamada directa con la misma sesión, los tests llaman la función con la BD real y no hace falta una fábrica más un alias de `Depends` por service. La skill oficial de FastAPI desaconseja las dependencias de clase. Tampoco se usan interfaces ABC por repository: hay una sola implementación y los tests usan PostgreSQL real. Un `Protocol` solo se justifica en fronteras externas (como `CloudSqlConnector` en `core/db.py`).

Reparto entre service y repository: el repository guarda las consultas (`select` con sus filtros). El service puede crear objetos ORM y hacer `session.add()` / `flush()`, sin pasar por un wrapper trivial del repository.

## 2. Módulos y sus dependencias

Orden fijo, sin ciclos (de abajo hacia arriba):

```
users/auth → spaces → accounts, categories → transactions → recurring, budgets, goals → dashboard
```

Reglas:
1. **El service de un módulo solo llama a services de módulos anteriores** en el orden. Los del mismo nivel (ej. `accounts` y `categories`) no se llaman entre sí.
2. **Los routers pueden combinar services de cualquier módulo.** Son la capa de composición.
3. **De otro módulo solo se importan su `service`, sus `schemas` y (desde routers) sus `dependencies`.** Nunca su `repository` ni sus `models`. Las FK entre módulos van por nombre (`ForeignKey("spaces.id")`) y no hay `relationship()` entre módulos.
4. **Entre módulos se intercambian schemas (`XRead`) o valores simples, nunca objetos ORM.** Así nadie modifica ni carga relaciones de un modelo ajeno.
5. *(pendiente)* `tests/unit/test_module_boundaries.py` lo hace cumplir con `ast`, sin dependencias nuevas.

**Cuando un caso de uso necesita datos de un módulo posterior**, el router los obtiene y se los pasa al service, que aplica la regla. Ejemplo: archivar una cuenta exige saldo 0, y el saldo vive en `transactions` (dueño de los `entries`):

```python
# accounts/router.py
balance = await transactions_service.get_account_balance(session, space_id, account_id)
return await service.archive_account(session, space_id, account_id, balance=balance)
```

La regla ("saldo distinto de 0 → `ConflictError`") queda en `accounts.service`; el router solo trae el dato. Si un caso de uso necesita muchos datos de arriba, es señal de que pertenece al módulo de arriba.

## 3. Transacciones: una por request *(pendiente)*

- **La dependencia de sesión es la unidad de trabajo.** `get_session` usa `Depends(..., scope="function")`: si el endpoint termina bien hace `commit()`, si lanza una excepción hace `rollback()`, y las dos cosas ocurren **antes** de enviar la respuesta (doc oficial de FastAPI, *dependencies with yield*). El cliente nunca ve un 200 de algo que no se guardó.
- **Los services nunca llaman `commit()` ni `rollback()`.** Usan `await session.flush()` cuando necesitan el id generado o detectar una restricción a tiempo.
- Una operación que cruza módulos es una sola transacción por construcción: todos usan la misma sesión del request.
- **Restricciones que pueden fallar por datos del usuario** (UNIQUE): el service hace `flush()` dentro de `try/except IntegrityError` y lanza `ConflictError` con su código. El nombre predecible de la restricción (`uq_...`) permite distinguir cuál fue.
- Fuera de HTTP (scripts, seeds): se abre `db.sessionmaker()` y se hace commit explícito.

## 4. Errores *(pendiente: `app/core/errors.py`, KAN-35 [BE-08])*

Los services lanzan **errores de dominio**; un handler registrado en `create_app` los convierte en HTTP.

| Error | Status | Cuándo | Respuesta |
|---|---|---|---|
| `NotFoundError` | 404 | No existe o no es del espacio (incluye "no eres miembro") | `{"detail": "...", "code": "account_not_found"}` |
| `ConflictError` | 409 | Choca con el estado actual: duplicado, archivar con saldo, confirmar algo ya confirmado | `{"detail": "...", "code": "account_has_balance"}` |
| `UnauthenticatedError` | 401 | Sin sesión o sesión inválida | `{"detail": "...", "code": "not_authenticated"}` |
| `InvalidFieldError` | 422 | Validación que necesita la BD: categoría de otro tipo, cuenta archivada | **Mismo formato que la validación de FastAPI**: `{"detail": [{"type": "category_kind_mismatch", "loc": ["body", "category_id"], "msg": "..."}]}` |

- `detail` en inglés y `code` estable en snake_case (`<entidad>_<problema>`). El frontend traduce `code` (o `type` en los 422) a un mensaje en español. Un código nuevo implica agregar su traducción, y un código existente nunca se renombra.
- El 422 tiene un solo formato, venga de Pydantic o del service, así que el frontend puede marcar el campo con error en el formulario.
- Las validaciones que no necesitan la BD van en el schema (Pydantic → 422 automático). Ejemplo: en una transferencia, origen y destino deben ser cuentas distintas.
- Errores no previstos → 500 con `{"detail": "Internal server error", "code": "internal_error"}`, sin trazas ni SQL. El `X-Request-ID` permite encontrarlos en los logs.
- En código nuevo no se usa `HTTPException`: siempre un `AppError`.
- Los endpoints documentan sus errores con `responses={404: {"model": ErrorResponse}}` para que el cliente TypeScript los conozca.

## 5. Schemas y validación

- **Un schema por uso:** `AccountCreate`, `AccountUpdate` (PATCH: todo opcional, se aplica con `model_dump(exclude_unset=True)`) y `AccountRead`.
- *(pendiente: `app/core/schemas.py`)* Bases comunes: `InputModel` con `extra="forbid"` (un campo desconocido da 422, lo que atrapa errores del cliente) y `ReadModel` con `from_attributes=True`.
- **Dinero:** un tipo común `Annotated[int, Field(strict=True, gt=0, le=2**53 - 1)]`. Su nombre y la unidad (menor según ISO 4217, no siempre centavos) los fija **KAN-36 [BE-09]**; aquí se llama `Amount`.
  - `strict` rechaza `"1550"`, `15.0` y `true` (verificado con Pydantic 2.13).
  - El tope es `Number.MAX_SAFE_INTEGER`: JavaScript pierde precisión por encima, aunque `bigint` admita más.
  - El signo lo pone el backend según el tipo de movimiento, nunca el cliente. Si un caso necesita monto con signo (ajustes), se define un tipo aparte con el mismo tope en valor absoluto.
- **Crear una transacción:** unión discriminada por `type`. Cada tipo valida solo sus campos y el OpenAPI y los tipos TS lo reflejan:

  ```python
  TransactionCreate = Annotated[
      ExpenseCreate | IncomeCreate | TransferCreate | AdjustmentCreate,
      Field(discriminator="type"),
  ]
  ```

- **Respuesta:** el router declara `response_model=AccountRead` y devuelve el objeto ORM. FastAPI lo filtra y serializa, y mypy queda conforme con `-> Account`.
- **Fechas:** la fecha de una transacción es `date`; los momentos son `datetime` con zona (UTC). `spaces.timezone` se valida con `zoneinfo.ZoneInfo` (si es inválida, 422).
- **Valores tipo enum** (`expense`, `bank`...): en los schemas, `Literal` o `StrEnum`. En la BD lo decide la tarea de modelos (ENUM nativo, o texto + CHECK). Ojo: el `Enum` de SQLAlchemy guarda por defecto el **nombre** del miembro (`BANK`), no su valor; si se usa, hay que pasar `values_callable`.

## 6. Espacios, IDOR y seguridad

- **`require_space_member` se declara en el `APIRouter`** (`dependencies=[Depends(require_space_member)]`), no en cada endpoint: toda ruta del router queda protegida aunque alguien olvide ponerlo. Si el endpoint necesita la membresía (ej. el rol), la vuelve a declarar como parámetro; FastAPI la resuelve una sola vez por request.
- **Defensa en profundidad:** toda función de repository recibe `space_id` y filtra por él. `get(session, space_id, account_id)`, nunca `get(session, account_id)`. Un recurso de otro espacio da el mismo 404 que uno inexistente.
- **Nada que modifique datos va por `GET`.** Junto con la cookie `SameSite=Lax`, eso cierra la puerta al CSRF clásico.
- **Librerías síncronas** (`firebase-admin`, `google-auth`): se llaman con `await asyncio.to_thread(...)`, nunca directo dentro de `async def`, porque bloquearían el servidor para todos los requests.
- **Cron** (Cloud Scheduler → endpoint): verifica el token OIDC de la cuenta de servicio del scheduler (audiencia y email) con `google-auth`, vía `to_thread`.

## 7. Patrones de dominio

**Armar los entries según el tipo (patrón estrategia).** Funciones puras por tipo, elegidas con `match` y cerradas con `assert_never`. Así, si se agrega un tipo y no se maneja, **mypy falla**:

```python
def build_entries(data: TransactionCreate) -> list[EntryDraft]:
    match data:
        case ExpenseCreate():
            return expense_entries(data)
        case IncomeCreate():
            return income_entries(data)
        case TransferCreate():
            return transfer_entries(data)  # suma cero: -monto origen, +monto destino
        case AdjustmentCreate():
            return adjustment_entries(data)
        case _:
            assert_never(data)
```

Son funciones puras, así que reglas como "una transferencia suma cero" se prueban en `tests/unit` sin BD. Editar una transacción = volver a llamar `build_entries` y reemplazar sus entries.

**Borrado suave en un solo lugar.** El repository tiene una consulta base que siempre agrega el filtro, y el resto parte de ella:

```python
def _active(space_id: UUID) -> Select[Transaction]:
    return select(Transaction).where(
        Transaction.space_id == space_id, Transaction.deleted_at.is_(None)
    )
```

**Paginación por cursor** (orden `date desc, id desc`):
- Parámetros como modelo de query: `filters: Annotated[TransactionFilters, Query()]`, con `extra="forbid"`, `limit` entre 1 y 100 (50 por defecto) y `cursor` opcional.
- El cursor es opaco: base64 url-safe de `(date, id)` del último elemento. Si no se puede decodificar, 422.
- Consulta: `where(tuple_(Transaction.date, Transaction.id) < (cursor_date, cursor_id))`, con `order_by(date desc, id desc)` y `limit(limit + 1)`. Si vuelve una fila de más, hay página siguiente.
- Respuesta genérica: `class Page[T](BaseModel): items: list[T]; next_cursor: str | None`.
- Índice: `(space_id, date DESC, id DESC) WHERE deleted_at IS NULL`.
- El orden es fijo. Si algún día el cliente elige el orden, se mapea un `Literal` a columnas conocidas; nunca `getattr(Model, texto_del_cliente)`.

**Cron idempotente.** `insert(...).on_conflict_do_nothing(constraint="uq_transactions_template_id_period").returning(Transaction.id)` (dialecto `postgresql`). Solo se crean entries para los ids devueltos. Correrlo dos veces el mismo día no duplica nada.

## 8. Async y Cloud Run

- **Nunca lazy loading:** toda `relationship()` lleva `lazy="raise"`. Si alguien olvida `selectinload`, el test falla con un error claro en vez de un `MissingGreenlet` confuso (doc de SQLAlchemy asyncio).
- **Una `AsyncSession` no se comparte entre tareas concurrentes:** nada de `asyncio.gather` con la misma sesión (doc de SQLAlchemy). En el dashboard, consultas en secuencia.
- **Sin `BackgroundTasks` para trabajo importante:** Cloud Run limita la CPU después de enviar la respuesta (doc de Cloud Run).
- **Sin estado en memoria entre requests** (cachés, contadores, rate limits): hay varias instancias y escalan a cero. Lo único global es la config (`lru_cache`) y el engine (`lifespan` → `app.state`).
- **Sin caché de respuestas:** los saldos tienen que estar siempre al día.

## 9. IDs

UUIDv7 generados en Python: `mapped_column(primary_key=True, default=uuid.uuid7)` (stdlib desde Python 3.14; PostgreSQL 16 no trae `uuidv7()`).
- **Ventajas:** son ordenados en el tiempo, así que el índice de la PK crece por el final, y el desempate del cursor sigue el orden de creación.
- **Contra aceptado:** el id revela cuándo se creó el registro.

## 10. Tests

| Carpeta | Qué | BD |
|---|---|---|
| `tests/unit` | Funciones puras: builders de entries, cursor, validadores, fronteras entre módulos | Ninguna |
| `tests/services` | Reglas de negocio llamando funciones del service | Savepoint por test |
| `tests/api` | Contratos HTTP, 401/404/409/422, IDOR | Savepoint por test |
| `tests/db` | Engine, pool, Connector, sesión, migraciones | BD nueva por test (`scratch_database_url`) |

- *(pendiente)* **Savepoint por test.** La BD de test se migra una vez por sesión de pytest. Cada test corre dentro de una transacción externa, con la sesión en `join_transaction_mode="create_savepoint"`: los `commit()` del código se convierten en savepoints y al final todo se revierte (receta oficial de SQLAlchemy, probada con `AsyncSession` + asyncpg + PostgreSQL 16). Es mucho más rápido que crear una BD por test.
- **Tests de API:** se sobreescribe (`app.dependency_overrides`) la fábrica de sesiones para que use la conexión del test. Así corre el commit/rollback real de `get_session`. El usuario autenticado también se sobreescribe; unos pocos tests de auth usan el emulador de Firebase de punta a punta.
- **Datos:** funciones async de ayuda (`await make_space(session, ...)`), sin librerías de factories. Cada test crea lo suyo.

## 11. Esqueleto de un módulo

Referencia mínima (`accounts`) hasta que exista el primer módulo real; después, este apartado apuntará a ese módulo. Las columnas completas están en `docs/modelo-de-datos.md`, y los nombres de las dependencias de auth los fija su tarea.

```python
# models.py
class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spaces.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# schemas.py
class AccountCreate(InputModel):
    name: str = Field(min_length=1, max_length=80)


class AccountRead(ReadModel):
    id: UUID
    name: str
    archived_at: datetime | None


# repository.py
def _in_space(space_id: UUID) -> Select[Account]:
    return select(Account).where(Account.space_id == space_id)


async def get(session: AsyncSession, space_id: UUID, account_id: UUID) -> Account | None:
    return await session.scalar(_in_space(space_id).where(Account.id == account_id))


async def list_active(session: AsyncSession, space_id: UUID) -> list[Account]:
    rows = await session.scalars(
        _in_space(space_id).where(Account.archived_at.is_(None)).order_by(Account.name)
    )
    return list(rows)


# service.py
async def list_accounts(session: AsyncSession, space_id: UUID) -> list[Account]:
    return await repository.list_active(session, space_id)


async def create_account(session: AsyncSession, space_id: UUID, data: AccountCreate) -> Account:
    account = Account(space_id=space_id, name=data.name)
    session.add(account)
    await session.flush()  # sin commit: lo hace get_session al terminar el request
    return account


async def archive_account(
    session: AsyncSession, space_id: UUID, account_id: UUID, *, balance: int
) -> Account:
    account = await _get_or_raise(session, space_id, account_id)
    if balance != 0:
        raise ConflictError("account_has_balance", "Account balance must be zero to archive it")
    account.archived_at = datetime.now(UTC)
    return account


async def get_account(session: AsyncSession, space_id: UUID, account_id: UUID) -> AccountRead:
    """For other modules: a schema, never the ORM object."""
    return AccountRead.model_validate(await _get_or_raise(session, space_id, account_id))


async def _get_or_raise(session: AsyncSession, space_id: UUID, account_id: UUID) -> Account:
    account = await repository.get(session, space_id, account_id)
    if account is None:
        raise NotFoundError("account_not_found", "Account not found")
    return account


# router.py
router = APIRouter(
    prefix="/spaces/{space_id}/accounts",
    tags=["accounts"],
    dependencies=[Depends(require_space_member)],
    responses={404: {"model": ErrorResponse}},
)


@router.get("", response_model=list[AccountRead])
async def list_accounts(space_id: UUID, session: DbSession) -> list[Account]:
    return await service.list_accounts(session, space_id)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=AccountRead)
async def create_account(space_id: UUID, data: AccountCreate, session: DbSession) -> Account:
    return await service.create_account(session, space_id, data)


@router.post(
    "/{account_id}/archive",
    response_model=AccountRead,
    responses={409: {"model": ErrorResponse}},
)
async def archive_account(space_id: UUID, account_id: UUID, session: DbSession) -> Account:
    balance = await transactions_service.get_account_balance(session, space_id, account_id)
    return await service.archive_account(session, space_id, account_id, balance=balance)
```

## 12. Qué se descartó de las fuentes y por qué

| Idea (fuente) | Decisión | Motivo |
|---|---|---|
| Interfaces ABC por repository (artículo, DIP) | No | Una sola implementación y tests con BD real: es ceremonia |
| Service como clase inyectada con `Depends` (artículo) | No | Funciones con `session` (sección 1) |
| `raise ValueError` en el service (artículo) | No | FastAPI lo devuelve como 500; se usan errores de dominio |
| SQL escrito como texto (artículo) | No | `select()` de SQLAlchemy; nunca f-strings en SQL |
| Paginación por offset (`00_pagination`) | No | Con offset se repiten o se pierden filas si entran datos entre páginas; se usa cursor |
| `lru_cache` sobre un endpoint async (`04_caching`) | No | No funciona: guarda la corrutina y la 2.ª llamada falla con `cannot reuse already awaited coroutine` (probado) |
| Auth con decorador (`06_decorator_auth`) | No | Rompe la firma que lee FastAPI y responde 200 cuando falla; se usan dependencias |
| Rate limit en memoria (`07_rate_limiters`) | No | No sirve con varias instancias, y una `HTTPException` lanzada desde un middleware termina en 500 |
| `python-jose` / `passlib` (`10_authentication`) | No | Librerías abandonadas, y el proyecto usa Firebase |
| Singleton con `__new__` (`15_singleton`) | No | Ya resuelto mejor: `lifespan` + `app.state` y `lru_cache` para la config |
| `BackgroundTasks` y colas (`01_apis/03_event_driven`) | No | Cloud Run limita la CPU tras la respuesta; v1 no necesita colas |
| Versionado por URL o header (`02`, `03`) | Más adelante | Un solo cliente que despliega junto con la API y el CI verifica el contrato. Se agrega `/v1` cuando llegue la app móvil, y `deprecated=True` para retirar endpoints |
| Bulk, webhooks, polling, callbacks, HATEOAS, negociación de contenido, SOAP, RPC | No aplica en v1 | Las acciones de negocio (`/confirm`, `/skip`) ya son endpoints explícitos |
