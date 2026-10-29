# Arquitectura del backend

Última actualización: 2026-10-20

Patrones y buenas prácticas del backend (FastAPI + SQLAlchemy async + PostgreSQL), con su porqué. Las reglas cortas que se aplican en cada tarea viven en `backend/CLAUDE.md`; este documento explica las razones y apunta al módulo de referencia (`accounts`, §11). **Léelo al crear un módulo, una capa o un patrón nuevo** (errores, paginación, transacciones, tests de BD).

Fuentes: el artículo *FastAPI Best Practices and Design Patterns* (SOLID, DAO, Service Layer), el repo `Aavache/fastapi-designs`, la documentación oficial (FastAPI 0.142, SQLAlchemy 2.1, Python 3.14, Cloud Run) y pruebas propias contra PostgreSQL. Lo que se descartó de las fuentes está al final, con el motivo.

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

Orden fijo, sin ciclos (de abajo hacia arriba). La fuente de verdad es `ORDER` en `backend/tests/unit/test_module_boundaries.py`: si cambia, se actualizan los dos.

```
users/auth → currencies → spaces → accounts, categories → transactions → recurring, budgets, goals → dashboard
```

Reglas:
1. **El service de un módulo solo llama a services de módulos anteriores** en el orden. Los del mismo nivel (ej. `accounts` y `categories`) no se llaman entre sí.
2. **Los routers pueden combinar services de cualquier módulo.** Son la capa de composición.
3. **De otro módulo solo se importan su `service`, sus `schemas` y (desde la capa HTTP) sus `dependencies`.** Nunca su `repository` ni sus `models`. Los routers y los `dependencies.py` son capa HTTP: pueden combinar el `service` y los `schemas` de cualquier módulo, pero un `dependencies.py` solo puede importar `dependencies` de módulos de nivel inferior (p. ej. `spaces.dependencies` usa `auth.dependencies`). Las FK entre módulos van por nombre (`ForeignKey("spaces.id")`) y no hay `relationship()` entre módulos.
4. **Entre módulos se intercambian schemas (`XRead`) o valores simples, nunca objetos ORM.** Así nadie modifica ni carga relaciones de un modelo ajeno.
5. `tests/unit/test_module_boundaries.py` lo hace cumplir con `ast`, sin dependencias nuevas.

**Cuando un caso de uso necesita datos de un módulo posterior**, el router los obtiene y se los pasa al service, que aplica la regla. Ejemplo ya hecho (KAN-66): el saldo vive en `transactions` (dueño de los `entries`), así que el router de `accounts` lo pide y arma la respuesta. `AccountRead` queda para el service y los demás módulos; la API devuelve `AccountWithBalance`:

```python
# accounts/router.py
accounts = await service.list_accounts(session, space_id, include_archived=include_archived)
balances = await transactions_service.get_account_balances(session, space_id)  # una consulta agrupada
return [_with_balance(a, balances.get(a.id, 0)) for a in accounts]
```

**Si la regla depende de ese dato, importa el orden de los locks.** Archivar una cuenta exige saldo 0 (KAN-67). Si el router lee el saldo y **después** el service bloquea y archiva, un movimiento confirmado entre medio deja una cuenta archivada con saldo. El orden correcto, dentro de la transacción del request:

1. Bloquear la cuenta con `FOR NO KEY UPDATE` (`accounts`).
2. Recién entonces leer el saldo (`transactions`). Quien crea un movimiento lee la cuenta con `FOR SHARE`, así que espera a que termine el archivado o el archivado lo espera a él, y nunca se cruzan.
3. Aplicar la regla ("saldo distinto de 0 → `ConflictError`") y archivar (`accounts`).

La forma elegida (KAN-67): `archive_account` recibe un callable que calcula el saldo, y el service lo llama recién con el lock tomado. El orden queda fijo en un solo lugar y el router no puede equivocarlo:

```python
# accounts/router.py
async def balance_of() -> int:
    return await transactions_service.get_account_balance(session, space_id, account_id)

account = await service.archive_account(session, space_id, account_id, balance_of=balance_of)

# accounts/service.py
account = await _get_for_update_or_raise(session, space_id, account_id)  # 1. FOR NO KEY UPDATE
if account.archived_at is not None:
    return account                                                       # ya archivada: nada
if await balance_of() != 0:                                              # 2. saldo, con el lock
    raise ConflictError(ACCOUNT_HAS_BALANCE, "...")                      # 3. regla
account.archived_at = datetime.now(UTC)
```

La regla siempre queda en `accounts.service`, y el router solo trae el dato. Si un caso de uso necesita muchos datos de arriba, es señal de que pertenece al módulo de arriba: el cuadre de saldo (`reconcile_account`) decide cuánto escribir a partir del saldo y escribe entries, así que vive en `transactions.service` y pide el lock a `accounts.service.get_account_for_update`.

**Una regla de ausencia usa el mismo patrón con otro lock.** La moneda de un espacio solo cambia mientras el espacio no tenga ninguna transacción, borradas incluidas (KAN-68). `update_space` recibe el callable `has_transactions` y el orden queda fijo en `spaces.service`:

```python
# spaces/router.py
async def has_transactions() -> bool:
    return await transactions_service.space_has_transactions(session, space_id)

space = await service.update_space(session, space_id, data, has_transactions=has_transactions)

# spaces/service.py
currency = await currencies_service.get_currency(session, code)       # 422 antes del lock
space = await repository.get_for_update(session, space_id=space_id)   # 1. FOR UPDATE
if space.currency != currency.code:                                   # misma moneda: nada
    if await has_transactions():                                      # 2. con el lock tomado
        raise ConflictError(SPACE_HAS_TRANSACTIONS, "...")            # 3. regla → 409
    space.currency = currency.code
```

Acá el lock es `FOR UPDATE` y no `FOR NO KEY UPDATE`, porque lo que se protege es la **ausencia** de filas hijas (§3). El mismo dato llega a las respuestas: el router agrega `currency_locked` a `SpaceRead` (`_with_currency_locked`), y el service devuelve `SpaceBase`, sin ese campo.

**Lo mismo vale para un efecto en un módulo posterior.** El primer login crea el espacio personal y le siembra las categorías, pero `spaces` no puede llamar a `categories`. Lo compone el router de `auth` (KAN-65), en la misma transacción:

```python
# auth/router.py
created = await spaces_service.ensure_personal_space(session, user.id, data.timezone)
if created:  # solo quien creó el espacio lo siembra
    space_id = await spaces_service.get_personal_space_id(session, user.id)
    await categories_service.seed_default_categories(session, space_id)
```

## 3. Transacciones: una por request

- **La dependencia de sesión es la unidad de trabajo.** `get_session` usa `Depends(..., scope="function")`: si el endpoint termina bien hace `commit()`, si lanza una excepción hace `rollback()`, y las dos cosas ocurren **antes** de enviar la respuesta (doc oficial de FastAPI, *dependencies with yield*). El cliente nunca ve un 200 de algo que no se guardó.
- **Para revertir hay que lanzar, no devolver.** Solo una excepción (en código de negocio, un `AppError`) provoca el rollback; un endpoint que devuelve una respuesta 4xx sin lanzar hace commit.
- Una dependencia con `yield` que use `DbSession` debe declararse también con `scope="function"`: FastAPI no deja que una de scope `"request"` dependa de una de scope `"function"`. Las dependencias sin `yield` no tienen esa restricción.
- **Los services nunca llaman `commit()` ni `rollback()`.** Usan `await session.flush()` cuando necesitan el id generado o detectar una restricción a tiempo.
- Una operación que cruza módulos es una sola transacción por construcción: todos usan la misma sesión del request.
- **Restricciones que pueden fallar por datos del usuario** (UNIQUE): el service hace `flush()` dentro de `try/except IntegrityError` y lanza `ConflictError` con su código. El nombre predecible de la restricción (`uq_...`) permite distinguir cuál fue: asyncpg lo expone como `constraint_name` en el error original (ver `_violated_constraint` en `categories/service.py`). El flush va dentro de `async with session.begin_nested()` (un savepoint): el `IntegrityError` revierte solo ese savepoint y la sesión del request sigue usable. Sin él, la transacción entera queda abortada.
- **Reglas que leen una fila y luego escriben según su estado** (crear una subcategoría exige la principal activa; un movimiento exige la cuenta y la categoría activas): en READ COMMITTED, dos requests pueden leer el mismo estado viejo. Se lee con lock de fila (KAN-65, probado con solapamiento forzado):
  - **Leer y escribir otra fila que depende de ella:** `FOR SHARE` (`with_for_update(read=True)`). La FK de la fila nueva solo toma `FOR KEY SHARE`, que no choca con el UPDATE que cambia el estado (archivar): por eso, sin el lock, la carrera existe.
  - **Leer y modificar la misma fila:** `FOR NO KEY UPDATE` (`with_for_update(key_share=True)`), el mismo lock que el UPDATE toma, mientras no cambie columnas de una clave única referenciada por una FK. `FOR UPDATE` frenaría además las FK de otras tablas.
  - **Leer un dato derivado para decidir cuánto escribir** (el cuadre escribe `saldo real − saldo actual`): también `FOR NO KEY UPDATE`, aunque no se haga UPDATE de la fila. `FOR SHARE` es compatible consigo mismo, así que dos cuadres simultáneos leerían el mismo saldo y escribirían el ajuste dos veces, y tampoco esperaría a un movimiento en vuelo, así que el saldo leído no lo incluiría (KAN-67). Pedir después `FOR SHARE` sobre la misma fila en la misma transacción no espera: los locks propios no chocan.
  - **Decidir por la ausencia de filas hijas y cambiar el padre** (la moneda del espacio solo cambia sin transacciones, KAN-68): `FOR UPDATE` completo (`with_for_update()`) sobre el padre, y recién después la consulta `EXISTS`. Cada INSERT de un hijo toma `FOR KEY SHARE` sobre el padre por su FK, y solo `FOR UPDATE` choca con ese lock. Si una transacción se está escribiendo, el cambio la espera y la ve (409). Si llega después, espera al cambio y se guarda con la moneda nueva. Con `FOR NO KEY UPDATE`, una transacción en curso pasaría sin ser vista (`tests/db/test_space_currency_concurrency.py` falla con ese lock). El costo: durante el cambio, que dura milisegundos, también esperan los INSERT de cuentas, categorías y miembros del espacio, porque su FK toma el mismo `KEY SHARE`.
  - **Nunca UPDATE de una fila leída con `FOR SHARE`** en la misma transacción: dos transacciones con el SHARE que intenten actualizarla se bloquean entre sí (deadlock).
  - Quien cambia el estado actualiza primero esa fila y después sus dependientes, y todos los caminos toman los locks en el mismo orden (principal y luego subcategoría): así no hay ciclos.
  - Con `populate_existing()`, la lectura refleja la fila recién bloqueada y no la copia que la sesión ya tenía.
- Fuera de HTTP (scripts, seeds): se abre `db.sessionmaker()` y se hace commit explícito.

## 4. Errores (`app/core/errors.py`)

Los services lanzan **errores de dominio**; un handler registrado en `create_app` los convierte en HTTP.

| Error | Status | Cuándo | Respuesta |
|---|---|---|---|
| `NotFoundError` | 404 | El recurso de la ruta no existe o no es del espacio (incluye "no eres miembro"); un id ajeno en el cuerpo da 422, ver §6 | `{"detail": "...", "code": "account_not_found"}` |
| `ConflictError` | 409 | Choca con el estado actual: duplicado, archivar con saldo, cuadrar una cuenta archivada, cambiar la moneda de un espacio con movimientos (`space_has_transactions`), confirmar algo ya confirmado | `{"detail": "...", "code": "account_has_balance"}` |
| `UnauthenticatedError` | 401 | Sin sesión o sesión inválida | `{"detail": "...", "code": "not_authenticated"}` |
| `InvalidFieldError` | 422 | Validación que necesita la BD: categoría de otro tipo, cuenta archivada | **Mismo formato que la validación de FastAPI**: `{"detail": [{"type": "transaction_category_kind_mismatch", "loc": ["body", "expense", "category_id"], "msg": "..."}]}` (el tipo en el `loc` es propio de una unión discriminada, ver abajo) |

- `detail` en inglés y `code` estable en snake_case (`<entidad>_<problema>`). El frontend traduce `code` (o `type` en los 422) a un mensaje en español. Un código nuevo implica agregar su traducción, y un código existente nunca se renombra.
- El 422 tiene un solo formato, venga de Pydantic o del service, así que el frontend puede marcar el campo con error en el formulario.
- **`loc` en una unión discriminada (KAN-74).** Pydantic mete el tag en la ubicación: un error del cuerpo de `POST /spaces/{id}/transactions` sale en `["body", "expense", "category_id"]`, no en `["body", "category_id"]`. El service construye el mismo `loc` (`("body", data.type, campo)` en `_check_accounts` y `_check_category`), así cada campo tiene un solo camino, sea cual sea la regla que lo rechaza. `validationIssuesOf` del frontend solo quita el `body` inicial, así que entrega `expense.category_id`: el formulario quita el tipo o registra sus campos con ese prefijo.
- Las validaciones que no necesitan la BD van en el schema (Pydantic → 422 automático). Ejemplo: en una transferencia, origen y destino deben ser cuentas distintas.
- Si un dato del usuario puede violar un CHECK de la BD (que daría un 500), el service lo valida antes y lanza `InvalidFieldError` con su `loc`. Ejemplo: el cuadre rechaza una diferencia mayor que `MAX_SAFE_INTEGER` con 422 `balance_out_of_range` en `balance_minor`, antes de que falle `ck_entries_amount_range` (KAN-67).
- `account_archived` sale como 422 al crear un movimiento (la cuenta va en el cuerpo, con `loc`) y como 409 en el cuadre (la cuenta va en la ruta). Los dos son a propósito.
- Errores no previstos → 500 con `{"detail": "Internal server error", "code": "internal_error"}`, sin trazas ni SQL. El `X-Request-ID` permite encontrarlos en los logs.
- En código nuevo no se usa `HTTPException`: siempre un `AppError`.
- Los endpoints documentan sus errores con `responses={404: {"model": ErrorResponse}}` para que el cliente TypeScript los conozca.

## 5. Schemas y validación

- **Un schema por uso:** `AccountCreate`, `AccountUpdate` (PATCH: se aplica con `model_dump(exclude_unset=True)`) y `AccountRead`.
- Bases comunes (`app/core/schemas.py`): `InputModel` con `extra="forbid"` (un campo desconocido da 422, lo que atrapa errores del cliente), `ReadModel` con `from_attributes=True` y `PatchModel` para los PATCH.
- **PATCH (`PatchModel`, KAN-64):** cada campo se declara `Tipo = unset()`, sin `| None`. Así OpenAPI y los tipos TS dicen `name?: string` (no `string | null`), y un `null` explícito da 422 `null_not_allowed` con el `loc` del campo; un campo que sí se puede vaciar se declara `Tipo | None = None`. `unset()` devuelve `Any` porque el plugin `pydantic.mypy` rechaza `default=None` en un campo no nullable: por eso un PATCH se lee **solo** con `model_dump(exclude_unset=True)`, nunca con atributos sueltos. En un `PatchModel` no se usa `validate_default=True`; las reglas entre campos o que dependen de lo guardado van en el service. Se descartó `SkipJsonSchema[None]`: convierte el campo en una unión y el 422 sale con `loc` `["body", "name", "constrained-str"]` más un error `none_required` espurio. `tests/unit/test_patch_model.py` vigila todas las subclases.
- **Dinero:** un tipo común `Amount = Annotated[int, Field(strict=True, gt=0, le=2**53 - 1)]` (`app/core/schemas.py`), expresado en la **unidad menor de la moneda del espacio** (ISO 4217: valor × 10^exponente, no siempre centavos). El exponente sale de la tabla `currencies`, que el API expone junto a `currency` (KAN-22).
  - `strict` rechaza `"1550"`, `15.0` y `true` (verificado con Pydantic 2.13).
  - El tope es `Number.MAX_SAFE_INTEGER`: JavaScript pierde precisión por encima, aunque `bigint` admita más.
  - El signo lo pone el backend según el tipo de movimiento, nunca el cliente.
  - Tres tipos comparten el tope `MAX_SAFE_INTEGER` en valor absoluto: `Amount` (> 0, un monto de movimiento), `SignedAmount` (con signo y distinto de 0, error `amount_zero`: el delta del saldo de un ajuste) y `Balance` (con signo y **admite 0**, un saldo como se lee: el `initial_balance_minor` al crear una cuenta y el `balance_minor` del cuadre, KAN-67). `Balance` lleva el signo de `balance_minor`: en una tarjeta, deuda = negativo.
- **Crear una transacción:** unión discriminada por `type`. Cada tipo valida solo sus campos y el OpenAPI y los tipos TS lo reflejan:

  ```python
  TransactionCreate = Annotated[
      ExpenseCreate | IncomeCreate | TransferCreate | AdjustmentCreate,
      Field(discriminator="type"),
  ]
  ```

  `TransactionCreate` es lo que acepta el service. **El cuerpo de la API es otra unión, más chica** (KAN-74): `MovementCreate` = gasto | ingreso | transferencia, **sin ajuste**. Un `type: "adjustment"` da 422 `union_tag_invalid`. Los ajustes los fechan y calculan el saldo inicial y el cuadre (`create_adjustment`, `reconcile_account`), con su lock; un `POST` libre de ajustes se saltaría ambas cosas. Regla general: si un tipo interno no lo puede crear el cliente, la API expone una unión propia en vez de rechazarlo en el router.

- **Respuesta:** el router declara `response_model=AccountRead` y devuelve el objeto ORM. FastAPI lo filtra y serializa, y mypy queda conforme con `-> Account`.
- **Rutas sin barra final:** con `prefix`, la colección se declara con `@router.get("")`, no con `"/"` (que genera `/accounts/`; como la app usa `redirect_slashes=False`, `/accounts` daría 404 en vez de un 307). `tests/api/test_routing.py` vigila que ninguna ruta termine en `/`.
- **Fechas:** la fecha de una transacción es `date`; los momentos son `datetime` con zona (UTC). `spaces.timezone` se valida con `zoneinfo.ZoneInfo` (si es inválida, 422). La fecha de un ajuste la pone solo `transactions.service.create_adjustment`: el día local del espacio (`spaces.timezone`) en el `now` que le pasa el router (KAN-67).
- **Valores tipo enum** (`expense`, `bank`...): en los schemas, `Literal` o `StrEnum`. En la BD se guardan como `text` + `CheckConstraint` con nombre (`ck_<tabla>_<nombre>`), no como ENUM nativo de PostgreSQL: cambiar los valores es una migración simple y no hay tipos que mantener fuera de la tabla. Ojo: el `Enum` de SQLAlchemy guarda por defecto el **nombre** del miembro (`BANK`), no su valor; si se usa, hay que pasar `values_callable`.

## 6. Espacios, IDOR y seguridad

- **`require_space_member` se declara en el `APIRouter`** (`dependencies=[Depends(require_space_member)]`), no en cada endpoint: toda ruta del router queda protegida aunque alguien olvide ponerlo. Si el endpoint necesita la membresía (ej. el rol), la vuelve a declarar como parámetro; FastAPI la resuelve una sola vez por request.
- **Defensa en profundidad:** toda función de repository recibe `space_id` y filtra por él. `get(session, space_id, account_id)`, nunca `get(session, account_id)`. Un recurso de otro espacio da el mismo 404 que uno inexistente.
- **Un id de otro espacio en el cuerpo da 422, no 404 (KAN-74).** El 404 `space_not_found` es para el espacio de la ruta. Una cuenta o categoría ajena enviada en el cuerpo responde 422 `account_not_found` / `category_not_found` con su `loc`, idéntico a un id inexistente: no filtra que exista y el formulario marca el campo. `tests/api/test_transactions.py` compara las dos respuestas.
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

Son funciones puras, así que reglas como "una transferencia suma cero" se prueban en `tests/unit` sin BD. Editar una transacción = volver a llamar `build_entries` y reemplazar sus entries. Ya existe en `transactions/entries.py` (KAN-66), con `EntryDraft` como `dataclass` congelada. El cliente nunca manda los entries ni el signo: el ajuste es el único monto con signo de la API (`SignedAmount`, un delta del saldo).

**Borrado suave en un solo lugar.** El repository tiene una consulta base que siempre agrega el filtro, y el resto parte de ella. Para los saldos es `_counted_entries` (KAN-66): solo cuentan los entries de transacciones `confirmed` y sin `deleted_at`.

```python
def _counted_entries(space_id: UUID) -> Select[Entry]:
    return (
        select(Entry)
        .join(Transaction, and_(Transaction.id == Entry.transaction_id,
                                Transaction.space_id == Entry.space_id))
        .where(Entry.space_id == space_id,
               Transaction.status == "confirmed",
               Transaction.deleted_at.is_(None))
    )
```

La lista de movimientos tiene su propia base `_active` (KAN-79): espacio + sin `deleted_at`, en cualquier estado (los pendientes y saltados se listan con su `status`). Lo que cuenta para un total o un saldo lo decide cada consulta: el resumen (`income_and_expense`) y el saldo tras el movimiento (`balances_after`) solo suman `confirmed`. `SUM(bigint)` es `numeric` en PostgreSQL y asyncpg lo devuelve como `Decimal`, así que el repository lo convierte a `int`: el dinero nunca sale como `Decimal`.

**Mismo espacio garantizado por la BD (FK compuestas por espacio).** Una tabla que referencia filas de otras tablas del espacio repite `space_id` y apunta a `(id, space_id)`, no solo a `id`. En `entries` (KAN-66), las FK `(transaction_id, space_id)`, `(account_id, space_id)` y `(category_id, space_id)` exigen un `UNIQUE (id, space_id)` en `transactions`, `accounts` y `categories`. Si un service olvida validar, la BD rechaza un entry que mezcle espacios en lugar de dejar que falsee un saldo o filtre datos ajenos (IDOR). El service igual valida antes, para responder un 422 con `loc`. Un `category_id` NULL salta su FK (MATCH SIMPLE). Las tablas futuras con referencias (`recurring_templates`, `budgets`, `goal_allocations`) lo adoptan al crearse; `goal_allocations` necesitará su propia columna `space_id`.

**Locks de saldo.** Toda operación que escribe movimientos o cambia el saldo de una cuenta (crear, confirmar, restaurar, editar) lee las cuentas afectadas con `FOR SHARE` (`accounts.service.get_account_for_share`), en orden fijo por id, y no hace UPDATE de esas filas en la misma transacción. Las dos operaciones que deciden a partir del saldo, archivar y cuadrar (KAN-67), toman `FOR NO KEY UPDATE` y solo después calculan el saldo (§2, §3): un movimiento en vuelo las hace esperar, uno posterior las espera a ellas, y dos cuadres o dos archivados de la misma cuenta van en fila. La categoría de un movimiento se lee sin lock: los movimientos viejos conservan las categorías archivadas, así que no hay invariante que proteger. Se prueba con solapamiento forzado (`tests/overlap.py`, `tests/db/test_account_archive_concurrency.py` y `tests/db/test_account_reconcile_concurrency.py`) y, sin depender de tiempos, con `NOWAIT` (`tests/db/test_transaction_account_lock.py`).

**Paginación por cursor** (orden `date desc, id desc`; `GET /spaces/{id}/transactions`, KAN-79):
- Parámetros como modelo de query: `filters: Annotated[TransactionListFilters, Query()]`, con `extra="forbid"`, `limit` entre 1 y 100 (50 por defecto) y `cursor` opcional. `TransactionListFilters` extiende `TransactionFilters` (los filtros sin paginación), que usa también el resumen; por eso `/summary?limit=` da 422.
- El cursor es opaco: base64 url-safe de `"YYYY-MM-DD|uuid"` del último elemento (`transactions/cursor.py`, puro). Si no se puede decodificar, 422 `cursor_invalid` con `loc ["query", "cursor"]` (lo valida un `field_validator`). Es solo una posición: la consulta siempre filtra por `space_id`.
- Consulta: `where(tuple_(Transaction.date, Transaction.id) < (cursor_date, cursor_id))`, con `order_by(date desc, id desc)` y `limit(limit + 1)`. Si vuelve una fila de más, hay página siguiente.
- Respuesta genérica en `app/core/schemas.py`: `class Page[T](BaseModel): items: list[T]; next_cursor: str | None`. Cada módulo la nombra con una subclase (`class MovementPage(Page[MovementListItem])`) para que OpenAPI y los tipos TS no salgan como `Page_X_`.
- Filtros que miran los entries (cuenta, categoría) van en un `EXISTS` sobre `entries`, así la fila de la transacción no se duplica. Una categoría principal se resuelve antes a sus ids + los de sus subcategorías (`categories.service.category_ids_with_subcategories`); una cuenta o categoría ajena o inexistente da lista vacía, no 422.
- Los totales del período (`count`, ingresos, gastos, "te quedan") van en un endpoint aparte, `GET /spaces/{id}/transactions/summary`, con los mismos filtros: las páginas siguientes no recalculan agregados.
- Saldo tras cada movimiento (solo con `account_id`): suma acumulada `SUM(delta) OVER (ORDER BY date, id)` sobre el historial contado de la cuenta, agregado antes por transacción, y filtrada por los ids de la página en una consulta exterior (el WHERE se evalúa antes que la ventana). No depende de los demás filtros. Si pesara en cuentas con mucho historial: saldo actual menos lo más nuevo que la página.
- Cuentas y categorías embebidas: 2 consultas por página a los services de esos módulos (como schemas `XRead`, nunca ORM), sin N+1.
- Índice: `(space_id, date DESC, id DESC) WHERE deleted_at IS NULL`. Al ser parcial, no le sirve a una consulta que también debe ver las borradas. Por eso "¿el espacio tiene alguna transacción?" (la regla de la moneda, KAN-68) usa el índice completo `ix_transactions_space_id`.
- El orden es fijo. Si algún día el cliente elige el orden, se mapea un `Literal` a columnas conocidas; nunca `getattr(Model, texto_del_cliente)`.

**Cron idempotente.** `insert(...).on_conflict_do_nothing(constraint="uq_transactions_template_id_period").returning(Transaction.id)` (dialecto `postgresql`). Solo se crean entries para los ids devueltos. Correrlo dos veces el mismo día no duplica nada.

**Siembra idempotente** (`categories.service.seed_default_categories`, KAN-65): mismo recurso. Si el espacio ya tiene alguna fila no hace nada (nunca se borra, solo se archiva). Inserta las principales con `on_conflict_do_nothing()`, que se apoya en el índice único de nombre, y cuelga las subcategorías de los ids que **de verdad** quedaron en la BD, no de los que generó. Dos siembras cruzadas terminan con un solo juego de filas y ninguna FK rota.

**Estructura en la BD con una FK compuesta sobre columnas generadas** (`categories`, KAN-65). La regla "dos niveles, mismo `kind` y mismo espacio que la principal" no la cubre una FK simple. Dos columnas generadas almacenadas (`is_main = parent_id IS NULL`, `has_parent = parent_id IS NOT NULL`), un `UNIQUE (id, space_id, kind, is_main)` y la FK `(parent_id, space_id, kind, has_parent) → (id, space_id, kind, is_main)` hacen que el padre deba ser una principal del mismo espacio y del mismo tipo. Una principal no se valida, porque su `parent_id` es NULL. El service valida lo mismo antes, para responder un 422 con `loc`; la BD es la red de seguridad.

**Migración de datos con copia congelada** (`0004`): una migración que siembra datos lleva su propia copia de la lista y no importa código de `app`. Si la lista cambia en el código, lo que hizo una revisión vieja no cambia. Como lee filas existentes, no se puede renderizar con `--sql`, y lo dice con un error claro.

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
| `tests/db` | Engine, pool, Connector, sesión, migraciones | BD nueva por test (`scratch_database_url`); los tests de las fixtures de savepoint usan `session` |

- **Savepoint por test.** La BD de test se migra una vez por sesión de pytest. Cada test corre dentro de una transacción externa, con la sesión en `join_transaction_mode="create_savepoint"`: los `commit()` del código se convierten en savepoints y al final todo se revierte (receta oficial de SQLAlchemy, probada con `AsyncSession` + asyncpg + PostgreSQL 16). Es mucho más rápido que crear una BD por test.
- **Tests de API:** se sobreescribe (`app.dependency_overrides`) la fábrica de sesiones (`get_sessionmaker`) para que use la conexión del test. Así corre el commit/rollback real de `get_session`. El usuario autenticado también se sobreescribe; unos pocos tests de auth usan el emulador de Firebase de punta a punta.
- **Datos:** funciones async de ayuda (`await make_space(session, ...)`), sin librerías de factories. Cada test crea lo suyo.

## 11. Módulo de referencia: `accounts`

El primer módulo real es `backend/app/modules/accounts` (KAN-64). Para crear uno nuevo, cópialo como modelo en lugar de partir de cero. Las columnas completas están en `docs/modelo-de-datos.md`, y las reglas cortas, en `backend/CLAUDE.md`.

| Archivo | Qué muestra |
|---|---|
| `models.py` | Tabla con FK por nombre (`ForeignKey("spaces.id", ondelete="RESTRICT")`) e índice, `text` + `CheckConstraint` con nombre para el tipo y las reglas entre columnas (`ck_accounts_card_days`), UUIDv7 y `created_at`/`updated_at` |
| `schemas.py` | `AccountCreate` (reglas entre campos con `field_validator` + `info.data` + `validate_default=True`, para que el `loc` marque el campo), `AccountUpdate` (hereda de `PatchModel`, ver §5) y `AccountRead` |
| `repository.py` | `_in_space(space_id)` como única consulta base y funciones con `*, space_id` keyword-only (§6) |
| `service.py` | Sin commit (`flush`), `_get_or_raise` → `NotFoundError`, una regla que depende de lo guardado (`InvalidFieldError` con `loc`) y `get_account` devolviendo un schema para otros módulos (§2) |
| `router.py` | `require_space_member` en el `APIRouter`, rutas sin barra final, `response_model` devolviendo el ORM y `responses` con los errores |
| `migrations/versions/20261018_0003_create_accounts.py` | Migración autogenerada y revisada a mano: nombres con `op.f(...)` y downgrade real |
| `tests/unit/test_account_schemas.py`, `tests/services/test_accounts_service.py`, `tests/api/test_accounts.py`, `tests/db/test_accounts_migration.py` | Una carpeta por capa (§10). En `api`, los 401 y los dos casos de IDOR: espacio ajeno → `space_not_found`, cuenta ajena desde el propio espacio → `account_not_found` |

Lo que aún no muestra: la paginación por cursor (§7), porque una lista de cuentas no se pagina. Archivar con saldo 0 llegó con KAN-67 (tabla de abajo).

`backend/app/modules/categories` (KAN-65) suma los patrones que `accounts` no tiene:

| Patrón | Dónde | Sección |
|---|---|---|
| Composición desde el router en el primer login | `auth/router.py` | §2 |
| `IntegrityError` → 409 por nombre de restricción, en un savepoint | `categories/service.py` (`_flush_checking_the_name`) | §3 |
| Locks de fila `FOR SHARE` / `FOR NO KEY UPDATE` | `categories/repository.py` (`get_for_share`, `get_for_update`) y `tests/db/test_category_archive_concurrency.py` | §3 |
| Siembra idempotente y migración de datos con copia congelada | `categories/service.py`, `defaults.py` y `migrations/versions/20261020_0004_create_categories.py` | §7 |
| FK compuesta sobre columnas generadas e índices únicos parciales por `lower(name)` | `categories/models.py` | §7 |
| Lista fija como `Literal` en la API y solo formato en la BD (íconos) | `categories/icons.py` | §5 |

`backend/app/modules/transactions` (KAN-66) suma:

| Patrón | Dónde | Sección |
|---|---|---|
| Router que compone datos de un módulo posterior (cuenta + saldo) | `accounts/router.py` (`AccountWithBalance`) | §2 |
| Estrategia por tipo con `match` + `assert_never`, función pura | `transactions/entries.py` (`build_entries`) | §7 |
| Unión discriminada por `type` para crear un movimiento | `transactions/schemas.py` (`TransactionCreate`) | §5 |
| Consulta base de los saldos y `SUM` convertido a `int` | `transactions/repository.py` (`_counted_entries`) | §7 |
| FK compuestas por espacio y `UNIQUE (id, space_id)` | `transactions/models.py` y `migrations/versions/20261021_0005_create_transactions_and_entries.py` | §7 |
| `FOR SHARE` sobre las cuentas al escribir movimientos, probado con `NOWAIT` | `transactions/service.py` y `tests/db/test_transaction_account_lock.py` | §7 |
| Helper que inserta movimientos en estados sin ruta de creación (pendiente, saltado, borrado) | `tests/transactions_helpers.py` (`insert_transaction`) | §10 |

Saldo inicial, cuadre y archivado de cuentas (KAN-67) suman:

| Patrón | Dónde | Sección |
|---|---|---|
| Router que compone un efecto en un módulo posterior en la misma transacción (cuenta + ajuste del saldo inicial) | `accounts/router.py` (`create_account`) | §2 |
| Regla con un dato de un módulo posterior, pedido con el lock tomado (callable `balance_of`) | `accounts/service.py` (`archive_account`) | §2 |
| `FOR NO KEY UPDATE` para decidir cuánto escribir a partir del saldo | `transactions/service.py` (`reconcile_account`) y `accounts/service.py` (`get_account_for_update`) | §3 |
| Un solo lugar que fecha los ajustes (día local según `spaces.timezone`, con `now` inyectado) | `transactions/service.py` (`create_adjustment`) | §5 |
| Guarda de rango antes de un CHECK de la BD, para dar 422 y no 500 | `transactions/service.py` (`reconcile_account`, código `balance_out_of_range`) | §4 |
| Helper de solapamiento forzado: consulta `pg_stat_activity` hasta ver al segundo esperando un lock, sin esperas fijas | `tests/overlap.py` (`overlap`) | §10 |

La moneda del espacio (KAN-68) suma:

| Patrón | Dónde | Sección |
|---|---|---|
| Regla de ausencia de filas hijas: `FOR UPDATE` sobre el padre y después el callable `has_transactions` | `spaces/service.py` (`update_space`) y `spaces/repository.py` (`get_for_update`) | §2, §3 |
| Campo derivado de un módulo posterior en la respuesta: el service devuelve `SpaceBase` y el router agrega `currency_locked` (`SpaceRead`) | `spaces/schemas.py` y `spaces/router.py` (`_with_currency_locked`) | §2 |
| Índice completo además del parcial del listado, para una consulta que también ve las filas borradas | `migrations/versions/20261021_0006_add_transactions_space_id_index.py` | §7 |

Crear movimientos (KAN-74) suma:

| Patrón | Dónde | Sección |
|---|---|---|
| Unión pública más chica que la interna (`MovementCreate` sin ajuste) | `transactions/schemas.py` | §5 |
| `loc` con el tag de la unión también en los errores del service | `transactions/service.py` (`_check_accounts`, `_check_category`) | §4 |
| Id ajeno en el cuerpo: 422 idéntico a inexistente; 404 solo para la ruta | `tests/api/test_transactions.py` | §6 |

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
