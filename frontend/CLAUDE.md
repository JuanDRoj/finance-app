# Frontend — Next.js

Next.js (App Router) · TypeScript **strict** · React Server Components · Firebase Auth (cliente) · openapi-typescript + openapi-fetch · Playwright (E2E).
Despliegue: Vercel (funciones en `gru1`). Diseño **mobile-first**, interfaz en **español**.

> ⚠️ Los comandos y la estructura de abajo son la convención acordada. Los fijan **KAN-24 [FE-01]** (setup) y **KAN-25 [FE-02]** (cliente API): si esas tareas (o posteriores) los cambian, **actualiza este archivo en la misma tarea**.

## Comandos (siempre desde `/frontend`)
| Para | Comando |
|---|---|
| Instalar dependencias | `npm ci` (usa `npm install <paquete>` solo si el plan aprobado lo incluye) |
| Levantar en local | `npm run dev` → http://localhost:3000 |
| Lint | `npm run lint` |
| Tipos | `npm run typecheck` (`tsc --noEmit`) |
| Build | `npm run build` |
| Regenerar tipos de la API | `npm run gen:api` (lee `../backend/openapi.json`) |
| Tests de lógica | `npm test` |
| E2E | `npx playwright test` |

En local, el backend corre en `http://localhost:8000` y el emulador de Firebase Auth en `localhost:9099` (`docker compose up -d` desde la raíz).

## Estructura
```
frontend/
├── src/
│   ├── app/                    # rutas (App Router)
│   │   ├── login/page.tsx      # login email + Google (popup)
│   │   ├── (private)/          # rutas que requieren sesión
│   │   └── layout.tsx
│   ├── middleware.ts           # redirige a /login si no hay cookie de sesión
│   ├── lib/
│   │   ├── api/
│   │   │   ├── schema.d.ts     # ⛔ GENERADO por gen:api — nunca editar a mano
│   │   │   ├── server.ts       # cliente para Server Components (BACKEND_URL + reenvía cookie)
│   │   │   └── browser.ts      # cliente para el navegador (vía /api/*)
│   │   ├── firebase.ts         # init de Firebase Auth (emulador en local)
│   │   ├── env.ts              # validación de variables de entorno al arrancar
│   │   ├── i18n.ts             # mapa único de traducciones de valores del backend
│   │   └── money.ts            # formateo de centavos → texto
│   └── components/
├── e2e/                        # Playwright (qa)
└── next.config.ts              # rewrite /api/* → backend
```

## Convenciones
- **API:** solo vía `lib/api/server.ts` o `lib/api/browser.ts`, tipados con `schema.d.ts`. Nunca `fetch` suelto al backend ni tipos de respuesta escritos a mano.
- **Contrato:** si `openapi.json` cambió, corre `npm run gen:api`. El CI falla si los tipos generados no coinciden. En tareas de backend que cambian la API, lo hace backend-dev en el mismo PR.
- **Rewrite:** `/api/:path*` → `${BACKEND_URL}/:path*` en `next.config.ts` (lo mantiene frontend; quita el prefijo `/api`). Funciona igual en local y en Vercel.
- **Server vs. client:** Server Components por defecto; `"use client"` solo donde haga falta interactividad o Firebase.
- **Sesión:** el login con Firebase entrega un ID token → `POST /api/auth/session` → el backend responde con la cookie HttpOnly. El frontend **no guarda tokens**. Logout = `DELETE /api/auth/session`.
- **Server Components** llaman directo a `BACKEND_URL` y **reenvían la cookie** de la petición entrante.
- **Dinero:** llega en centavos (`1550`). Se formatea solo para mostrar, con `lib/money.ts` (`Intl.NumberFormat` y la moneda del espacio). Sin aritmética con floats.
- **Textos:** todo lo visible en español. Valores del backend (`expense`, `pending`, `credit_card`) → `lib/i18n.ts`.
- **Estados de pantalla:** carga, vacío y error en cada vista que pide datos.
- **Estilo de código:** componentes en PascalCase, hooks `useXxx`, archivos de rutas según App Router.

## Variables de entorno
- Validadas en `lib/env.ts` al arrancar: si falta una, la app falla con un mensaje claro.
- `NEXT_PUBLIC_*` solo para valores públicos (config web de Firebase). `BACKEND_URL` es solo de servidor.
- Lista comentada en `frontend/.env.example` (nunca leas `.env.local`).

## Tests
- Tests de lógica solo para código no trivial (formateo de dinero, traducciones, utilidades): `*.test.ts` junto al archivo.
- E2E en `e2e/`, pocos y de flujos reales (los escribe qa).