# Diseño y librerías (frontend)

Estado: **aprobado por Juan David el 2026-10-05** · Tarea KAN-32 [FE-06] (historia KAN-31, HU-6 Sistema de diseño base) · Lo implementaron KAN-33 (setup) y KAN-34 (componentes base y catálogo); KAN-26 (login) añadió `TextField`.
Dirección visual "Menta": mockup de referencia en https://claude.ai/artifact/WdpLUxb8M6VgXupjqezr5M. Nombre de la app: **Kanza** (identidad en [D16](#d16-identidad-kanza) y en [`marca-kanza.md`](marca-kanza.md), KAN-40).

## Cómo usar este documento

- **Al empezar una pantalla nueva, ve a la sección 1 (checklist).** Te dice qué librería, token y componente usar y te lleva a la decisión que lo justifica.
- Precedencia: este documento y `CLAUDE.md` ganan sobre cualquier skill (ver [`../../.claude/third-party-skills.md`](../../.claude/third-party-skills.md)). `CLAUDE.md` manda en comandos y convenciones de código; este documento, en librerías, tokens y dirección visual.
- Cada decisión se presenta igual: **Opciones evaluadas** (tabla), **Elección**, **Motivo**, **Reglas de uso** y, si aplica, **Verificar en KAN-33/34**.
- **†** marca un motivo que se redactó en FE-06 sin que la sesión de diseño lo dictara (motivo redactado en FE-06, revisar). Los motivos sin † los dio Juan David.
- Si una decisión cambia, se actualiza este documento en el mismo PR.

## 0. Resumen

| Tema | Elección | Detalle |
|---|---|---|
| Arquitectura del cliente | Núcleo puro `src/lib/core/` + puerto único de API | [D1](#d1-arquitectura-del-cliente) |
| Estado y datos | TanStack Query desde v1 | [D2](#d2-estado-y-datos) |
| Estilos | Tailwind CSS v4 | [D3](#d3-estilos) |
| Componentes | shadcn/ui con primitivas Base UI (código copiado al repo) | [D4](#d4-componentes) |
| Iconos | Phosphor (`@phosphor-icons/react`) | [D5](#d5-iconos) |
| Fuentes | Montserrat (números, títulos) + Karla (texto); Bricolage Grotesque 800 solo para el nombre Kanza | [D6](#d6-fuentes) |
| Formularios | react-hook-form + zod | [D7](#d7-formularios) |
| Toasts con "Deshacer" | Sonner (vía shadcn) | [D8](#d8-toasts-con-deshacer) |
| Gráficos (dashboard v1) | Diferidos: barras CSS; shadcn Charts con el primer gráfico real | [D9](#d9-gráficos) |
| Tests | vitest + Testing Library; E2E Playwright iPhone (WebKit) y Pixel (Chromium, 360 px) | [D10](#d10-tests) |
| Dinero y fechas | Locale por moneda del espacio; `exponent` decimales; zona horaria del espacio | [D11](#d11-formato-de-dinero-y-fechas) |
| Modo oscuro | Sí en v1, siguiendo el sistema con CSS | [D12](#d12-modo-oscuro) |
| Dirección visual | "Menta" (verde/blanco/negro + oscuro, bento + glass) | [D13](#d13-dirección-visual-menta) |
| Tokens | Nombres shadcn + `income` / `expense` / `debt` | [D14](#d14-tokens) |
| Viewport y móvil | 360 px mínimo; matriz 375 / ~393 / ~430 | [D15](#d15-viewport-y-móvil) |
| Identidad de marca | Kanza: ícono del grillo con la moneda, favicon simplificado, lema "Haz que alcance" | [D16](#d16-identidad-kanza) |

## 1. Checklist para una pantalla nueva

Sigue los pasos en orden. Entre paréntesis, la decisión que lo respalda.

1. **Contrato.** Confirma que los endpoints y campos existen en `../backend/openapi.json` y que `src/lib/api/schema.d.ts` está generado. Si falta algo, la tarea queda **bloqueada** hasta que backend lo exponga; no lo inventes. (`CLAUDE.md`)
2. **Datos.** Prefetch en el Server Component con `getServerApi()` + `HydrationBoundary`; en el cliente `useQuery` / `useInfiniteQuery` sobre funciones de `lib/core`. Tras mutar, invalida las queries afectadas. (D1, D2)
3. **Estados de pantalla.** Carga, vacío (invita a actuar) y error (qué pasó + qué hacer + datos a salvo). (D13 › Tono)
4. **Layout.** Diseña a 360 px y revisa 375, ~393 y ~430 antes de ampliar. Safe areas, `dvh`/`svh` (nunca `100vh`), inputs ≥16 px. (D15)
5. **Componentes.** Busca en `components/ui`, en `components/app-shell.tsx` y en el catálogo (`npm run dev` → http://localhost:3000/catalog; tabla de abajo y D4). Si falta, añádelo con la CLI de shadcn (Base UI), revisa lo que genera y ajústalo a Menta; no lo escribas desde cero. (D4)
6. **Tokens.** Solo clases de token (`bg-background`, `text-muted-foreground`, `text-income`…). Nada de hex ni `rgb()` sueltos. Dinero: `income` / `expense` / `debt`. Glass solo en cromo flotante y tiles: tiles bento → `card`; nav, toast y header sticky → `glass`; sheet → `glass-strong`. (D14, D13 › Glass)
7. **Tipografía.** Montserrat para números y títulos, Karla para texto; montos con `tabular-nums`. Usa la escala de D13. La fuente de marca (Bricolage Grotesque) es solo para el nombre "Kanza" y va con `KanzaBrand`; nunca en texto de interfaz. (D6, D13, D16)
8. **Iconos.** Phosphor: regular 20–22 px, fill solo en el tab activo, duotone en iconos de categoría. En Server Components importa de `@phosphor-icons/react/ssr`. (D5)
9. **Dinero y fechas.** Solo con los formateadores de `lib/core`: locale derivado de la moneda del espacio, exactamente `exponent` decimales, zona horaria del espacio. Sin aritmética con floats. (D11)
10. **Textos.** Español, tú, sentence case, verbos. Valores del backend (`expense`, `pending`…) solo a través del mapa único de traducciones. (D13 › Tono, `CLAUDE.md`)
11. **Formularios.** react-hook-form + esquema zod de `lib/core` + `useMutation`; los campos de texto con `TextField` (cablea label, `aria-invalid` y `aria-describedby`); los 422 se mapean a campos; `inputmode="decimal"` en montos; campos 48 px, botón primario 52 px. (D7, D4)
12. **Feedback.** Sonner; en borrados, "Deshacer". Nada de `alert`. (D8)
13. **Accesibilidad.** Contraste AA en claro y oscuro (texto 4,5:1; íconos y bordes de controles 3:1), foco visible, áreas táctiles ≥44 px, labels en inputs, `aria-label` en botones solo con icono. Los controles usan `--input` como borde, no `--border`. (D14)
14. **Pruebas.** Pasa la skill `break-ui` (nombres largos, montos enormes, listas vacías); test de lógica si hay lógica no trivial; E2E solo de flujos reales; revisa en un dispositivo real. (D10, sección 3)
15. **Skills.** `mobile-native` y `vercel-react-best-practices` (con sus overrides) siempre; `ask-sonner` y `break-ui` cuando toque. (sección 3)

### Necesito… → uso…

| Necesito | Uso | Ver |
|---|---|---|
| Pedir datos al backend | `getServerApi()` (prefetch) y `useQuery` con `browserApi`; ambos llaman a la misma función de `lib/core` | D1, D2 |
| Lista larga | `useInfiniteQuery` sobre paginación por cursor | D2 |
| Filtros de una lista | Parámetros de la URL | D2 |
| Guardar o editar | react-hook-form + zod + `useMutation`, luego invalidar | D7, D2 |
| Mostrar un monto | Formateador de dinero de `lib/core/money.ts`; color `income` / `expense` / `debt`; `tabular-nums` | D11, D14 |
| Mostrar una fecha | Formateador de fechas de `lib/core` con la zona horaria del espacio | D11 |
| Mostrar un valor del backend | Mapa único de `lib/core/i18n.ts` | `CLAUDE.md` |
| Un icono | Phosphor | D5 |
| Avisar de algo o "Deshacer" | Sonner | D8 |
| Campo de texto de un formulario (label, error y descripción cableados) | `TextField` de `components/text-field.tsx`, con `register()` de react-hook-form | D4, D7 |
| Botón (también con "cargando"), campo con label y error, tarjeta, aviso de error, skeleton, estado vacío | `Button`, `Field` (+ `FieldLabel`, `FieldDescription`, `FieldError`) con `Input`, `Card`, `Alert`, `Skeleton`, `Empty` (+ `EmptyMedia`, `EmptyTitle`…) de `components/ui` (props en D4) | D4 |
| Marco de una pantalla con sesión (header, "Cerrar sesión", safe areas, fondo) | `AppShell` de `components/app-shell.tsx` | D4 |
| Texto de un error del API | `describeApiError(error)` de `lib/core/i18n.ts` + `Alert` | D4, `CLAUDE.md` |
| Selector, hoja inferior, nav, lista | Aún no existen: se añaden con la CLI de shadcn en la tarea que los necesite | D4 |
| Tile bento o grupo de lista sobre el fondo decorativo | Token `card` (glass) | D13, D14 |
| Nav flotante, toast, header sticky | Token `glass` | D13, D14 |
| Hoja inferior (sheet) | Token `glass-strong` | D13, D14 |
| Superficie sólida (fallback, campos de formulario) | `card-solid`; popovers y menús: `popover` | D13, D14 |
| Barra de progreso o top-5 | Barras CSS accesibles (v1), `Progress` (v1.1) | D9 |
| Un color | Token; nunca un valor suelto | D14 |
| Probar datos extremos | Skill `break-ui` | sección 3 |

## 2. Decisiones

### D1. Arquitectura del cliente

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Todo en `components/` y `lib/` sin frontera con Next | Descartada: la futura app nativa tendría que reescribir formatos, esquemas y llamadas a la API † |
| Arquitectura hexagonal completa en el frontend | Descartada: el dominio vive en el backend |
| Núcleo puro `src/lib/core/` + Ports & Adapters ligero | **Elegida** |
| Paquete `packages/core` desde ya | Descartada por ahora: core pasa a `packages/core` cuando empiece el nativo |

**Elección:** núcleo puro en `src/lib/core/` y Ports & Adapters ligero: un puerto solo si tiene dos implementaciones reales.
**Motivo:** el frontend web y la futura app nativa comparten la lógica que no depende de Next ni del DOM. Hoy el único puerto es el cliente API (`getServerApi` / `browserApi`; el nativo será el tercer adaptador). Auth y storage serán puertos cuando empiece el nativo.

**Reglas de uso**
- En core va: formatos de dinero y fecha, i18n, esquemas zod, valores de tokens y funciones de datos que **reciben un `ApiClient`** (`Client<paths>`) en vez de importar uno.
- Core **no importa** `next/*`, `react-dom` ni `server-only`. Se impone con ESLint `no-restricted-imports` (hecho en KAN-33: también prohíbe `lib/api/server`, `lib/api/browser` y `lib/env/*`).
- Core puede hacer `import type` de `@/lib/api/schema`; no importa `server.ts` ni `browser.ts`.
- Estructura (confirmada en KAN-33): `src/lib/core/{locale,money,dates}.ts` y `src/lib/core/data/` ya existen; `i18n.ts` y `schemas/` se crean con la primera pantalla que los use. No hay `tokens.ts`: los valores viven solo en `globals.css` hasta que empiece la app nativa (un test de contraste lee ese CSS).
- Quedan fuera de core: `lib/api/` (adaptadores), `lib/env/` y `lib/firebase.ts`.
- Sin hexagonal completo: no crees puertos "por si acaso".

### D2. Estado y datos

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| TanStack Query v5 | **Elegida** |
| SWR | Descartada: el proyecto estandariza una sola librería de datos y TanStack Query trae el patrón oficial de hidratación del App Router, `useInfiniteQuery` y `useMutation` † |
| `fetch` + `useEffect` / `useState` a mano | Descartada: obliga a reimplementar caché, refetch y estados de carga y error † |
| Server Actions + `revalidatePath` solos | Descartada: sin caché en el cliente, y no existen en la app nativa † |
| Zustand como store global | Diferida: sin Zustand en v1; revisar con el nativo o con estado cliente global real |

**Elección:** TanStack Query desde v1, con el patrón oficial del App Router.
**Motivo:** prefetch en Server Component y cliente con la misma función de datos; invalidación tras mutar; refetch en focus y reconexión; listas largas con cursor. La misma capa de datos sirve al nativo.

**Reglas de uso**
- **Servidor:** un `QueryClient` nuevo por request (nunca a nivel de módulo: son datos de usuario; recuerda que `server-cache-lru` está prohibido). `prefetchQuery` con `getServerApi()` y `<HydrationBoundary state={dehydrate(queryClient)}>`. Guía de la versión instalada: `node_modules/next/dist/docs/01-app/02-guides/client-side-data-fetching/tanstack-query.md`.
- **Cliente:** un `QueryClientProvider` con un solo `QueryClient` en el navegador; `useQuery` / `useInfiniteQuery` llaman a la misma función de core con `browserApi`. Al hidratar, un `staleTime` mayor que 0 evita el refetch inmediato.
- Tras mutar con `useMutation`, **invalida** las queries afectadas. Refetch en focus y reconexión (comportamiento por defecto: no lo desactives sin motivo).
- Listas largas: `useInfiniteQuery` sobre la paginación por cursor del backend (orden `date desc, id desc`).
- Filtros en la URL; formularios con react-hook-form; estado de UI con `useState` / Context.
- Realtime (SSE o WebSockets) se evalúa con hogares compartidos (v2).
- Si algún día se usa Zustand en Next, un store por request (nunca global en el servidor).
- **Cambia una convención actual de `CLAUDE.md`** (ver sección 4); se actualizó en KAN-33.

### D3. Estilos

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Tailwind CSS v4 | **Elegida**: es lo que trae shadcn y los tokens quedan como variables CSS |
| CSS Modules | Alternativa evaluada; descartada: los tokens como clases de Tailwind compartidas con shadcn evitan mantener un segundo sistema de estilos † |

**Elección:** Tailwind CSS v4.
**Motivo:** integración directa con shadcn/ui; los tokens son variables CSS que el tema claro y el oscuro sobrescriben; sin JS para el modo oscuro.

**Reglas de uso**
- Los tokens viven como variables CSS (`:root` y su versión oscura) y se exponen como utilidades con `@theme inline` (`bg-background`, `text-income`…). Nada de hex ni `rgb()` sueltos en componentes.
- Valores arbitrarios (`[...]`) solo para medidas que no son tokens, como `env(safe-area-inset-*)`.
- La variante `hover:` de Tailwind v4 ya compila a `@media (hover: hover)`: úsala para hover; el feedback táctil va con `active:`.
- `cn()` (clsx + tailwind-merge) para combinar clases.
- Piso de navegadores: Safari 16.4+, Chrome 111+, Firefox 111+, el de Next 16 (según la documentación de la versión instalada). Tailwind v4 pide Safari 16.4+, Chrome 111+ y Firefox 128+: no baja el piso en móvil.

### D4. Componentes

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| shadcn/ui con primitivas **Base UI**, código copiado al repo | **Elegida** (Base UI es el default de shadcn: a verificar en KAN-33 al correr `shadcn init`) |
| shadcn/ui con primitivas Radix | Descartada: Base UI es el default de shadcn (a verificar en KAN-33) † |
| Radix o Base UI solos, sin shadcn | Descartada: habría que escribir y mantener a mano el estilo y los estados de cada componente † |
| Componentes propios desde cero | Descartada: reimplementar accesibilidad (foco, teclado, ARIA) en cada componente † |
| HeroUI v3 | Descartada: dependencia npm y riesgo de reescritura v2 a v3 |

**Elección:** shadcn/ui con Base UI, código copiado a `components/ui`.
**Motivo:** el código es nuestro (sin dependencia de librería de UI); accesibilidad de las primitivas; los tokens usan nombres shadcn más `income` / `expense` / `debt`, de modo que una futura librería nativa (React Native Reusables o HeroUI Native) pueda mapearlos. La librería nativa se decide al empezar el nativo.

**Reglas de uso**
- Se añaden con la CLI de shadcn y se ajustan a Menta (tokens, radios, tamaños táctiles). Si falta un componente, no lo escribas desde cero.
- Cada componente del catálogo (KAN-34) se prueba a 360 px en sus estados: normal, foco, presionado, deshabilitado, error y carga, en claro y oscuro.
- Iconos de shadcn: `iconLibrary: "phosphor"` en `components.json` (ver D5).

**Hecho en KAN-34: componentes base y catálogo**

| Componente | Archivo | API (props) | Estados |
|---|---|---|---|
| `Button` | `components/ui/button.tsx` | `variant` (`default`, `secondary`, `outline`, `ghost`, `destructive`, `link`), `size` (`default` 52 px y `sm` 44 px **como mínimo**: la etiqueta larga se parte en varias líneas y el botón crece, nunca se trunca ni desborda; `icon` 44×44: `aria-label` obligatorio por tipos, con `button.check.tsx` como canario), `loading`, y las props de Base UI (`disabled`, `onClick`…) | Normal, presionado (`active:`), foco, deshabilitado y cargando. Cargando: spinner junto a la etiqueta (el botón crece un poco para hacerle sitio), ignora clics (y el envío del formulario), `aria-busy` y `aria-disabled`, mantiene el color y el foco. Deshabilitado expone `aria-disabled` (sigue enfocable) |
| `Input` | `components/ui/input.tsx` | Props de `<input>` | 48 px, texto de 16 px, borde `--input`, fondo sólido `card-solid`. Foco, deshabilitado, `aria-invalid` |
| `Field` (API compuesta de shadcn) | `components/ui/field.tsx` | `<Field>` agrupa `<FieldLabel htmlFor>`, un `<Input id>`, `<FieldDescription id>` y `<FieldError id>` (acepta `errors` de react-hook-form o hijos); `FieldGroup` separa varios campos. El **llamador enlaza**: `htmlFor`/`id`, `aria-invalid` y `aria-describedby` con los ids de la descripción y del error. Pon `data-invalid` en `<Field>` con error. "(opcional)" va como `<span>` dentro del label | Label visible ligada al input; el error (`role="alert"`) lleva icono y texto, nunca solo color. No traduce: recibe el texto en español |
| `TextField` (KAN-26) | `components/text-field.tsx` (compone `Field`, no es de shadcn) | `label`, `error` (texto en español), `description`, `optional`, `id` (por defecto `useId`) y las props de `<input>`, `ref` incluido: sirve para `{...register("campo")}`. Un `aria-describedby` que pases se conserva | Enlaza solo `htmlFor`/`id`, `aria-invalid`, `aria-describedby` (descripción y error, en ese orden) y `data-invalid` en el `Field`. Sin `error` no pone `aria-invalid`. Probado en `text-field.test.tsx` y, con los campos reales, en `login-form.test.tsx`. **KAN-40:** `startIcon` (ícono Phosphor decorativo, `aria-hidden`, dentro del borde izquierdo; el texto gana `pl-11`) y `endAction` (control de 44 px en el borde derecho; el texto gana `pr-14`). El placeholder nunca sustituye al label |
| `PasswordField` (KAN-40) | `components/password-field.tsx` (compone `TextField`) | Las props de `TextField` menos `type` y `endAction` | Campo de contraseña con botón de ojo de 44×44 px (`Button` `ghost` `icon`, `type="button"`, íconos `Eye` / `EyeSlash`). Su nombre cambia con el estado: "Mostrar contraseña" / "Ocultar contraseña" (el nombre que dice lo que hará el toque se lee igual en todos los lectores; `aria-pressed` con nombre fijo anuncia el estado dos veces). Solo alterna `type` (`password` / `text`) sobre el mismo input: no pierde el valor ni el autocompletado. Probado en `password-field.test.tsx` |
| `Card` | `components/ui/card.tsx` | `variant`: `glass` (tile bento, token `card`) o `solid`; partes `CardHeader`, `CardTitle` (`as`), `CardDescription`, `CardContent` | Los formularios van en `solid` |
| `Alert` | `components/ui/alert.tsx` | `variant` (`error` con `role="alert"`, `info` con `role="status"`), `title`, `action`, hijos | Icono y texto, nunca solo color |
| `Skeleton` | `components/ui/skeleton.tsx` | Props de `<div>` | Decorativo (`aria-hidden`); el contenedor lleva `aria-busy`. Sin animación con `prefers-reduced-motion` |
| `Empty` (API compuesta de shadcn) | `components/ui/empty.tsx` | `<Empty>` con `<EmptyHeader>` (`<EmptyMedia variant="icon">` con un icono Phosphor duotone, `<EmptyTitle>`, `<EmptyDescription>`) y `<EmptyContent>` para la acción | Invita a actuar |
| `Toaster` | `components/ui/sonner.tsx` | Props de Sonner | Montado en `layout.tsx`; ver D8 |
| `AppShell` | `components/app-shell.tsx` | `title`, `actions` (aquí va "Cerrar sesión", KAN-27), `children` | Header `glass` sticky, columna de 448 px, dos blobs, safe areas en los cuatro lados |

- **Foco** de todos los controles: `components/ui/focus.ts` (`outline-solid` de 2 px con offset y color `ring`). **Nunca añadas `outline-none` ni `outline-hidden` a un control**: en Tailwind v4 fijan `--tw-outline-style: none` y el anillo no se pinta (`focus.test.ts` lo vigila). Si lo cambias, mantén 3:1.
- **Errores del backend:** `describeApiError(error)` (`lib/core/i18n.ts`) devuelve `{ title, message }` en español para un `ApiError` (por `code`; en un 422 por `type`; si no, por status), un fallo de red o cualquier otra cosa, y nunca muestra el `detail` en inglés ni un código crudo. Un código nuevo del backend necesita su traducción en ese archivo. `fieldErrorMessage(type)` traduce el `type` de un 422 para marcar un campo.
- **CLI de shadcn:** `shadcn add` añadió `cn` y `next-themes` a `package.json` y generó componentes de 32 px con el estilo por defecto. Se revirtió `package.json` (el repo usa su `cn()` de `lib/utils.ts` y `Toaster` usa `theme="system"`) y se rehicieron los estilos a Menta. Tras cada `shadcn add`, revisa `git diff package.json package-lock.json`. Los archivos generados importan `cn` del paquete `cn` (dependencia transitiva de `shadcn`): cámbialo a `@/lib/utils`. `Field`, `Empty`, `Label` y `Separator` salen de `shadcn add field empty` y se ajustaron a Menta (label en negrita, error con icono, media de 42 px); no hay componentes propios que los reemplacen. Para react-hook-form el cableado de ids lo hace `TextField` (KAN-26); con `Field` directo (checkbox, grupos de radios), el llamador enlaza `htmlFor`/`id`, `aria-invalid` y `aria-describedby` a mano.
- **Catálogo** (`/catalog`): `src/app/catalog/page.dev.tsx` muestra cada componente en sus estados (normal, foco, deshabilitado, cargando, error), en claro y oscuro (según el sistema), con datos extremos (etiquetas y errores largos, monto enorme) y un panel "Auditoría" que, al ancho actual (prueba con 360, 375, 393 y 430 px), lista los controles menores de 44 px, los elementos que se salen de la pantalla (mide cada elemento, porque `AppShell` recorta el desbordamiento horizontal) y los botones o enlaces con el texto recortado. `/catalog?title=<texto largo>` prueba un título largo en el header (hasta dos líneas, luego se corta). El estado "Foco" aplica el mismo anillo sin esperar a Tab.
- **Solo en local:** los archivos se llaman `page.dev.tsx` y `layout.dev.tsx`, y `next.config.ts` solo acepta la extensión `dev.tsx` en `next dev` (`lib/env/page-extensions.ts`, con test). En `next build` y `next start` la ruta no se registra ni se compila. Comprobado: `/catalog` no aparece en la salida del build ni en `.next/server/app-paths-manifest.json`. Una ruta de catálogo nueva debe llamarse `*.dev.tsx` (los componentes que no son rutas pueden ser `.tsx`). `proxy.ts` (KAN-27) debe dejar pasar `/catalog` sin sesión. Efecto secundario: `.next/dev/types` (que crea `npm run dev`) conoce `/catalog` y haría fallar el chequeo de tipos del build; por eso `package.json` tiene un script `prebuild` (multiplataforma, con `fs.rmSync`) que borra `.next/dev` antes de cada `npm run build`. No hay que borrarlo a mano.

**Verificado en KAN-33** (con `shadcn` 4.21.2, en una copia desechable): `shadcn init` ofrece **Base UI como primitiva recomendada** (`--base base`; el preset por defecto es `base-nova`); el paquete es **`@base-ui/react`** (1.8.0); `iconLibrary` por defecto es `lucide` y `phosphor` es un valor válido (lo usa el preset `lyra`), así que `components.json` se escribió a mano con `"iconLibrary": "phosphor"`. Además `init` añade `tw-animate-css` y el paquete `shadcn` (`@import "shadcn/tailwind.css"` trae las variantes `data-open`/`data-closed` que usan los componentes), ambos ya instalados, y un `utils.ts` que importa un paquete `cn` de npm: el repo usa su propio `cn()` con `clsx` + `tailwind-merge`. `init` no se corrió en el repo para no sobrescribir `globals.css`/`layout.tsx` ni generar `button.tsx` (es de KAN-34); al hacer `shadcn add`, revisa que no traiga `lucide-react` ni reescriba los tokens.

### D5. Iconos

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Phosphor (`@phosphor-icons/react`) | **Elegida** |
| lucide-react | Alternativa evaluada; descartada: un solo estilo de trazo, sin fill ni duotone que la dirección visual usa † |

**Elección:** Phosphor.
**Motivo:** varios pesos (regular, fill, duotone) que Menta usa; shadcn lo soporta como `iconLibrary`. Para el nativo, `phosphor-react-native` es comunitario; el fallback es SVG con licencia MIT y `react-native-svg`.

**Reglas de uso**
- Regular a 20–22 px en general. **Fill** solo en el tab activo (con su pill glass). **Duotone** en color `primary` para iconos de categoría o tile, dentro de contenedores de 42 px.
- Importa **siempre** de `@phosphor-icons/react/ssr`, en Server y en Client Components (verificado en KAN-33: funciona dentro de `"use client"` y en Server Components). ESLint prohíbe el import raíz (`no-restricted-imports`, decidido en KAN-33); se pierde `IconContext`, que no usamos.
- Forma del import: **con nombre desde `/ssr`** (`import { House } from "@phosphor-icons/react/ssr"`). Sin `import *` ni rutas profundas por archivo. Con `experimental.optimizePackageImports` (abajo) Next carga solo los iconos usados, así que el barrel de `/ssr` es correcto (regla `bundle-barrel-imports` de la skill `vercel-react-best-practices`).
- Iconos decorativos con `aria-hidden`; un botón solo con icono lleva `aria-label` en español.

**Hecho en KAN-33:** `@phosphor-icons/react` y `@phosphor-icons/react/ssr` están en `experimental.optimizePackageImports` de `next.config.ts` (no están en la lista por defecto de Next 16). Medido con un build de prueba: una página que importa dos iconos de `/ssr` (una desde un Server Component y otra desde un Client Component) lleva un chunk de ~3 kB sin ningún otro icono, con o sin la entrada de `/ssr`; la entrada se deja por si el modo dev se beneficia.

### D6. Fuentes

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Montserrat (600/700) + Karla (400–700) | **Elegida** (dirección visual Menta) |
| Fuente del sistema | Descartada: sin identidad propia y los numerales cambian entre iOS y Android † |
| Una sola familia para todo | Descartada: la dirección visual separa números y títulos del texto corrido † |

**Elección:** Montserrat 600/700 para números y títulos; Karla 400–700 para texto.
**Motivo:** identidad "Menta"; Montserrat da legibilidad y presencia a los montos y lleva `tnum`, así que los montos se alinean en columnas; que Karla también tenga `tnum` (cifras en texto corrido) se verifica en KAN-34.

**Reglas de uso**
- Carga con `next/font/google` (autoalojada en el build, subset `latin`, que cubre el español).
- Montos y cifras comparables con `tabular-nums` (`font-variant-numeric`).
- Escala tipográfica en D13.
- **Fuente de marca (KAN-40):** Bricolage Grotesque ExtraBold (800, tamaño óptico 96, `letter-spacing: -0.03em`) solo para el nombre "Kanza" (logotipo y cabecera del login). Va por `next/font/local` (`components/brand/brand-font.ts`, woff2 de 21,7 kB en `src/app/fonts/`), no por `next/font/google`: este no deja fijar el tamaño óptico con un solo peso (con `weight` fijo rechaza `axes`; con `weight: "variable"` baja el rango completo, ~77 kB). Clases `font-brand`, `tracking-brand` (`--tracking-brand: -0.03em`) y `text-brand` (`--text-brand: 1.4375rem`, 23 px: el tamaño del login), definidas en `globals.css`. Se declara en el componente del nombre y no en `layout.tsx`, para que solo las rutas que lo muestran lo precarguen. Licencia OFL en `marca-kanza.md`.

**Verificar en KAN-34:** que el archivo de fuente que sirve `next/font` conserva `tnum` en Montserrat y en Karla. El catálogo (sección "Cifras") trae una columna de montos y una fila `1111 / 8888` en cada fuente. **Pendiente de ojo humano:** no se pudo comprobar sin navegador; si las cifras no son tabulares, anótalo aquí.

### D7. Formularios

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| react-hook-form + zod | **Elegida** |
| `useActionState` nativo (Server Actions) | Alternativa evaluada; descartada: las Server Actions no existen en la app nativa y los esquemas zod de core no se reutilizarían † |

**Elección:** react-hook-form + zod.
**Motivo:** esquemas zod en core, reutilizables en web y nativo; validación en el cliente; submit con `useMutation` de TanStack Query, coherente con D2.

**Reglas de uso**
- El esquema zod vive en `lib/core/schemas/`; el formulario usa `zodResolver`.
- El **422 de FastAPI se mapea a campos** (`setError`); un error que no es de campo va a un mensaje del formulario o a un toast.
- Submit con `useMutation`; al terminar con éxito, invalida las queries afectadas.
- Campos de 48 px, botón primario de 52 px, label visible en cada campo, texto del input ≥16 px. Montos con `inputmode="decimal"` y como máximo `exponent` decimales (D11).
- Cada campo de texto es un `TextField` (D4). El `<form>` lleva `noValidate`: los mensajes los da el esquema, en español, no el navegador. Un error que no es de campo (el de Firebase o el del backend al canjear la sesión) va en un `Alert` dentro del formulario. Los esquemas de `lib/core/schemas/auth.ts` (KAN-26) son el ejemplo: el esquema de formulario (`email`, `password`) no es el cuerpo del request, así que no lleva la comprobación `_check` contra el tipo generado.
- Teclado móvil por campo: `type`, `inputMode`, `autoComplete` (`username` / `current-password` al entrar; `email` / `new-password` al registrarse), `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}` y `enterKeyHint`.
- Los tipos de las peticiones y respuestas siguen siendo los generados: un esquema zod valida el formulario, no sustituye al tipo del API.

**Verificado en KAN-33:** `@hookform/resolvers` 5.9.1 acepta `zod ^3.25 || ^4` y `react-hook-form ^7.55` como peers; con `zod` 4.6.5 y `react-hook-form` 7.89 un `zodResolver` valida y devuelve errores por campo (prueba desechable, no se versionó).

### D8. Toasts con "Deshacer"

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Sonner (vía shadcn) | **Elegida** |
| Toast de Base UI | Descartada: Sonner es el que integra shadcn y trae la acción y el gesto de cerrar listos † |
| Toast propio | Descartada: reimplementar cola, apilado y accesibilidad † |

**Elección:** Sonner, con acción "Deshacer".
**Motivo:** integración con shadcn y una acción de primera clase (`action: { label, onClick }`).

**Reglas de uso**
- Un solo `<Toaster />`, montado en `layout.tsx`; `toast()` solo desde código cliente. Consulta la skill `ask-sonner` (`.claude/skills/ask-sonner/`).
- El toast es cromo flotante: usa el token `glass` (D14), con el fallback sólido de D13 › Glass.
- Posición por encima de la nav inferior y de la safe area (`offset` / `mobileOffset`: `16px + env(safe-area-inset-bottom)`; la nav, cuando exista, lo subirá). **Duración 6000 ms** (KAN-34; el valor por defecto de Sonner son 4000 ms), para poder llegar a "Deshacer". El botón "Deshacer" mide 44 px y lleva el anillo de foco del proyecto (`focus.ts`) con `!`, porque el foco propio de Sonner es casi invisible sobre glass. Sonner inyecta CSS sin capa: sus variables (`--normal-bg`…) se fijan en `sonner.tsx` y las utilidades que lo pisan llevan `!`.
- Copy: la misma palabra en acción y confirmación: "Eliminaste «Café»" + **Deshacer**. El borrado es suave (`deleted_at`), así que deshacer restaura el registro y se invalidan las queries.

### D9. Gráficos

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Diferir: barras CSS (lista accesible) en v1; `Progress` en v1.1 | **Elegida** para v1 |
| shadcn Charts (Recharts 3) | **Elegida** para el primer gráfico real: variables CSS, `accessibilityLayer` con teclado |
| Nivo | Solo para un tipo que Recharts no tenga (calendar heatmap, sankey), añadiendo solo ese `@nivo/*` con tema mapeado a tokens |

**Elección:** no instalar librería de gráficos en v1.
**Motivo:** el top-5 del dashboard (B) cabe en barras CSS con semántica de lista; presupuestos y metas (v1.1) son barras de progreso. Contras de Nivo: último release v0.99.0 (mayo 2025), tema como objeto JS (sin variables CSS) y ARIA parcial.

**Reglas de uso**
- v1: top-5 por categoría como barras CSS dentro de una lista accesible (texto con categoría, monto y porcentaje; la barra no es lo único que informa).
- v1.1: presupuestos y metas con `Progress`.
- `chart-1..5` se definen con el primer gráfico real (hasta entonces no existen).

### D10. Tests

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| vitest + Testing Library | **Elegida** |
| Jest | Descartada: más configuración para TypeScript y módulos ESM, sin ventaja para este proyecto † |
| Playwright con un solo navegador | Descartada: en iOS, en la práctica, casi todos los navegadores son WebKit (la UE permite otros motores desde iOS 17.4) y Safari es la referencia, así que se prueban los dos motores |

**Elección:** vitest + Testing Library para lógica y componentes; Playwright para E2E en dos proyectos: **"iPhone"** (WebKit) y **"Pixel"** (Chromium, con **viewport de 360 px de ancho**).
**Motivo:** cubre los dos motores móviles; el ancho de 360 px es el mínimo que garantizamos.

**Reglas de uso**
- Tests de lógica junto al archivo (`*.test.ts` o `*.test.tsx`), solo para lógica no trivial: formateo de dinero y fechas, traducciones, esquemas y utilidades. Tests de componentes solo para lógica no trivial.
- E2E en `e2e/`, 3–5 flujos reales; los escribe qa.
- Los tests de formato de dinero comparan con el espacio **NBSP** (U+00A0) entre símbolo y cifra y con el signo menos **U+2212** (ver D11). Esos tests corren en Node: la salida de WebKit y Chromium se contrasta aparte (Pendientes).
- WebKit de Playwright aproxima Safari iOS, no lo reemplaza: la prueba en dispositivo real sigue siendo obligatoria (skill `mobile-native`).

### D11. Formato de dinero y fechas

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Locale derivado de la moneda del espacio, con mapa fijo en core | **Elegida** |
| Locale del dispositivo | Descartada: el mismo monto se vería distinto según el teléfono, y el servidor no conoce el locale del dispositivo (mismatch de hidratación casi seguro) |
| Decimales por excepción de moneda | Descartada: se usa una regla genérica: mostrar `exponent` decimales (opción A) |

**Elección y reglas**
- **Mapa fijo en core:** UYU → es-UY, COP → es-CO, USD → es-UY; **fallback es-UY**. Una moneda desconocida muestra su código. Nunca el locale del dispositivo.
- **Decimales (opción A):** la fuente de verdad es el exponente ISO 4217. Se muestran **siempre exactamente `exponent` decimales** (`minimumFractionDigits` y `maximumFractionDigits` explícitos, iguales). Lo mostrado es lo guardado. El input acepta como máximo `exponent` decimales. El frontend no tiene tabla propia de monedas: el backend expone el exponente con la moneda del espacio (`SpaceRead.currency.exponent`).
- Los montos llegan como enteros en la unidad menor (10^exponent). Para mostrarlos se convierten a **texto decimal con operaciones sobre enteros o cadenas** (nunca `/ 100` ni floats) y esa cadena se pasa a `Intl.NumberFormat`, que formatea cadenas decimales de forma exacta.
- **Signo:** el gasto va con el signo menos tipográfico **"−" (U+2212)**, generado con `formatToParts` (reemplazando la parte `minusSign`, que `Intl` emite como "-" ASCII). El ingreso va con "+". Entre símbolo y cifra `Intl` pone NBSP (U+00A0).
- **Fechas** siempre con la **zona horaria del espacio** (`spaces.timezone`); el servidor corre en UTC. Los instantes (`timestamptz`) se convierten a esa zona. La fecha de una transacción es un `date` local sin hora: se formatea tal cual, sin aplicar zona horaria (así no se corre un día).
- Hallazgos de `Intl`, **verificados solo en Node 24** (no en WebKit ni en Chromium): es-UY muestra COP como "COP" y es-CO muestra UYU como "UYU"; `Intl` formatea COP con 0 decimales (redondea) si no se le pasan los decimales explícitos.
- **El servidor y el navegador no comparten ICU.** El texto lo formatea en el servidor el ICU de Node y en el cliente el de cada navegador (Safari trae el suyo), y pueden diferir en espacios (NBSP o NNBSP), símbolos o separadores de grupo. Fijar el locale por moneda y los decimales explícitos reduce las diferencias, pero no las garantiza cero: por eso se compara la salida real (ver Pendientes).

Ejemplos (unidad menor → texto; salida de Node 24, otro motor podría variar espacios o símbolos):

| Moneda | Locale | Unidad menor | Texto |
|---|---|---|---|
| UYU (exp. 2) | es-UY | `155050` | `$ 1.550,50` |
| COP (exp. 2) | es-CO | `123450` | `$ 1.234,50` |
| USD (exp. 2) | es-UY | `123450` | `US$ 1.234,50` |
| CLP (exp. 0, fuera del mapa) | es-UY | `1500` | `CLP 1.500` |
| UYU, gasto | es-UY | `-155050` | `−$ 1.550,50` |

**Motivo:** el formato depende del espacio y no del teléfono, lo mostrado coincide con lo guardado y se minimiza el riesgo de mismatch de hidratación entre servidor y cliente.

**Contrato:** `SpaceRead` (`GET /spaces`, `GET /spaces/{id}`) ya expone `currency { code, exponent }` y `timezone`; `formatMoney` recibe exactamente ese `currency` y los formateadores de fecha reciben `timezone`. (Esta nota decía que faltaban hasta BE-09; se corrigió en KAN-33.)

**Implementación (KAN-33):** `lib/core/locale.ts`, `lib/core/money.ts` (`formatMoney`, `minorToDecimalString`) y `lib/core/dates.ts` (`formatLocalDate`, `formatInstant`, `todayInTimezone`), con tests. `formatMoney` acepta `number` entero seguro, `bigint` o `string`; el signo "+" se pide con `{ sign: "exceptZero" }` y el cero nunca lleva signo. Con Node 24 (ICU de `.nvmrc`) la hora sale como `11:30 p. m.` con espacios normales; la comparación con WebKit y Chromium sigue pendiente (§4).

### D12. Modo oscuro

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Seguir el sistema con CSS `prefers-color-scheme` | **Elegida** para v1 |
| Toggle manual con `next-themes` | Después de v1 |
| Solo tema claro | Descartada: la dirección Menta incluye paleta oscura |
| Clase `.dark` activada por JavaScript desde el inicio | Descartada: depende de un script y puede parpadear al cargar † |

**Elección:** modo oscuro en v1, siguiendo el sistema con CSS `prefers-color-scheme`, con dos paletas.
**Motivo:** sin JS y sin flash; el color del navegador (`theme-color`) cambia por esquema.

**Reglas de uso**
- Dos paletas completas (D14); contraste AA verificado en ambas en el catálogo de KAN-34.
- `theme-color` por esquema con el export `viewport` de Next: claro `#E9F4EE` y oscuro `#08110D` (el `--background` de cada paleta), más `colorScheme: "light dark"`.
- La variante `dark:` de Tailwind v4 sigue `prefers-color-scheme` por defecto: no hay que configurar nada para usarla.
- El CSS que genera `shadcn init` usa la clase `.dark` (`@custom-variant dark (&:is(.dark *))`); en KAN-33 `globals.css` se escribió a mano sin esa línea, con la paleta oscura dentro de `@media (prefers-color-scheme: dark)`.
- Un toggle manual (next-themes) podrá añadirse después sin rehacer los tokens.

### D13. Dirección visual "Menta"

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Dirección A (comparada en el mockup) | Descartada; el detalle está en el mockup |
| Dirección B (comparada en el mockup) | Descartada; el detalle está en el mockup |
| "Menta" | **Elegida** |

**Brief:** confianza, amigable, ordenada, moderna. Bento limpio + glass estilo iPhone pero original. Verde, blanco y negro, más modo oscuro.
**Elección:** "Menta".
**Motivo:** equilibra confianza (verde sobrio, jerarquía clara de cifras) y calidez; el glass da carácter sin sacrificar legibilidad porque se limita al cromo flotante.

**Tipografía** (fuentes en D6; todas las cifras con `tabular-nums`)

| Uso | Fuente | Tamaño / peso |
|---|---|---|
| Neto (cifra principal) | Montserrat | 36 / interlineado 1,1 · 600 · −0,02em |
| Título de pantalla | Montserrat | 24 · 700 |
| Título de sección | Montserrat | 16–19 · 700 |
| Monto en tile | Montserrat | 18 · 600 |
| Monto en lista | Montserrat | 15 · 600 |
| Título de ítem | Karla | 15 · 700 |
| Cuerpo | Karla | 16 |
| Secundario | Karla | 13–14 (mínimo 13) |
| Label de la nav | fuente por fijar en la tarea que cree la nav (no en KAN-34) | 11 · 600/700 (excepción al mínimo de 13) |
| Texto de inputs | Karla | ≥16 (evita el zoom de iOS) |

**Espaciado:** base de 4 px (escala de Tailwind). Gutter 16. Gap del bento 10. Padding de tile 14–16. Área táctil ≥44. Botón primario 52. Campos 48.

**Radios**

| Elemento | Radio |
|---|---|
| Tile / hero | 28 |
| Contenedor de icono | 14–16 |
| Campo | 16 |
| Nav | 30 |
| Borde superior de la hoja (sheet) | 30 |
| Botones, chips y segmented | Pill (totalmente redondeado) |

**Glass**
- Solo en cromo flotante (nav, sheet, toast, header sticky) y en tiles bento o grupos sobre el fondo decorativo.
- Qué token usa cada superficie: **tiles bento y grupos → `card`**; **nav, toast y header sticky → `glass`**; **sheet → `glass-strong`** (D14).
- Nunca por fila de lista (un grupo glass por día); nunca en popovers, menús ni texto largo.
- Fallback a `card-solid` con `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` y con `prefers-reduced-transparency: reduce`. La consulta lleva las dos formas porque Safari 16.4–17 solo soporta `backdrop-filter` con prefijo `-webkit-` y ese es el piso de navegadores de D3 (`@supports not (backdrop-filter)` no es una condición válida: le falta el valor). En Safari 16.4–17 se cumple la variante `-webkit-`, así que el `not` da falso: **el fallback no se activa y se ve el glass**. El fallback solo se activa en un navegador sin soporte de ninguna de las dos formas o con `prefers-reduced-transparency: reduce`. El soporte de `prefers-reduced-transparency` es desigual: no dependas solo de ella.
- El CSS de glass declara `backdrop-filter` y `-webkit-backdrop-filter`. **Verificado en KAN-33 sobre el CSS del build** (`.next/static/chunks/*.css`): `.glass` y `.glass-strong` traen ambas declaraciones (primero la prefijada); existe `@supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px)))` (Lightning CSS reordena las dos formas, equivalente) y `@media (prefers-reduced-transparency:reduce)`; ambos van **después** de la paleta oscura y reasignan `--card`, `--glass` y `--glass-strong` a `card-solid`. La reducción de transparencia además quita el blur. **Falta confirmar en hardware:** que un Safari 16.4–17 real **muestre el glass** y que el fallback se vea bien con `prefers-reduced-transparency: reduce` y en un Android de gama baja.
- Máximo 2 blobs decorativos por pantalla, estáticos y con `aria-hidden`.
- Probar en un Android de gama baja.

**Movimiento:** 150–250 ms, `ease-out` al entrar, la hoja con spring de drawer, nada animado durante el scroll, respetar `prefers-reduced-motion`.

**Iconos:** ver D5 (regular 20–22 px; fill solo en el tab activo; duotone `primary` en contenedores de 42 px).

**Tono y copy (UX writing)**
- Tuteo ("tú"), sentence case y verbos: "Guardar gasto".
- La misma palabra en la acción y en la confirmación: "Eliminaste «Café»" + Deshacer.
- Los errores dicen qué pasó, qué hacer y que los datos están a salvo; sin disculpas.
- Los estados vacíos invitan a actuar.

### D14. Tokens

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Variables CSS con nombres shadcn + tokens de finanzas (`income`, `expense`, `debt`) | **Elegida** |
| Solo la paleta por defecto de Tailwind, sin nombres semánticos | Descartada: sin tokens semánticos no hay tema claro y oscuro ni mapeo a nativo † |
| Herramienta de tokens externa (por ejemplo Style Dictionary) | Descartada: complejidad innecesaria con un solo cliente hoy † |

**Elección:** variables CSS con nombres de shadcn (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--destructive`…) más las de finanzas (`--income`, `--expense`, `--debt`).
**Motivo:** los componentes de shadcn funcionan sin renombrar; `income` / `expense` / `debt` expresan el dominio; una futura librería nativa (React Native Reusables o HeroUI Native) puede mapearlos; todos los pares de texto cumplen AA (tabla de abajo).

Se definen como variables CSS (`:root` y su versión oscura) y se exponen con `@theme inline`; los radios son `--radius-tile` (28), `--radius-icon` (16), `--radius-field` (16), `--radius-nav` (30) y `--radius-sheet` (30) (clases `rounded-tile`, `rounded-icon`…; `--radius: 1rem` alimenta la escala `sm`…`4xl` de shadcn) y los blobs `--blob-1` y `--blob-2` (`bg-blob-1`, `bg-blob-2`). Las superficies glass son utilidades: `card-surface` (blur 20 px; se mantiene, falta verlo en dispositivo), `glass` (24 px) y `glass-strong` (28 px).

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `background` | `#E9F4EE` | `#08110D` | Fondo de la app |
| `foreground` | `#0E1A14` | `#EAF5EF` | Texto principal |
| `card` (glass) | `rgba(255,255,255,0.62)` | `rgba(28,44,36,0.55)` | **Tiles bento y grupos de lista** sobre el fondo decorativo |
| `card-solid` | `#F7FBF9` | `#142019` | Fallback sólido de `card` |
| `card-foreground` | = `foreground` | = `foreground` | Texto sobre `card` |
| `popover` | `#FFFFFF` | `#12201A` | Popovers y menús: **sólido, nunca glass** |
| `popover-foreground` | = `foreground` | = `foreground` | Asumido en FE-06 (no figuraba en la sesión) |
| `primary` | `#146E4D` | `#6EDDAA` | Acción principal, iconos de categoría, ingresos |
| `primary-foreground` | `#FFFFFF` | `#062016` | Texto sobre `primary` |
| `secondary` | `#CBEBDC` | `#173B2C` | Acciones secundarias, chips |
| `secondary-foreground` | `#0D4A33` | `#A9EFCF` | Texto sobre `secondary` |
| `muted` | `#DCEBE3` | `#15221C` | Superficies atenuadas |
| `muted-foreground` | `#4F6158` | `#A0B6AA` | Texto secundario y placeholders |
| `accent` | `#D7EEE2` | `#1A2C24` | Hover y selección |
| `accent-foreground` | = `foreground` | = `foreground` | Texto sobre `accent` |
| `destructive` | `#B3261E` | `#FF9B8A` | **Solo** errores y acciones destructivas; nunca gastos |
| `destructive-foreground` | `#FFFFFF` | `#2B0A06` | Texto sobre `destructive` |
| `border` | `rgba(14,26,20,0.10)` | `rgba(255,255,255,0.10)` | **Decorativo**: separadores y tarjetas |
| `input` | `rgba(14,26,20,0.48)` | `rgba(255,255,255,0.40)` | **Borde de los controles** (campos, selectores). El alfa oscuro subió de 0,34 a 0,40 en KAN-34 para llegar a 3:1 sobre cualquier superficie |
| `ring` | `#146E4D` | `#6EDDAA` | Foco visible |
| `income` | = `primary` | = `primary` | Ingresos, con "+" (token separado) |
| `expense` | = `foreground` | = `foreground` | Gastos, con "−" |
| `debt` | `#96560A` | `#F0B45A` | Deuda de tarjetas |
| `glass` | `rgba(255,255,255,0.58)` | `rgba(20,32,26,0.60)` | **Nav, toasts y header sticky**; desenfoque 24 px |
| `glass-strong` | `rgba(255,255,255,0.74)` | `rgba(16,28,22,0.82)` | **Sheets**; desenfoque 28 px |
| `glass-border` | `rgba(255,255,255,0.9)` | `rgba(255,255,255,0.10)` | Borde de superficies glass |
| blobs decorativos | `#9FE0BF`, `#CDEFD9` | `#1E6B4C`, `#12432F` | Fondo decorativo (máximo 2 por pantalla) |
| `chart-1..5` | por definir | por definir | Se definen con el primer gráfico real |

**Reglas de uso**
- **Controles:** el borde de campos y selectores usa `--input` (≥3:1), no `--border`. `--border` queda para separadores y tarjetas y nunca es el único indicador de un estado o de un control.
- **Dinero:** `income` con "+", `expense` con "−" y color `foreground`, `debt` en ámbar. El signo informa, no solo el color. `destructive` nunca marca un gasto.
- **Superficies:** tiles bento y grupos de lista → `card` (glass); nav, toast y header sticky → `glass`; sheet → `glass-strong`; popovers y menús → `popover` (sólido). Fuera de esos casos y como fallback de glass, `card-solid`. Glass solo donde D13 › Glass lo permite.
- **Campos sobre glass:** `Input` pinta su propio fondo `card-solid`, así que se ve igual en cualquier superficie; aun así, los formularios van en `Card variant="solid"`. Desde KAN-34 (`--input` oscuro con alfa 0,40) el borde también llega a 3:1 sobre `card` con un blob detrás.
- **Foco:** `ring` visible; en un botón `primary` separa el anillo con un offset del color del fondo para que se distinga del relleno.
- Radios y tamaños: tablas de D13.

**Contraste verificado en FE-06** (WCAG 2.x, cálculo propio; la composición glass se calcula sobre la superficie y el blob de debajo)

| Par | Claro | Oscuro |
|---|---|---|
| `foreground` / `background` | 15,84 | 17,15 |
| `muted-foreground` / `background` | 5,86 | 8,91 |
| `muted-foreground` / `muted` | 5,35 | 7,65 |
| `primary-foreground` / `primary` | 6,24 | 10,27 |
| `secondary-foreground` / `secondary` | 8,05 | 9,38 |
| `foreground` / `accent` | 14,63 | 13,15 |
| `destructive` / `background` | 5,80 | 9,40 |
| `destructive-foreground` / `destructive` | 6,54 | 8,97 |
| `primary` / `background` (texto, iconos) | 5,54 | 11,48 |
| `debt` / `background` | 5,13 | 10,38 |
| Peor caso de texto sobre glass con blob (`foreground`, `muted-foreground`, `primary`, `debt`; `card`, `glass`, `glass-strong`) | 4,88 (`debt` sobre `glass`) | 4,81 (`muted-foreground` sobre `card`) |
| `destructive` sobre `card-solid` / `popover` (error de `Field` y de `Alert`) | 6,26 / 6,54 | 8,24 / 8,26 |
| `muted-foreground` sobre `card-solid` (placeholder) | 6,32 | 7,81 |
| `primary` sobre `secondary` (icono de estado vacío, no texto, ≥3) | 4,89 | 7,41 |
| `ring` / `background` (no texto, ≥3) | 5,54 | 11,48 |
| `input` sobre `background` (no texto, ≥3) | 3,13 | 3,80 |
| `input` sobre `card-solid` / `popover` | 3,18 / 3,21 | 3,76 / 3,77 |
| `input` sobre `glass-strong` con blob (peor caso) | 3,13 | 3,63 |
| `input` sobre `card` con blob (peor caso) | 3,09 | 3,04 |
| `input` sobre `glass` con blob (peor caso) | 3,09 | 3,26 |
| `border` sobre `background` (decorativo) | 1,23 | 1,28 |

Todos los pares de texto superan 4,5:1 y todos los no-texto 3:1. Antes de KAN-34, `input` sobre `card` con un blob detrás en oscuro quedaba en 2,61:1; se subió el alfa de `--input` a 0,40 (3,04:1). `src/app/tokens.test.ts` comprueba estos pares, incluidos los translúcidos compuestos sobre el fondo y cada blob (con el alfa antiguo ese test falla). Los pares de `muted-foreground` y `primary` de la tabla de arriba usan hex sólidos; los de glass, los calcula el test.

### D15. Viewport y móvil

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Diseñar a 360 px y ampliar | **Elegida** |
| Diseñar a 390 px y encoger | Descartada: 360 px es el mínimo que garantizamos y los Android pequeños se romperían † |
| Solo web móvil sin pensar en nativo | Descartada: iPhone y Android web primero, luego nativo |

**Elección:** diseñar para **360 px de ancho** (iPhone y Android web; luego nativo). Matriz de prueba: **375** (iPhone SE), **~393** (iPhone) y **~430** (Pro Max / Pixel).
**Motivo:** el mínimo garantizado manda; lo que cabe a 360 px cabe en los demás.

**Reglas de uso** (detalle y porqués en la skill `mobile-native`)
- **Safe areas:** `viewport-fit=cover` y `env(safe-area-inset-*)` para el botón "+" fijo, la nav inferior, los toasts y las hojas. Ya los aplican `AppShell` (arriba, abajo y a los lados) y el `Toaster` (abajo); cada elemento fijo nuevo debe aplicarlos con fallback `env(..., 0px)` y probarse en hardware.
- **Alto:** `dvh` o `svh`, nunca `100vh`.
- **Teclado:** `interactive-widget=resizes-content` (en Next, `viewport.interactiveWidget`). iOS ignora esa propiedad y superpone el teclado; Chrome Android ≥108 también lo superpone por defecto. Prueba el formulario en la hoja inferior (bottom sheet) en un dispositivo real, en iOS y en Android.
- **Inputs ≥16 px** (evita el zoom de iOS). Nunca `user-scalable=no` ni `maximum-scale=1`.
- **Táctil:** `-webkit-tap-highlight-color: transparent` con un `:active` propio en cada elemento pulsable; hover solo bajo `@media (hover: hover)`; `touch-action: manipulation` en botones y enlaces.
- **Overscroll:** `overscroll-behavior: none` en `html` y `body`; `contain` en contenedores internos con scroll.
- **Export `viewport` de Next**, con `viewportFit: "cover"`, `interactiveWidget: "resizes-content"`, `colorScheme: "light dark"` y `themeColor` por esquema (D12).
- Emulación de Chrome no reproduce nada de esto: cada cambio de este bloque se confirma en hardware real.

### D16. Identidad Kanza

Definida el 2026-10-06 (KAN-40 [FE-09]). Guía completa, archivos y licencias en [`marca-kanza.md`](marca-kanza.md).

**Elección**
- **Nombre:** Kanza (de "¿me al-kanza?"). **Lema:** "Haz que alcance".
- **Ícono de app y marca principal:** el grillo verde menta asomado por encima de una moneda gigante que sujeta con las patitas, sobre una baldosa verde bosque `#146e4d` ("B2 · Detrás de la moneda"). La misma pieza sirve en claro y en oscuro.
- **Mascota:** el grillo. El de cuerpo entero quedó archivado; en la app solo se usa la cabeza asomada (`kanza-peek.svg`).
- **Favicon:** versión simplificada del ícono (cabeza más grande, antenas gruesas, moneda lisa) para menos de 32 px.
- **Login:** fila superior con el ícono (40 px) y "Kanza" (Bricolage Grotesque 800, 23 px, -0.03em, `text-primary`), y la cabeza del grillo asomada sobre la tarjeta del formulario.
- **Tarjeta del login:** primero el formulario (correo con ícono de sobre y placeholder `tu@correo.com`, contraseña con ícono de candado, placeholder y botón de ojo, aviso de error, botón "Iniciar sesión" / "Crear cuenta"), luego el separador "o" y al final "Continuar con Google" (como el mockup K-Login). El título de la página ("Entrar") y el h1 ("Entra a tu cuenta") no cambian.

**Reglas de uso**
- Archivos en `public/` (favicon, apple-touch-icon, manifest) y `public/brand/` (SVG); se registran en `metadata` de `layout.tsx`. El `theme-color` sigue por esquema (D12); `#146e4d` solo es el `theme_color` del manifest.
- Título de pestaña: "Kanza" (`%s · Kanza` en las pantallas que definen el suyo).
- Íconos de marca junto a texto visible: `alt=""`. Nombre en `text-primary` (contraste 5,54 claro / 11,48 oscuro sobre `background`). Ícono completo desde 32 px; por debajo, el favicon.
- El peek va en un contenedor `relative` sobre la tarjeta: `-top-18.5 right-5.5` (74 px arriba y 22 px a la derecha), 120×90 px, `z-10`, y 80 px libres encima de la tarjeta (`mt-14` + `gap-6`): la caja del peek sube 74 px sobre la tarjeta, así que no llega al título (y su parte superior es transparente).
- Fuera de v1 / otras tareas: pantalla de carga, avisos del grillo y estados vacíos con la mascota, registro formal de marca.
- Los estáticos de marca son públicos: `proxy.ts` (KAN-27) debe dejar pasar sin sesión `/favicon.ico`, `/favicon.svg`, `/site.webmanifest`, `/brand/*` y los `*.png` de `public/`, o el ícono del login y la pestaña se romperían.

## 3. Skills de apoyo

Están en `.claude/skills/`. Las convenciones del proyecto ganan sobre las skills; si una skill contradice este documento o `CLAUDE.md`, sigue al proyecto y anótalo.

| Skill | Cuándo | Nota |
|---|---|---|
| `mobile-native` | Siempre en pantallas y componentes | Safe areas, hover, teclado, `dvh`, zoom, `theme-color` |
| `vercel-react-best-practices` | Siempre al escribir React y Next | Reglas en `.claude/skills/vercel-react-best-practices/rules/`. Overrides: `client-swr-dedup` → usamos TanStack Query; `server-cache-lru` está prohibido con datos de usuario (`no-store`) |
| `ask-sonner` | Al trabajar con toasts ("Deshacer") | Un solo `<Toaster />`; `toast()` solo desde el cliente |
| `break-ui` | Al cerrar una pantalla o componente | Datos extremos: nombres largos, montos enormes, listas vacías |
| `frontend-design` | La usa la sesión principal para proponer pantallas nuevas | No re-decide fuentes ni tokens: lo aprobado en este documento manda |

## 4. Pendientes

Estado tras KAN-33 [FE-07]. Lo ya hecho consta en las decisiones de arriba y en `frontend/CLAUDE.md` (actualizado en esa tarea: stack, comandos, estructura, `lib/core`, TanStack Query, tests).

| Pendiente | Estado / lo resuelve |
|---|---|
| Actualizar `frontend/CLAUDE.md` | Hecho (KAN-33) |
| ESLint: `no-restricted-imports` para core (fusionado con la regla de `process`) y Phosphor siempre desde `/ssr` | Hecho (KAN-33) |
| Verificaciones de `shadcn init`, de `@hookform/resolvers` con zod 4 y de `optimizePackageImports` | Hecho (KAN-33): ver D4, D5 y D7 |
| Glass: CSS generado con ambas declaraciones y fallback | Hecho sobre el CSS del build (KAN-33). **Pendiente de hardware:** Safari 16.4–17 real, `prefers-reduced-transparency: reduce` y Android de gama baja (Juan David o qa) |
| Export `viewport` (`viewportFit`, `interactiveWidget`, `themeColor` por esquema, `colorScheme`) | Hecho (KAN-33). Prueba en dispositivo real pendiente |
| Adaptar el CSS de shadcn a `prefers-color-scheme` y definir tokens, radios y blobs | Hecho (KAN-33) |
| Convención de errores tipados para el `queryFn` y dónde viven las query keys / `queryOptions` | Hecho (KAN-33): `unwrap` + `ApiError`, `lib/core/data/<recurso>.ts` |
| Comprobar en `typecheck` que un esquema zod de request es asignable al tipo generado | Patrón documentado en `CLAUDE.md` (Formularios); se aplica con el primer esquema real (no existe ninguno aún) |
| Playwright: instalar, proyectos "iPhone" (WebKit) y "Pixel" (Chromium, viewport de 360 px) | **No se instaló en KAN-33** (decisión de Juan David: no hay specs ni CI de frontend aún). Lo resuelve la primera sub-tarea de E2E (qa) |
| Comparar la salida del formateador de dinero y fechas en Node con la de WebKit y Chromium (diferencias de ICU: NBSP o NNBSP, símbolos, separadores de grupo) | Con el E2E de iPhone y Pixel (misma sub-tarea que Playwright) |
| `Toaster` de Sonner montado en `layout.tsx` | Hecho (KAN-34) |
| `lib/core/i18n.ts` (mapa único de traducciones) | Hecho (KAN-34): errores del backend (`describeApiError`, `fieldErrorMessage`). Los valores de dominio (`expense`, `pending`, `credit_card`…) se añaden con la primera pantalla que los muestre |
| `lib/core/schemas/` | Hecho (KAN-26): `auth.ts` (login y registro) |
| `tnum` de Montserrat y Karla con el archivo que sirve `next/font` | Catálogo hecho (KAN-34). **Pendiente de ojo humano** en el catálogo (sección "Cifras") |
| Contraste AA en claro y oscuro, incluido `--input` sobre cada superficie y los pares con alfa o blob | Hecho (KAN-34): `--input` oscuro subió a alfa 0,40 y `tokens.test.ts` compone los pares translúcidos sobre fondo y blobs. Falta verlo en pantalla (catálogo, claro y oscuro) |
| `popover-foreground` asumido igual a `foreground` | Hecho (KAN-34): `popover-foreground` sobre `popover` tiene su par en `tokens.test.ts` y `Toaster` y los popovers usan `foreground` |
| Excepción del label de la nav de 11 px y su fuente | Se decide en la tarea que cree la nav inferior (no hay nav en KAN-34) |
| Safe areas: `AppShell` y `Toaster` ya aplican `env(safe-area-inset-*)` (KAN-34); cada elemento fijo nuevo (nav inferior, botón "+", sheet) debe aplicarlo y **todo se prueba en hardware** (un iPhone con notch y uno con home indicator) | Juan David o qa; la nav, el botón "+" y el sheet, en sus tareas |
| Foco por defecto: la base usa `outline-ring` sólido (3:1 mínimo; con `/50` quedaba en ~2,15:1 en claro); un test lo comprueba. Los componentes que cambien el foco deben mantener 3:1 | Hecho (KAN-34): todos los controles usan `components/ui/focus.ts` (outline sólido, con test) |
| Blur de `card-surface` (20 px, elegido en KAN-33 porque D13/D14 no lo fijan) | Se mantiene en 20 px; Juan David lo confirma viendo el catálogo en un dispositivo real |
| Duración del toast con "Deshacer" (Sonner usa 4000 ms por defecto; valorar más tiempo) | Hecho (KAN-34): 6000 ms (D8) |
| Revisión humana del catálogo: dirección visual, 360/375/393/430 px, claro y oscuro, panel "Auditoría", foco con Tab, en un iPhone y un Android reales | Juan David o qa (KAN-34) |
| Revisar los motivos marcados con † (motivos redactados en FE-06) | Juan David, en el repaso |
| Identidad Kanza (KAN-40) a ojo y en hardware: el favicon legible a 16 px en pestaña clara y oscura (Chrome, Safari y Firefox), el login a 360 / 375 / 393 / 430 px en claro y oscuro (fila de marca, grillo sobre la tarjeta sin tapar el título, sin desbordes), el contraste del nombre cerca del blob y la carga de Bricolage sin salto visible | Juan David o qa |
| `proxy.ts` (KAN-27) debe excluir los estáticos de marca de la redirección a `/login` (D16) | KAN-27 |
| Login (KAN-26) en hardware: popup de Google en Safari iOS (que el primer toque abra la ventana, sin `auth/popup-blocked`: el SDK se calienta al montar la pantalla, ver `CLAUDE.md` > Sesión) y en un Android real (con el emulador no se puede: escucha solo en `127.0.0.1`; hace falta el proyecto de staging), 360 / 375 / 393 / 430 px en claro y oscuro, y el teclado abierto en el formulario | Juan David o qa |
| Cookie de sesión en un navegador real (`Set-Cookie` de `POST /api/auth/session` a través del rewrite y de vuelta en `browserApi`): curl lo confirmó en KAN-26; falta el navegador (`/catalog` > "Probar GET /me") | Juan David |

Dependencias instaladas en KAN-33 (`tailwindcss`, `@tailwindcss/postcss`, `tw-animate-css` y `shadcn` van en devDependencies: solo se usan en el build, `tw-animate-css` y `shadcn` como `@import` de CSS): `tailwindcss`, `@tailwindcss/postcss`, `tw-animate-css`, `shadcn`, `class-variance-authority`, `clsx`, `tailwind-merge`, `@base-ui/react`, `@phosphor-icons/react`, `sonner`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react` y `@testing-library/dom`. Dependencia añadida en KAN-26: `firebase` (SDK modular; el código usa solo `firebase/app` y `firebase/auth`, en `lib/firebase.ts`). `npm audit` marca `@grpc/grpc-js` (de `@firebase/firestore`, solo servidor/Node): no entra en el bundle del navegador porque no se importa Firestore. No se instalan: `@playwright/test` (ver arriba), `@testing-library/jest-dom` y `user-event` (cuando un test los necesite), `vite-tsconfig-paths` (Vite 8 resuelve los alias con `resolve.tsconfigPaths`), `recharts` (con el primer gráfico real), `next-themes` ni Zustand (v1).
