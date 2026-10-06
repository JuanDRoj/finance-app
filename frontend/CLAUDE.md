# Frontend — Next.js

Next.js (App Router) · TypeScript **strict** · React Server Components · Tailwind CSS v4 · shadcn/ui con Base UI · Phosphor · TanStack Query · react-hook-form + zod · Firebase Auth (cliente) · openapi-typescript + openapi-fetch · vitest + Testing Library · Playwright (E2E, _pendiente_).
Despliegue: Vercel (funciones en `gru1`). Diseño **mobile-first**, interfaz en **español**.

**Diseño y librerías de UI:** [`docs/diseno.md`](docs/diseno.md) — decisiones aprobadas (estilos, componentes, tokens, datos, formularios, modo oscuro, viewport) y checklist para empezar una pantalla. Léelo antes de crear o cambiar cualquier pantalla o componente.

> **Nota:** los comandos y la estructura de abajo son la convención acordada. Los fijaron **KAN-24 [FE-01]** (setup), **KAN-25 [FE-02]** (cliente API), **KAN-33 [FE-07]** (tokens, tema y base), **KAN-34 [FE-08]** (componentes base y catálogo) y **KAN-26 [FE-03]** (login, `lib/firebase.ts`, `TextField`): si tareas posteriores los cambian, **actualiza este archivo en la misma tarea**. Lo marcado _(pendiente)_ aún no existe.

## Versiones
Node **24** (`.nvmrc`, `engines`), Next.js **16**, React 19, TypeScript **5.9** y ESLint **9**. TypeScript se queda en 5.9 porque `openapi-typescript` (FE-02) pide `^5.x` y `typescript-eslint` solo llega a `<6.1` (TS 7 no está soportado); ESLint no pasa de 9 porque `eslint-config-next` 16 se rompe con ESLint 10 (`eslint-plugin-react`). Súbelos cuando esos paquetes lo soporten. Next, React y `eslint-config-next` van con versión exacta: cámbialos juntos. Vitest 5 usa Vite 8: el alias `@/` se resuelve con `resolve.tsconfigPaths` (no hace falta `vite-tsconfig-paths`).

## Comandos (siempre desde `/frontend`)
| Para | Comando |
|---|---|
| Instalar dependencias | `npm ci` (usa `npm install <paquete>` solo si el plan aprobado lo incluye) |
| Variables de entorno (una vez) | `cp .env.example .env.local` (sin ellas `dev` y `build` fallan) |
| Levantar en local | `npm run dev` → http://localhost:3000 |
| Catálogo de componentes (solo `next dev`) | http://localhost:3000/catalog: no existe en `build` ni en producción (ver `docs/diseno.md` D4) |
| Lint | `npm run lint` (`eslint .`; Next 16 ya no trae `next lint` ni lintea en el build) |
| Tipos | `npm run typecheck` (`tsc --noEmit`) |
| Formato (verificar / aplicar) | `npm run format:check` / `npm run format` (Prettier; no toca los `*.md`) |
| Build | `npm run build` (su `prebuild` borra `.next/dev` para que los tipos de rutas del modo dev, que incluyen `/catalog`, no rompan el build) |
| Regenerar tipos de la API | `npm run gen:api` (lee `../backend/openapi.json` y escribe `src/lib/api/schema.d.ts`; idempotente) |
| Tests (lógica y componentes) | `npm test` (vitest, una pasada) · `npm run test:watch` |
| E2E | `npx playwright test` _(pendiente: se instala con la primera sub-tarea de E2E; proyectos "iPhone" WebKit y "Pixel" Chromium a 360 px, y comparar la salida de `Intl` de Node con la de WebKit y Chromium; ver `docs/diseno.md` §4)_ |

`lint`, `typecheck`, `format:check` y `test` no necesitan variables de entorno; `dev`, `build` y `start` sí. `build` descarga las fuentes de Google (`next/font`): necesita red.

En local, el backend corre en `http://localhost:8000` y el emulador de Firebase Auth en `localhost:9099` (`docker compose up -d` desde la raíz).

## Estructura
```
frontend/
├── src/
│   ├── app/                    # rutas (App Router)
│   │   ├── layout.tsx          # raíz: fuentes (next/font), `viewport`, <Providers>
│   │   ├── globals.css         # tokens (claro + oscuro), glass, base móvil
│   │   ├── login/              # `page.tsx` (marco propio, sin AppShell) y `_components/login-form.tsx` (cliente): entrar y crear cuenta con email, y Google por popup; canjea el ID token por la cookie y va a `/`
│   │   ├── (private)/          # (pendiente) rutas que requieren sesión
│   │   └── catalog/            # solo en `next dev`: `page.dev.tsx` y `layout.dev.tsx` (catálogo de componentes, con panel de auditoría de 44 px y "Probar GET /me": comprueba a mano que la cookie de sesión viaja con `browserApi`)
│   ├── proxy.ts                # (pendiente) redirige a /login si no hay cookie de sesión. Next 16 renombró `middleware.ts` a `proxy.ts`
│   ├── components/
│   │   ├── providers.tsx       # QueryClientProvider (un QueryClient por request en servidor)
│   │   ├── app-shell.tsx       # marco de una pantalla con sesión: header glass con ranura `actions` ("Cerrar sesión"), safe areas, fondo
│   │   ├── text-field.tsx      # campo de texto con la accesibilidad cableada (label, `aria-invalid`, `aria-describedby`, `data-invalid`): `Field` + `Input` + descripción + error; compatible con `register()` de react-hook-form
│   │   └── ui/                 # shadcn/Base UI ajustados a Menta: button, input, field, card, alert, skeleton, empty, label y separator (de field), sonner (Toaster) y focus.ts (foco compartido)
│   ├── lib/
│   │   ├── core/               # núcleo puro, compartible con la app nativa (ver "Core" abajo)
│   │   │   ├── locale.ts       # locale por moneda del espacio (mapa fijo, fallback es-UY)
│   │   │   ├── money.ts        # `formatMoney(minor, currency, opts)`: unidades menores → texto
│   │   │   ├── dates.ts        # `formatLocalDate`, `formatInstant`, `todayInTimezone`
│   │   │   ├── i18n.ts         # mapa único de traducciones del backend: `describeApiError`, `fieldErrorMessage` (errores BE-08). Los valores de dominio (`expense`…) se añaden aquí con la primera pantalla que los muestre
│   │   │   ├── firebase-errors.ts # errores de Firebase Auth en español (`describeFirebaseAuthError`, `isSignInCancelled`) y `describeLoginError` (Firebase o API). Puro: no importa `firebase`
│   │   │   ├── schemas/        # esquemas zod de formularios (`auth.ts`: login y registro; mínimo 8 caracteres al crear cuenta)
│   │   │   └── data/           # `ApiClient`, `ApiError` + `unwrap`, y las funciones de datos (`queryOptions`, `createSession`)
│   │   ├── api/                # adaptadores del cliente tipado de la API (openapi-fetch)
│   │   │   ├── schema.d.ts     # GENERADO por gen:api (versionado) — nunca editar a mano
│   │   │   ├── server.ts       # `getServerApi()` (import "server-only"): BACKEND_URL + reenvía la cabecera Cookie
│   │   │   ├── browser.ts      # `browserApi`: baseUrl `/api` (rewrite) + `credentials: "include"`
│   │   │   └── contract.check.ts # canario de tipos que revisa `typecheck`; nadie lo importa ni se ejecuta
│   │   ├── env/                # validación de variables de entorno (zod)
│   │   │   ├── server.schema.ts  # schema de las variables solo de servidor (puro)
│   │   │   ├── client.schema.ts  # schema de las NEXT_PUBLIC_* (puro)
│   │   │   ├── server.ts       # `serverEnv` (import "server-only"): úsalo desde código de servidor
│   │   │   ├── client.ts       # `clientEnv`: úsalo desde cualquier sitio, también componentes cliente
│   │   │   ├── page-extensions.ts # `pageExtensionsFor(phase)`: next.config.ts acepta la extensión `dev.tsx` (el catálogo `*.dev.tsx`) solo en `next dev`; así no existe en build ni en producción
│   │   │   └── validate.ts     # `assertValidEnv()`: la llama next.config.ts al arrancar y en el build
│   │   ├── firebase.ts         # Firebase Auth del navegador, solo para el login: init perezoso en memoria (nunca IndexedDB), emulador en local, `signInForIdToken` y `signOutQuietly`
│   │   └── utils.ts            # `cn()` (clsx + tailwind-merge)
├── docs/diseno.md              # decisiones de diseño y librerías (FE-06); léelo antes de una pantalla nueva
├── e2e/                        # (pendiente) Playwright (qa)
├── components.json             # shadcn: estilo base-nova (Base UI), iconLibrary phosphor
├── postcss.config.mjs          # Tailwind v4 (`@tailwindcss/postcss`)
├── vitest.config.mts           # proyectos "unit" (`*.test.ts`, Node) y "ui" (`*.test.tsx`, jsdom)
├── .env.example                # lista comentada de variables; se copia a .env.local
├── .nvmrc                      # versión de Node
├── eslint.config.mjs           # ESLint (flat config): prohíbe `process.env` fuera de lib/env/, el import raíz de Phosphor y lo que core no puede importar
├── .prettierrc.json            # Prettier (printWidth 100; el resto sale de ../.editorconfig)
└── next.config.ts              # valida el entorno; rewrite /api/* → backend; optimizePackageImports de Phosphor; `pageExtensions` por fase (el catálogo `*.dev.tsx` solo en `next dev`)
```

## Convenciones
- **API:** solo vía `lib/api/server.ts` o `lib/api/browser.ts`, tipados con `schema.d.ts`. Nunca `fetch` suelto al backend ni tipos de respuesta escritos a mano.
  - Servidor: `const api = await getServerApi();` (una vez por render) y `await api.GET("/ruta")`. Lee los headers de la petición, así que la ruta pasa a ser dinámica. No usa caché (`cache: "no-store"`).
  - Navegador: `browserApi` solo dentro del `queryFn` / `mutationFn` de TanStack Query (nunca en efectos sueltos). Su `baseUrl` es relativa, así que en Node falla con `Failed to parse URL`: en Server Components usa `getServerApi()`.
  - Las llamadas devuelven `{ data, error, response }`, ya tipados con `schema.d.ts`: no los redeclares a mano.
  - **Datos con TanStack Query** (D2): las funciones de datos viven en `lib/core/data/<recurso>.ts` y **reciben un `ApiClient`** (`lib/core/data/api-client.ts`), no importan un cliente. Exportan `xxxQueryOptions(api)` con la query key (`["spaces"]`, `["spaces", id]`…) y un `queryFn` que envuelve la llamada con `unwrap`: `queryFn: () => unwrap(api.GET("/spaces"))`. `unwrap` devuelve `data` o lanza `ApiError { status, body }` siempre que la respuesta no sea OK, también si viene sin cuerpo (un 404 o 502 vacío: `body` es `undefined`); en un 422, `body` es el detalle de FastAPI para mapear a campos. Un string de fecha-hora (`formatInstant`) debe traer `Z` o `±hh:mm`. El servidor y el cliente usan la misma función: el servidor con `getServerApi()`, el cliente con `browserApi`.
  - Tras una mutación, invalida las queries afectadas (`queryClient.invalidateQueries`).
- **Contrato:** si `openapi.json` cambió, corre `npm run gen:api`. El CI fallará si los tipos generados no coinciden _(pendiente: KAN-15)_. En tareas de backend que cambian la API, lo hace backend-dev en el mismo PR.
  - Un cambio del contrato que rompa lo que usa el frontend se ve en `npm run typecheck`. `lib/api/contract.check.ts` lo garantiza para `/healthz` y el cableado de los clientes (sus `@ts-expect-error` fallan si el cliente deja de rechazar llamadas erróneas).
  - Los endpoints reales se tipan al usarlos en la app; no hay que registrarlos en ningún sitio.
- **Rewrite:** `/api/:path*` → `${BACKEND_URL}/:path*` en `next.config.ts` (lo mantiene frontend; quita el prefijo `/api`). Funciona igual en local y en Vercel.
  - `BACKEND_URL` se lee con `serverSchema.parse(process.env)` (el schema puro, no `serverEnv`, que lleva `server-only`) y se fija al hacer `dev`/`build`: cambiarla exige reiniciar o volver a construir.
  - No crees rutas en `src/app/api/`: el sistema de archivos tiene prioridad sobre el rewrite y taparía el endpoint del backend.
  - Define las rutas del backend sin barra final: una redirección 307 de FastAPI apuntaría al backend y sacaría al navegador del origen.
- **Next.js 16:** la protección de rutas va en `proxy.ts` (antes `middleware.ts`, ya deprecado). Ante dudas de APIs, la documentación de la versión instalada está en `node_modules/next/dist/docs/`.
- **Server vs. client:** Server Components por defecto; `"use client"` solo donde haga falta interactividad o Firebase.
  - **Prefetch + hidratación:** en el Server Component, `const queryClient = new QueryClient()` (uno por request, nunca a nivel de módulo: son datos de usuario), `await queryClient.prefetchQuery(xxxQueryOptions(await getServerApi()))` y `<HydrationBoundary state={dehydrate(queryClient)}>` alrededor del componente cliente que hace `useQuery(xxxQueryOptions(browserApi))`. El `QueryClientProvider` ya está en `components/providers.tsx` (montado en `layout.tsx`).
  - **Core** (`lib/core/`): TypeScript puro compartible con la futura app nativa. ESLint le prohíbe importar `next/*`, `react-dom`, `server-only`, `lib/api/server`, `lib/api/browser` y `lib/env/*`; solo `import type` de `@/lib/api/schema`. Sin puertos "por si acaso".
- **Sesión:** el login con Firebase entrega un ID token → `POST /api/auth/session` → el backend responde con la cookie HttpOnly. El frontend **no guarda tokens**. Logout = `DELETE /api/auth/session`.
  - **Flujo del login** (`app/login/_components/login-form.tsx`, una sola `useMutation`): `signInForIdToken` → `createSession(browserApi, { id_token, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })` → `signOutQuietly()` (en un `finally`: también si el canje falla) → `router.replace("/")`. La zona del dispositivo se manda solo aquí: es la del espacio personal que crea el primer login.
  - **`lib/firebase.ts`:** `initializeAuth(app, { persistence: inMemoryPersistence })` (con `getAuth()` el SDK guardaría el token en IndexedDB) y `signInWithPopup(auth, provider, browserPopupRedirectResolver)`; nunca `signInWithRedirect` (falla en móvil). El SDK se inicializa dentro del handler, no al importar el módulo (la página también se renderiza en el servidor). `firebase/auth` se importa de forma estática, no con `import()`: Safari bloquea un popup abierto tras un `await` lento.
  - **Emulador:** si existe `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST`, `connectAuthEmulator` (sin banner). En local, abre la app en `http://localhost:3000` (no `127.0.0.1` ni la IP de la LAN): el backend solo acepta ese origen en `ALLOWED_ORIGINS` y respondería 403 `origin_not_allowed`.
  - **Comprobar la cookie a mano:** inicia sesión en `/login` y, en `/catalog`, pulsa "Probar GET /me" (200 con tu email = la cookie HttpOnly llegó y viaja en las llamadas de `browserApi`).
- **Server Components** llaman directo a `BACKEND_URL` y **reenvían la cookie** de la petición entrante: `getServerApi()` copia tal cual la cabecera `Cookie` (`(await headers()).get("cookie")`), no la reconstruye con `cookies()` porque eso re-codifica los valores. Un `Set-Cookie` del backend no se propaga desde un Server Component (no puede escribir cookies).
- **Dinero:** llega como entero en la **unidad menor de la moneda** (ISO 4217): valor × 10^exponente, con el `exponent` que el API envía junto a `currency` (UYU 15,50 = `1550`; CLP 1.500 = `1500`). Nunca asumas ×100. Se formatea solo para mostrar, con `formatMoney(minor, { code, exponent }, { sign })` de `lib/core/money.ts`: locale fijo por moneda del espacio (`lib/core/locale.ts`: UYU → es-UY, COP → es-CO, USD → es-UY, fallback es-UY; nunca el del dispositivo), **exactamente `exponent` decimales** y "−" tipográfico (U+2212) en negativos. Acepta `number` entero seguro, `bigint` o `string`; convierte con enteros y cadenas, nunca con `/ 100` ni floats. Sin aritmética con floats.
- **Fechas:** `lib/core/dates.ts`. La fecha de una transacción (`date`, `YYYY-MM-DD`) se formatea tal cual con `formatLocalDate` (sin zona horaria: no se corre un día); un instante (`timestamptz`) con `formatInstant(instante, space.timezone)`; "hoy" con `todayInTimezone(space.timezone)`. Siempre la zona del espacio, nunca la del dispositivo.
- **Textos:** todo lo visible en español. Valores del backend (`expense`, `pending`, `credit_card`) → mapa único en `lib/core/i18n.ts` (hoy trae los errores del backend; añade ahí los valores de dominio con la primera pantalla que los muestre).
- **Estados de pantalla:** carga, vacío y error en cada vista que pide datos.
- **Estilo de código:** componentes en PascalCase, hooks `useXxx`, archivos de rutas según App Router.
- **Estilos y tokens** (detalle en `docs/diseno.md`): Tailwind v4 con tokens como variables CSS en `src/app/globals.css` (`:root` claro y `@media (prefers-color-scheme: dark)`; no hay clase `.dark`, y `dark:` sigue el sistema). Solo clases de token (`bg-background`, `text-muted-foreground`, `text-income`, `rounded-tile`…): nada de hex ni `rgb()` sueltos. Superficies: `card-surface` (tiles bento y grupos), `glass` (nav, toast, header sticky), `glass-strong` (sheets); `card-solid` y `popover` son sólidos. `hover:` ya compila a `@media (hover: hover)`; el feedback táctil va con `active:`. `cn()` de `lib/utils.ts` para combinar clases. Hay un test de contraste AA sobre `globals.css`: si cambias un color, corre `npm test`.
- **Iconos:** Phosphor siempre desde `@phosphor-icons/react/ssr` (funciona en Server y Client Components; ESLint prohíbe el import raíz). Decorativos con `aria-hidden`; botones solo con icono, `aria-label` en español.
- **Componentes:** se añaden con `npx shadcn@latest add <componente>` (estilo `base-nova`, Base UI) a `components/ui` y se ajustan a Menta; no se escriben desde cero. Revisa lo que genera: la CLI puede traer `lucide-react` o reescribir `globals.css`, y (visto en KAN-34) añade `cn` y `next-themes` a `package.json`: reviértelo (usamos `cn()` de `lib/utils.ts`) y revisa `git diff package.json package-lock.json`. `shadcn add` importa `cn` del paquete `cn`: cámbialo a `@/lib/utils`. Los componentes y sus props están en `docs/diseno.md` D4; el catálogo, en `/catalog`.
- **Errores del API en pantalla:** `describeApiError(error)` (`lib/core/i18n.ts`) + `<Alert>`; nunca muestres el `detail` en inglés ni el `code`. Un código nuevo del backend necesita su traducción ahí (un 422 que el usuario no puede corregir en un campo, como `timezone_invalid`, lleva su descripción completa en `VALIDATION_ERROR_BY_TYPE`). Para el login, `describeLoginError` (`lib/core/firebase-errors.ts`) reparte entre los errores de Firebase (`auth/...`, traducidos ahí) y `describeApiError`; cerrar el popup (`isSignInCancelled`) no muestra error.
- **Formularios:** react-hook-form + `zodResolver` (`@hookform/resolvers` 5, compatible con zod 4) con esquemas de `lib/core/schemas/`. Los campos de texto van con `TextField` (`components/text-field.tsx`): `<TextField label="…" error={errors.x?.message} {...register("x")} />` ya cablea `htmlFor`/`id`, `aria-invalid`, `aria-describedby` y `data-invalid`; no repitas ese cableado a mano. Con `noValidate` en el `<form>`, para que los mensajes salgan del esquema (en español) y no del navegador. Para que un esquema de request no se desvíe del contrato, comprueba que lo que infiere es asignable al tipo generado: `const _check: components["schemas"]["X"] = {} as z.input<typeof schema>`.

## Variables de entorno
- **Validación:** `next.config.ts` llama `assertValidEnv()` (`lib/env/validate.ts`), así que `npm run dev` y `npm run build` fallan con un mensaje claro que lista **todas** las variables que faltan o están mal (servidor y cliente juntas). En local: `cp .env.example .env.local`.
- **Servidor:** `BACKEND_URL` (URL http(s), sin barra final). Solo se lee desde `lib/env/server.ts` (`serverEnv`), que lleva `import "server-only"`: importarlo desde un componente cliente rompe el build.
- **Cliente:** `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (obligatorias) y `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` (opcional, solo local). Se leen desde `lib/env/client.ts` (`clientEnv`). Son públicas: se incrustan en el bundle al hacer build, **nunca secretos**. Next solo las incrusta si se escriben como `process.env.NEXT_PUBLIC_X` literal (`client.ts` ya lo hace); no uses claves dinámicas ni pases `process.env` entero.
- **No leas `process.env` directamente** fuera de `lib/env/` (ESLint lo prohíbe): añade la variable al schema y léela vía `serverEnv` / `clientEnv`.
- **Emulador solo en local:** el build falla si `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` está definida y existe `VERCEL_ENV` (misma regla que el backend). `vercel dev` también define `VERCEL_ENV=development`, así que la guarda impide usarlo con el emulador: en local usa `npm run dev`.
- Los schemas de servidor y cliente están en archivos separados a propósito: así el bundle del navegador no contiene los nombres de las variables de servidor.
- Lista comentada en `frontend/.env.example` (nunca leas `.env.local`). Cualquier variable nueva se añade a su schema **y** al `.env.example` en el mismo cambio.

## Tests
- **vitest** (`npm test`) con dos proyectos: `*.test.ts` corre en Node (la lógica y el formateo, que dependen del ICU de Node 24) y `*.test.tsx` en jsdom con Testing Library (solo componentes con lógica no trivial). Sin globales de vitest, Testing Library no limpia el DOM: usa `afterEach(cleanup)` en cada archivo `.test.tsx`. El test va junto al archivo. Importa `describe`, `it`, `expect` de `vitest` (sin globales).
- Los tests de dinero y fecha comparan texto exacto: NBSP (U+00A0) entre símbolo y cifra y "−" (U+2212), escritos con escapes. Una subida de Node puede cambiar el ICU y romperlos: revisa la salida antes de tocar la expectativa.
- El proyecto "unit" corre con `TZ=America/Montevideo` (`test.env` en `vitest.config.mts`): una zona con offset negativo, para que un formateo que use la zona de la máquina falle en cualquier equipo y en CI. `dates.test.ts` lo comprueba. El proyecto "ui" (jsdom) no lo fija.
- Pasa el `env` como argumento en vez de tocar `process.env` (`assertValidEnv(env)` lo admite).
- E2E con Playwright en `e2e/`, pocos y de flujos reales (los escribe qa). _(pendiente: todavía no está instalado.)_

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
