# Personal Finance App — Decisiones de producto
 
Última actualización: 2026-11-24
 
## Visión
App de finanzas personales, alternativa moderna a las hojas de cálculo. Usuarios cotidianos que quieren llevar su dinero sin depender de apps bancarias. Web responsive primero, **pensada para escritorio** y adaptada al celular (decidido el 2026-10-21); app móvil después.
 
## Decisiones
 
| Tema | Decisión |
|---|---|
| Registro | Manual y muy rápido (botón "+" siempre visible) |
| Plantillas | Suscripciones y cuotas generan movimientos **pendientes** que el usuario confirma, edita, salta o cancela. No afectan el saldo hasta confirmarse. Sección "Pendientes" en vez de una notificación por pago. |
| Cuotas | Se registra la compra una vez (monto + n.º de cuotas); la plantilla genera una cuota pendiente al mes y termina sola. Mostrar "cuotas futuras comprometidas". |
| Cuentas | Varias (bancos, efectivo, tarjetas). Saldo global: **Disponible · Deuda tarjetas · Neto**. Tarjeta = deuda. |
| Tipos de movimiento | Gasto, Ingreso, Transferencia, **Ajuste**. Pagar la tarjeta = transferencia (no gasto). El gasto cuenta al comprar. Ajuste = saldo inicial y cuadre con el banco; no cuenta en reportes. |
| Moneda | Nivel 0: una moneda **por espacio**, de una lista de monedas soportadas (tabla `currencies`, con su exponente ISO 4217). Cada transacción la hereda; preparado para multimoneda. El primer login crea el espacio en UYU; el usuario elige la moneda (primer uso o Ajustes) solo mientras el espacio no tenga movimientos, y después queda fija. |
| Zona horaria | Por espacio (`spaces.timezone`, ej. `America/Montevideo`). Momentos en UTC (`timestamptz`); fecha de una transacción como `date` local. |
| Nombre de usuario | `users.display_name` es opcional. Si es `NULL`, la interfaz muestra la parte local del email (lo anterior a `@`); no se guarda un valor derivado. |
| Categorías | Predefinidas y editables, con subcategorías (2 niveles). Cada una lleva un ícono de una lista fija (columna `icon`): las predefinidas traen el suyo y al crear una se elige. |
| Primer uso | Sin onboarding guiado ni cuentas creadas solas: el Inicio vacío invita a crear la primera cuenta con su saldo actual (se registra como ajuste), y "+" sin cuentas lleva al mismo formulario. |
| Espacios | Los datos pertenecen a un **espacio**; los usuarios son miembros. "Mi espacio" privado + espacios de hogar con cuentas propias. Aporte personal → hogar = gasto "Aporte al hogar" + ingreso en el hogar (enlazados). Sin división de deudas. |
| Dashboard | (A) Disponible/Deuda/Neto · (B) Top 5 gastos del mes por categoría principal · (D) Pendientes y cuotas futuras. En escritorio, además, la evolución del neto (6 meses) e ingresos y gastos por mes (decidido el 2026-10-21, H1). En el H2 se suman «Libre para gastar», dentro de Disponible y solo si hay algo apartado, y una tarjeta con hasta 3 presupuestos en «Cerca» o «Excedido» (decidido el 2026-11-24). |
| Presupuestos | Límite mensual por **categoría principal de gasto** (las subcategorías suman a su principal), con barra de progreso. Lo gastado sigue la regla del top 5 del Inicio: gastos confirmados y sin borrar de todo el mes; ajustes, transferencias e ingresos no cuentan. Un límite igual todos los meses, sin traspasar lo que sobra; la pantalla muestra el mes en curso. Estados: normal, «Cerca» desde el 80 % (en el 100 % justo dice «Llegaste al límite», con el estilo de «Cerca») y «Excedido» por encima del 100 % («Te pasaste por $X»), sin notificaciones. Arriba, un resumen: total presupuestado, gastado, lo que queda y «Sin presupuesto» (lo gastado en categorías sin límite). Borrar un presupuesto es borrado real (es configuración, no dinero); el de una categoría archivada se oculta y vuelve al desarchivarla. Decidido el 2026-11-24. |
| Metas de ahorro | Apartados virtuales **repartidos en una o varias cuentas** (solo banco/efectivo, nunca tarjeta). Libre para gastar = Disponible − apartado. No se aparta más de lo libre de la cuenta (saldo − lo ya apartado). Si un gasto o una transferencia deja el saldo por debajo de lo apartado en esa cuenta, se permite, se avisa y la app pregunta si usó dinero de una meta, para liberar con un toque; en los demás gastos y transferencias no pregunta, y cada meta tiene «Liberar» para usar su dinero a propósito (cambiado el 2026-11-24: antes preguntaba en todo gasto desde una cuenta con apartados, y eso molestaría a diario). Un cuadre de saldo que deja la cuenta por debajo de lo apartado solo avisa, sin preguntar: corrige el saldo según el banco, no es un gasto. Liberar queda en el historial de la meta y no se enlaza con el movimiento: borrar el gasto después no devuelve lo apartado. Al llegar al 100 % la meta queda «¡Cumplida!»; archivarla libera todo y no se borra. Con fecha objetivo muestra «Aparta $X por mes para llegar». Una transferencia no mueve lo apartado, y una cuenta con apartados no se puede archivar. |
| Navegación del H2 | Presupuestos y Metas van en la barra lateral de escritorio y en «Más» en el celular; la barra inferior no cambia hasta Pendientes (H3), que toma el lugar de Cuentas (decidido el 2026-11-24). |
| Editar/borrar | Edición libre de transacciones confirmadas; borrado suave (`deleted_at`) con "Deshacer". Historial de cambios en v2. |
| Identidad | Nombre **Kanza** (de "¿me al-kanza?"); lema "Haz que alcance"; mercado: toda Latinoamérica. Ícono: grillo verde menta asomado sobre una moneda gigante, sobre baldosa verde bosque `#146e4d` ("B2 · Detrás de la moneda"), igual en claro y oscuro. Mascota: el grillo (cabeza asomada en el login; el de cuerpo entero quedó archivado). Favicon: versión simplificada para menos de 32 px. Logotipo en Bricolage Grotesque ExtraBold, solo para la marca. Definido el 2026-10-06; guía en [`frontend/docs/marca-kanza.md`](../frontend/docs/marca-kanza.md). Estados vacíos con el grillo: **sí en v1** (decidido el 2026-10-18 en KAN-63; detalle en `frontend/docs/diseno.md` D16). Avisos del grillo: se deciden en el Hito 3, con Pendientes. Fuera de v1: pantalla de carga y registro de marca. |
 
## Roadmap
- **v1:** registro, cuentas, transferencias, ajustes, categorías, presupuestos y metas de ahorro, plantillas, cierre y vencimiento de tarjetas, dashboard (A, B, D). Estructura de espacios preparada. Presupuestos y metas eran la v1.1 y pasaron a la v1 el 2026-11-24.
- **v2:** hogares compartidos, historial de cambios.
- **Futuro:** multimoneda, app móvil (React Native), importar extractos, dividir compras (UI).
Plan de construcción por hitos: en Jira (proyecto KAN; cada épico es un hito). Reparto acordado el 2026-10-17 y reordenado el 2026-11-24: H1 registro diario (cuentas, categorías, movimientos, dashboard A y B con sus gráficos de escritorio) · H2 presupuestos y metas de ahorro · H3 pendientes y cuotas (plantillas, cron, dashboard D) · H4 tarjetas, Ajustes y producción · H5 v2. Presupuestos y metas van primero porque solo dependen de lo que hizo el H1, y así la pregunta de metas queda diseñada antes de los otros flujos que pueden dispararla (confirmar un pendiente y pagar la tarjeta); Pendientes va antes que Tarjetas porque las cuotas en tarjeta entran en el monto a pagar.
 
## Decisiones técnicas
Contexto: desarrollador solo (semi senior fullstack Python/React/DB/cloud). Proyecto personal/de aprendizaje con miras a producto real.
 
| Capa | Decisión |
|---|---|
| Arquitectura | **Monolito modular** en el backend; frontend y backend separados, comunicados por API |
| Frontend | **Next.js** + TypeScript (Server Components), en **Vercel**. Librerías, tokens y dirección visual: [`frontend/docs/diseno.md`](../frontend/docs/diseno.md) |
| Backend | FastAPI (Python) en **Cloud Run** |
| Base de datos | PostgreSQL en **Cloud SQL** |
| ORM / migraciones | **SQLAlchemy 2.0 async (asyncpg) + Alembic** |
| Autenticación | **Firebase Authentication** + cookie de sesión HttpOnly emitida y verificada por FastAPI |
| Tareas programadas | **Cloud Scheduler** → endpoint idempotente que genera pendientes |
| Repositorio | **Monorepo** (`/frontend`, `/backend`, `/infra`) |
| Entornos | **local** (Docker: PostgreSQL + emulador de Firebase Auth) · **staging** · **prod**. Staging en proyecto GCP/Firebase separado, instancia Cloud SQL mínima detenible. |
| CI/CD | **GitHub Actions**. PRs obligatorios con `main` protegida. Merge → staging automático. Prod por **promoción manual** de la misma imagen. |
| Región | **São Paulo**: GCP `southamerica-east1` (Cloud Run, Cloud SQL, Artifact Registry, Cloud Scheduler) y Vercel `gru1` para las funciones. Todo en la misma región. |
 
Reglas:
- Dinero en `bigint` en la **unidad menor de su moneda** (ISO 4217: 10^exponente; USD/UYU/COP ×100, CLP/PYG ×1), nunca `float`. Las monedas soportadas y su exponente viven en una única tabla; sumar una moneda es agregar un dato.
- Un solo backend: Next.js nunca toca la BD.
- Rewrite `/api/*` → Cloud Run en `frontend/next.config.ts` (funciona igual en local y en Vercel).
- Plan Hobby de Vercel = no comercial.
- **Código y BD en inglés** (snake_case, tablas en plural); interfaz en español.
### Monolito modular (backend)
Una app FastAPI, una BD, un despliegue; módulos de dominio: `spaces`, `accounts`, `categories`, `transactions`, `recurring`, `dashboard` (H2: `budgets`, `goals`). Capas por módulo: router → service → repository. Un módulo usa a otro solo vía su service. Operaciones que cruzan módulos van en una sola transacción de BD.
 
### Base de datos: reglas de trabajo
- Modelos ORM (SQLAlchemy) separados de los schemas de la API (Pydantic).
- Async: cargar relaciones explícitamente (`selectinload`); nunca depender de lazy loading.
- Migraciones Alembic revisadas a mano; nunca editar una aplicada.
- Migraciones como paso separado (Cloud Run Job) antes de desplegar, nunca al arrancar la app.
- Reglas críticas también como restricciones de BD (CHECK, UNIQUE, FK).
- Pool de conexiones pequeño (2–5 por instancia de Cloud Run).
### Testing
- **Alto:** reglas de negocio en services (pytest): transferencias suman cero, saldo ignora pendientes/borrados, idempotencia del cron, monto a pagar de tarjeta, fin de cuotas.
- **Alto:** API (pytest + cliente HTTP): contratos, 422 en datos inválidos, **tests de IDOR**.
- **Bajo:** 3–5 E2E con Playwright.
- **Mínimo:** tests de componentes solo para lógica no trivial.
- **PostgreSQL real en tests**. Nunca SQLite.
### Pipeline
- **PR (CI):** ruff + mypy · eslint + tsc · tests backend con PostgreSQL · `alembic upgrade` sobre BD vacía · regenerar tipos TS desde OpenAPI y fallar si difieren · preview de Vercel.
- **Merge a main (CD):** build imagen → Artifact Registry → job de migraciones en staging → deploy Cloud Run staging.
- **Prod:** tag/aprobación manual → migraciones prod → deploy de la misma imagen.
- **GitHub → GCP con Workload Identity Federation**, nunca llaves JSON.
## API
- **REST**. OpenAPI generado por FastAPI → tipos TypeScript generados para Next.js.
- **Espacio en la URL:** `/spaces/{space_id}/...`. URLs con guiones, JSON en `snake_case`.
- **Autorización:** dependencia común que verifica membresía del espacio (prevención de IDOR).
- **Crear transacciones por intención**; el backend arma los entries.
- **Acciones de negocio como endpoints explícitos:** `/confirm`, `/skip`, `/cancel`, `/archive`.
- **Editar** = rehacer entries. **Borrar** = `deleted_at`.
- **Paginación por cursor** (orden `date desc, id desc`).
- `GET /spaces/{id}/dashboard` agregado.
## Modelo de datos
Diagrama y detalle: https://claude.ai/artifact/3TR4fDsfjuaVcsyix7BLb8
 
Tablas v1: `users`, `spaces`, `space_members`, `accounts`, `card_statements`, `categories`, `recurring_templates`, `transactions`, `entries`, y del H2 `budgets`, `goals` y `goal_allocations` (eran v1.1 hasta el 2026-11-24).
