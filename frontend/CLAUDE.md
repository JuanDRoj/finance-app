# Frontend — Next.js

Next.js (App Router) · TypeScript **strict** · React Server Components · Firebase Auth (cliente) · openapi-typescript + openapi-fetch · Playwright (E2E).
Despliegue: Vercel (funciones en `gru1`). Diseño **mobile-first**, interfaz en **español**.

> **Nota:** los comandos y la estructura de abajo son la convención acordada. Los fijan **KAN-24 [FE-01]** (setup, ya hecho) y **KAN-25 [FE-02]** (cliente API): si esas tareas (o posteriores) los cambian, **actualiza este archivo en la misma tarea**. Lo marcado _(pendiente)_ aún no existe.

## Versiones
Node **24** (`.nvmrc`, `engines`), Next.js **16**, React 19, TypeScript **5.9** y ESLint **9**. TypeScript se queda en 5.9 porque `openapi-typescript` (FE-02) pide `^5.x` y `typescript-eslint` solo llega a `<6.1` (TS 7 no está soportado); ESLint no pasa de 9 porque `eslint-config-next` 16 se rompe con ESLint 10 (`eslint-plugin-react`). Súbelos cuando esos paquetes lo soporten. Next, React y `eslint-config-next` van con versión exacta: cámbialos juntos.

## Comandos (siempre desde `/frontend`)
| Para | Comando |
|---|---|
| Instalar dependencias | `npm ci` (usa `npm install <paquete>` solo si el plan aprobado lo incluye) |
| Variables de entorno (una vez) | `cp .env.example .env.local` (sin ellas `dev` y `build` fallan) |
| Levantar en local | `npm run dev` → http://localhost:3000 |
| Lint | `npm run lint` (`eslint .`; Next 16 ya no trae `next lint` ni lintea en el build) |
| Tipos | `npm run typecheck` (`tsc --noEmit`) |
| Formato (verificar / aplicar) | `npm run format:check` / `npm run format` (Prettier; no toca los `*.md`) |
| Build | `npm run build` |
| Regenerar tipos de la API | `npm run gen:api` (lee `../backend/openapi.json`) _(pendiente: FE-02)_ |
| Tests de lógica | `npm test` _(pendiente: se añade con la primera lógica testeable)_ |
| E2E | `npx playwright test` _(pendiente)_ |

`lint`, `typecheck` y `format:check` no necesitan variables de entorno; `dev`, `build` y `start` sí.

En local, el backend corre en `http://localhost:8000` y el emulador de Firebase Auth en `localhost:9099` (`docker compose up -d` desde la raíz).

## Estructura
```
frontend/
├── src/
│   ├── app/                    # rutas (App Router)
│   │   ├── login/page.tsx      # login email + Google (popup)
│   │   ├── (private)/          # rutas que requieren sesión
│   │   └── layout.tsx
│   ├── proxy.ts                # (pendiente) redirige a /login si no hay cookie de sesión. Next 16 renombró `middleware.ts` a `proxy.ts`
│   ├── lib/
│   │   ├── api/                # (pendiente: FE-02)
│   │   │   ├── schema.d.ts     # GENERADO por gen:api — nunca editar a mano
│   │   │   ├── server.ts       # cliente para Server Components (BACKEND_URL + reenvía cookie)
│   │   │   └── browser.ts      # cliente para el navegador (vía /api/*)
│   │   ├── env/                # validación de variables de entorno (zod)
│   │   │   ├── server.schema.ts  # schema de las variables solo de servidor (puro)
│   │   │   ├── client.schema.ts  # schema de las NEXT_PUBLIC_* (puro)
│   │   │   ├── server.ts       # `serverEnv` (import "server-only"): úsalo desde código de servidor
│   │   │   ├── client.ts       # `clientEnv`: úsalo desde cualquier sitio, también componentes cliente
│   │   │   └── validate.ts     # `assertValidEnv()`: la llama next.config.ts al arrancar y en el build
│   │   ├── firebase.ts         # (pendiente) init de Firebase Auth (emulador en local)
│   │   ├── i18n.ts             # (pendiente) mapa único de traducciones de valores del backend
│   │   └── money.ts            # (pendiente) formateo de centavos → texto
│   └── components/             # (pendiente)
├── e2e/                        # (pendiente) Playwright (qa)
├── .env.example                # lista comentada de variables; se copia a .env.local
├── .nvmrc                      # versión de Node
├── eslint.config.mjs           # ESLint (flat config) + regla que prohíbe `process.env` fuera de lib/env/
├── .prettierrc.json            # Prettier (printWidth 100; el resto sale de ../.editorconfig)
└── next.config.ts              # valida el entorno; rewrite /api/* → backend (pendiente: KAN-25)
```

## Convenciones
- **API:** solo vía `lib/api/server.ts` o `lib/api/browser.ts`, tipados con `schema.d.ts`. Nunca `fetch` suelto al backend ni tipos de respuesta escritos a mano.
- **Contrato:** si `openapi.json` cambió, corre `npm run gen:api`. El CI falla si los tipos generados no coinciden. En tareas de backend que cambian la API, lo hace backend-dev en el mismo PR.
- **Rewrite:** `/api/:path*` → `${BACKEND_URL}/:path*` en `next.config.ts` (lo mantiene frontend; quita el prefijo `/api`). Funciona igual en local y en Vercel. _(Pendiente: lo añade KAN-25.)_
- **Next.js 16:** la protección de rutas va en `proxy.ts` (antes `middleware.ts`, ya deprecado). Ante dudas de APIs, la documentación de la versión instalada está en `node_modules/next/dist/docs/`.
- **Server vs. client:** Server Components por defecto; `"use client"` solo donde haga falta interactividad o Firebase.
- **Sesión:** el login con Firebase entrega un ID token → `POST /api/auth/session` → el backend responde con la cookie HttpOnly. El frontend **no guarda tokens**. Logout = `DELETE /api/auth/session`.
- **Server Components** llaman directo a `BACKEND_URL` y **reenvían la cookie** de la petición entrante.
- **Dinero:** llega en centavos (`1550`). Se formatea solo para mostrar, con `lib/money.ts` (`Intl.NumberFormat` y la moneda del espacio). Sin aritmética con floats.
- **Textos:** todo lo visible en español. Valores del backend (`expense`, `pending`, `credit_card`) → `lib/i18n.ts`.
- **Estados de pantalla:** carga, vacío y error en cada vista que pide datos.
- **Estilo de código:** componentes en PascalCase, hooks `useXxx`, archivos de rutas según App Router.

## Variables de entorno
- **Validación:** `next.config.ts` llama `assertValidEnv()` (`lib/env/validate.ts`), así que `npm run dev` y `npm run build` fallan con un mensaje claro que lista **todas** las variables que faltan o están mal (servidor y cliente juntas). En local: `cp .env.example .env.local`.
- **Servidor:** `BACKEND_URL` (URL http(s), sin barra final). Solo se lee desde `lib/env/server.ts` (`serverEnv`), que lleva `import "server-only"`: importarlo desde un componente cliente rompe el build.
- **Cliente:** `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (obligatorias) y `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` (opcional, solo local). Se leen desde `lib/env/client.ts` (`clientEnv`). Son públicas: se incrustan en el bundle al hacer build, **nunca secretos**. Next solo las incrusta si se escriben como `process.env.NEXT_PUBLIC_X` literal (`client.ts` ya lo hace); no uses claves dinámicas ni pases `process.env` entero.
- **No leas `process.env` directamente** fuera de `lib/env/` (ESLint lo prohíbe): añade la variable al schema y léela vía `serverEnv` / `clientEnv`.
- **Emulador solo en local:** el build falla si `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` está definida y existe `VERCEL_ENV` (misma regla que el backend).
- Los schemas de servidor y cliente están en archivos separados a propósito: así el bundle del navegador no contiene los nombres de las variables de servidor.
- Lista comentada en `frontend/.env.example` (nunca leas `.env.local`). Cualquier variable nueva se añade a su schema **y** al `.env.example` en el mismo cambio.

## Tests
- Tests de lógica solo para código no trivial (formateo de dinero, traducciones, utilidades): `*.test.ts` junto al archivo.
- E2E en `e2e/`, pocos y de flujos reales (los escribe qa).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
