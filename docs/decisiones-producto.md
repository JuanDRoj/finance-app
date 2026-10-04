# Personal Finance App — Decisiones de producto
 
Última actualización: 2026-10-03
 
## Visión
App de finanzas personales, alternativa moderna a las hojas de cálculo. Usuarios cotidianos que quieren llevar su dinero sin depender de apps bancarias. Web responsive primero (pensada para celular), app móvil después.
 
## Decisiones
 
| Tema | Decisión |
|---|---|
| Registro | Manual y muy rápido (botón "+" siempre visible) |
| Plantillas | Suscripciones y cuotas generan movimientos **pendientes** que el usuario confirma, edita, salta o cancela. No afectan el saldo hasta confirmarse. Sección "Pendientes" en vez de una notificación por pago. |
| Cuotas | Se registra la compra una vez (monto + n.º de cuotas); la plantilla genera una cuota pendiente al mes y termina sola. Mostrar "cuotas futuras comprometidas". |
| Cuentas | Varias (bancos, efectivo, tarjetas). Saldo global: **Disponible · Deuda tarjetas · Neto**. Tarjeta = deuda. |
| Tipos de movimiento | Gasto, Ingreso, Transferencia, **Ajuste**. Pagar la tarjeta = transferencia (no gasto). El gasto cuenta al comprar. Ajuste = saldo inicial y cuadre con el banco; no cuenta en reportes. |
| Moneda | Nivel 0: una moneda **por espacio**. Cada transacción la hereda; preparado para multimoneda. |
| Zona horaria | Por espacio (`spaces.timezone`, ej. `America/Montevideo`). Momentos en UTC (`timestamptz`); fecha de una transacción como `date` local. |
| Categorías | Predefinidas y editables, con subcategorías (2 niveles). |
| Espacios | Los datos pertenecen a un **espacio**; los usuarios son miembros. "Mi espacio" privado + espacios de hogar con cuentas propias. Aporte personal → hogar = gasto "Aporte al hogar" + ingreso en el hogar (enlazados). Sin división de deudas. |
| Dashboard | (A) Disponible/Deuda/Neto · (B) Top 5 gastos del mes por categoría principal · (D) Pendientes y cuotas futuras. |
| Presupuestos | Límite mensual por categoría con barra de progreso. |
| Metas de ahorro | Apartados virtuales **repartidos en una o varias cuentas** (solo banco/efectivo, nunca tarjeta). Libre para gastar = Disponible − apartado. Al registrar un gasto/transferencia desde una cuenta con apartados, la app pregunta si usa dinero de una meta y libera el apartado con un toque. Si el saldo queda por debajo de lo apartado, se permite y se avisa. |
| Editar/borrar | Edición libre de transacciones confirmadas; borrado suave (`deleted_at`) con "Deshacer". Historial de cambios en v2. |
 
## Roadmap
- **v1:** registro, plantillas, cuentas (cierre/vencimiento de tarjetas), transferencias, ajustes, categorías, dashboard (A, B, D). Estructura de espacios preparada.
- **v1.1:** presupuestos y metas de ahorro.
- **v2:** hogares compartidos, historial de cambios.
- **Futuro:** multimoneda, app móvil (React Native), importar extractos, dividir compras (UI).
Plan de construcción por hitos: en Jira (proyecto KAN; cada épico es un hito).
 
## Decisiones técnicas
Contexto: desarrollador solo (semi senior fullstack Python/React/DB/cloud). Proyecto personal/de aprendizaje con miras a producto real.
 
| Capa | Decisión |
|---|---|
| Arquitectura | **Monolito modular** en el backend; frontend y backend separados, comunicados por API |
| Frontend | **Next.js** + TypeScript (Server Components), en **Vercel** |
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
- Dinero en `bigint` centavos, nunca `float`.
- Un solo backend: Next.js nunca toca la BD.
- Rewrite `/api/*` → Cloud Run en `frontend/next.config.ts` (funciona igual en local y en Vercel).
- Plan Hobby de Vercel = no comercial.
- **Código y BD en inglés** (snake_case, tablas en plural); interfaz en español.
### Monolito modular (backend)
Una app FastAPI, una BD, un despliegue; módulos de dominio: `spaces`, `accounts`, `categories`, `transactions`, `recurring`, `dashboard` (v1.1: `budgets`, `goals`). Capas por módulo: router → service → repository. Un módulo usa a otro solo vía su service. Operaciones que cruzan módulos van en una sola transacción de BD.
 
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
 
Tablas v1: `users`, `spaces`, `space_members`, `accounts`, `card_statements`, `categories`, `recurring_templates`, `transactions`, `entries`. v1.1: `budgets`, `goals`, `goal_allocations`.
