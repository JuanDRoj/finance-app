# Diseño y librerías (frontend)

Estado: **aprobado por Juan David el 2026-10-05** · Tarea KAN-32 [FE-06] (historia KAN-31, HU-6 Sistema de diseño base) · Lo implementaron KAN-33 (setup) y KAN-34 (componentes base y catálogo); KAN-26 (login) añadió `TextField`; KAN-41 (`AppShell` responsive) añadió la barra lateral, el menú del avatar, el globo y los tokens `sidebar` y `tooltip`; KAN-69 (FE-15) añadió la barra inferior, la pantalla «Más» y rehízo la barra lateral según Escritorio v2; KAN-70 (FE-16) añadió el formulario de la primera cuenta con su panel lateral, la moneda del espacio y el Inicio sin cuentas; KAN-91 (FE-27) añadió los tokens de Escritorio v2 (`surface`, `scrim`…), `Sheet`, `Dialog`, el campo de dinero, el segmentado y el selector.
Dirección visual "Menta": mockup de referencia en https://claude.ai/artifact/WdpLUxb8M6VgXupjqezr5M. Nombre de la app: **Kanza** (identidad en [D16](#d16-identidad-kanza) y en [`marca-kanza.md`](marca-kanza.md), KAN-40).
Pantallas de Kanza en celular, tablet y escritorio (claro y oscuro): https://claude.ai/artifact/QhYwACgCTYJHpApRSWLgRa (responsive en [D17](#d17-web-responsive-y-escritorio); las del Hito 1 en celular, con prefijo `K-H1-`, en [Navegación del Hito 1](#navegación-del-hito-1-kan-63) y [D18](#d18-primer-uso-y-cuentas-hito-1); las de escritorio, con prefijo `K-V2-`, en [D17](#escritorio-v2-2026-10-21) y D18. Todas las de escritorio salen del componente base `K-V2-Escritorio`: sus props `vista` y `capa` dicen qué pantalla y qué panel o diálogo muestra).

## Cómo usar este documento

- **Al empezar una pantalla nueva, ve a la sección 1 (checklist).** Te dice qué librería, token y componente usar y te lleva a la decisión que lo justifica.
- Precedencia: este documento y `CLAUDE.md` ganan sobre cualquier skill (ver [`../../.claude/third-party-skills.md`](../../.claude/third-party-skills.md)). `CLAUDE.md` manda en comandos y convenciones de código; este documento, en librerías, tokens y dirección visual.
- Cada decisión se presenta igual: **Opciones evaluadas** (tabla), **Elección**, **Motivo**, **Reglas de uso** y, si aplica, **Verificar en KAN-33/34**.
- Los motivos de las opciones descartadas los dio Juan David o los revisó y aprobó en KAN-62. Hasta entonces, los que FE-06 había redactado sin que la sesión de diseño los dictara llevaban una †; ya no queda ninguna.
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
| Gráficos (dashboard v1) | shadcn Charts (Recharts) desde el Hito 1: evolución del neto e ingresos y gastos por mes; top-5 en barras CSS | [D9](#d9-gráficos) |
| Tests | vitest + Testing Library; E2E Playwright Escritorio (Chromium, 1280 px, el principal), iPhone (WebKit) y Pixel (Chromium, 360 px) | [D10](#d10-tests) |
| Dinero y fechas | Locale por moneda del espacio; `exponent` decimales; zona horaria del espacio | [D11](#d11-formato-de-dinero-y-fechas) |
| Modo oscuro | Sí en v1, siguiendo el sistema con CSS | [D12](#d12-modo-oscuro) |
| Dirección visual | "Menta" (verde/blanco/negro + oscuro, bento + glass) | [D13](#d13-dirección-visual-menta) |
| Tokens | Nombres shadcn + `income` / `expense` / `debt` | [D14](#d14-tokens) |
| Viewport y móvil | Escritorio primero (1280 y 1440 px); el celular tiene sus pantallas; 360 px mínimo; matriz 375 / ~393 / ~430 | [D15](#d15-viewport-y-móvil) |
| Identidad de marca | Kanza: ícono del grillo con la moneda, favicon simplificado, lema "Haz que alcance" | [D16](#d16-identidad-kanza) |
| Web responsive y escritorio | Menos de 1024 px: barra inferior (Hito 1: Inicio · Movimientos · + · Cuentas · Más); desde 1024 px: barra lateral ancha con nombres (240 px, oscura, de una pantalla de alto), tarjetas sólidas a todo el ancho, crear y editar en un panel lateral derecho, avisos y elecciones cortas en diálogos centrados (Escritorio v2, 2026-10-21) | [D17](#d17-web-responsive-y-escritorio) |
| Primer uso y Cuentas (Hito 1) | Inicio vacío con el grillo y la moneda; formulario de cuenta en página (celular) o panel lateral (escritorio); Cuentas por Disponible y Deuda, con detalle de la cuenta y sus movimientos en escritorio; archivar con saldo 0 y Deshacer; cuadrar en hoja (celular) o en el panel (escritorio) | [D18](#d18-primer-uso-y-cuentas-hito-1) |

## 1. Checklist para una pantalla nueva

Sigue los pasos en orden. Entre paréntesis, la decisión que lo respalda.

1. **Contrato.** Confirma que los endpoints y campos existen en `../backend/openapi.json` y que `src/lib/api/schema.d.ts` está generado. Si falta algo, la tarea queda **bloqueada** hasta que backend lo exponga; no lo inventes. (`CLAUDE.md`)
2. **Datos.** Prefetch en el Server Component con `getServerApi()` + `HydrationBoundary`; en el cliente `useQuery` / `useInfiniteQuery` sobre funciones de `lib/core`. Tras mutar, invalida las queries afectadas. (D1, D2)
3. **Estados de pantalla.** Carga, vacío (invita a actuar) y error (qué pasó + qué hacer + datos a salvo). (D13 › Tono)
4. **Layout.** Parte de los dos artboards de la pantalla: el de escritorio (`K-V2-*`, 1440 px) y el de celular (`K-H1-*`, 360 px). Revisa 1280 y 1440, luego 1024 y 768, y al final 360, 375, ~393 y ~430. En el código, la base de Tailwind es el celular y `lg:` el escritorio. Safe areas, `dvh`/`svh` (nunca `100vh`), inputs ≥16 px. (D15, D17)
5. **Componentes.** Busca en `components/ui`, en `components/app-shell.tsx` y en el catálogo (`npm run dev` → http://localhost:3000/catalog; tabla de abajo y D4). Si falta, añádelo con la CLI de shadcn (Base UI), revisa lo que genera y ajústalo a Menta; no lo escribas desde cero. (D4)
6. **Tokens.** Solo clases de token (`bg-background`, `text-muted-foreground`, `text-income`…). Nada de hex ni `rgb()` sueltos. Dinero: `income` / `expense` / `debt`. Glass solo en cromo flotante y tiles: tiles bento → `card` bajo 1024 px y `surface` desde 1024 px; nav, toast y header sticky → `glass`; sheet y panel lateral → `glass-strong`. (D14, D13 › Glass, D17 › Escritorio v2)
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
| Marco de una pantalla con sesión (encabezado plano con título, barra inferior bajo 1024 px, barra lateral flotante desde 1024 px con el menú de la cuenta abajo, safe areas, fondo) | `AppShell` de `components/app-shell.tsx`; le pasas `user` (el de `GET /me`) y `space` (el de `GET /spaces`), que obtienes juntos con `loadShellData(await getServerApi())`; `hideBottomNav` en las pantallas de formulario con «Volver» | D4, D17 |
| Texto de un error del API | `describeApiError(error)` de `lib/core/i18n.ts` + `Alert` | D4, `CLAUDE.md` |
| Menú de acciones (abre con un botón) y globo con el nombre de un ícono | `DropdownMenu` y `Tooltip` de `components/ui` (KAN-41) | D4, D17 |
| Panel lateral (crear y editar, desde 1024 px), hoja inferior (elecciones cortas, bajo 1024 px) y diálogo centrado (avisos y elecciones cortas, desde 1024 px) | `Sheet` (`side="right"` o `"bottom"`) y `Dialog` de `components/ui` (KAN-91); componer `SheetContent` > `SheetHeader` + `SheetBody` + `SheetFooter`. La tabla aún no existe: se añade en la tarea que la necesite | D4, D17 |
| Un monto escrito por la persona | `MoneyField` (`components/money-field.tsx`) con la moneda del espacio, y `parseMoneyInput` de `lib/core/money.ts` para pasarlo a la unidad menor | D4, D11 |
| Elegir una entre pocas opciones (el tipo de cuenta) o un día del 1 al 31 | `SegmentedControl` y `SelectField` (`components/`, KAN-91) | D4 |
| Tile bento o grupo de lista sobre el fondo decorativo | `Card variant="tile"`: token `card` (glass) bajo 1024 px; desde 1024 px, tarjeta sólida `surface` con borde y radio `card` (20 px) (utilidad `tile-surface`, KAN-91) | D13, D14, D17 |
| Nav flotante, toast, header sticky | Token `glass` | D13, D14 |
| Barra lateral de escritorio (desde 1024 px) | `Sidebar` (`components/sidebar.tsx`), dentro de `AppShell`: tarjeta flotante oscura de 240 px en los dos temas, con los tokens `sidebar*`, de una pantalla de alto y `sticky`. Lleva el logo con el nombre, el espacio, el botón de la acción principal, las secciones con nombre y, abajo, Categorías y la cuenta del usuario con su menú. Una sección nueva es una entrada más de `NAV_SECTIONS` (`components/nav-sections.ts`) | D14, D17 |
| Barra inferior de celular y tablet (bajo 1024 px) | `BottomNav` (`components/bottom-nav.tsx`), dentro de `AppShell`: tarjeta glass flotante con las pestañas de `NAV_SECTIONS`, el «+» en medio y «Más» si cuelga algo de él. Sin cambiar nada más, una sección nueva aparece en las dos barras | D13, D17 |
| Hoja inferior (sheet) y panel lateral | Token `glass-strong` (ya lo aplica `SheetContent`) | D13, D14 |
| Superficie sólida (fallback, campos de formulario) | `card-solid`; popovers y menús: `popover` | D13, D14 |
| Barra de progreso o top-5 | Barras CSS accesibles (v1), `Progress` (v1.1) | D9 |
| Un color | Token; nunca un valor suelto | D14 |
| Probar datos extremos | Skill `break-ui` | sección 3 |

## 2. Decisiones

### D1. Arquitectura del cliente

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Todo en `components/` y `lib/` sin frontera con Next | Descartada: la futura app nativa tendría que reescribir formatos, esquemas y llamadas a la API |
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
| SWR | Descartada: el proyecto estandariza una sola librería de datos y TanStack Query trae el patrón oficial de hidratación del App Router, `useInfiniteQuery` y `useMutation` |
| `fetch` + `useEffect` / `useState` a mano | Descartada: obliga a reimplementar caché, refetch y estados de carga y error |
| Server Actions + `revalidatePath` solos | Descartada: sin caché en el cliente, y no existen en la app nativa |
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
| CSS Modules | Alternativa evaluada; descartada: los tokens como clases de Tailwind compartidas con shadcn evitan mantener un segundo sistema de estilos |

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
| shadcn/ui con primitivas **Base UI**, código copiado al repo | **Elegida** (Base UI es el default de shadcn: verificado en KAN-33 al correr `shadcn init`) |
| shadcn/ui con primitivas Radix | Descartada: Base UI es el default de shadcn (verificado en KAN-33) |
| Radix o Base UI solos, sin shadcn | Descartada: habría que escribir y mantener a mano el estilo y los estados de cada componente |
| Componentes propios desde cero | Descartada: reimplementar accesibilidad (foco, teclado, ARIA) en cada componente |
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
| `TextField` (KAN-26) | `components/text-field.tsx` (compone `Field`, no es de shadcn) | `label`, `error` (texto en español), `description`, `optional`, `id` (por defecto `useId`) y las props de `<input>`, `ref` incluido: sirve para `{...register("campo")}`. Un `aria-describedby` que pases se conserva | Enlaza solo `htmlFor`/`id`, `aria-invalid`, `aria-describedby` (descripción y error, en ese orden) y `data-invalid` en el `Field`. Sin `error` no pone `aria-invalid`. Probado en `text-field.test.tsx` y, con los campos reales, en `login-form.test.tsx`. **KAN-40:** `startIcon` (ícono Phosphor decorativo, `aria-hidden`, dentro del borde izquierdo; el texto gana `pl-11`) y `endAction` (control de 44 px en el borde derecho; el texto gana `pr-14`). **KAN-91:** `inputClassName` (clases del `<input>`; `className` sigue siendo del `Field`). El placeholder nunca sustituye al label |
| `PasswordField` (KAN-40) | `components/password-field.tsx` (compone `TextField`) | Las props de `TextField` menos `type` y `endAction` | Campo de contraseña con botón de ojo de 44×44 px (`Button` `ghost` `icon`, `type="button"`, íconos `Eye` / `EyeSlash`). Su nombre cambia con el estado: "Mostrar contraseña" / "Ocultar contraseña" (el nombre que dice lo que hará el toque se lee igual en todos los lectores; `aria-pressed` con nombre fijo anuncia el estado dos veces). Solo alterna `type` (`password` / `text`) sobre el mismo input: no pierde el valor ni el autocompletado. Al tocar el ojo el foco y el cursor se quedan en el input (`mousedown` se cancela: el teclado del móvil no se cierra); el foco nunca se mueve, así que con teclado o lector de pantalla se queda en el botón, que anuncia su nuevo nombre. Al enviar el formulario vuelve a `type="password"` antes de que el navegador lo lea, para que el gestor de contraseñas ofrezca guardarla (si el esquema rechaza el envío, queda oculta de nuevo). Probado en `password-field.test.tsx` |
| `MoneyField` (KAN-91) | `components/money-field.tsx` (compone `TextField`) | `currency` (`{ code, exponent }` del espacio), `tone` (`default` o `debt`) y las props de `TextField` menos `type`, `startIcon` y `endAction` | Campo de monto (D18): delante, el símbolo de la moneda del espacio (`currencySymbolOf`: "$", "US$", "R$", "€"; nunca un "$" fijo), decorativo; cifras Montserrat 600 de 18 px con `tabular-nums`; `inputMode="decimal"`, sin autocompletar ni autocorrección; `tone="debt"` pinta las cifras con `debt` (la "Deuda actual" de una tarjeta, que se escribe positiva). El padding izquierdo sale del largo del símbolo (`ch`), así que "US$" cabe. A los lectores de pantalla les dice la moneda ("Moneda: Peso uruguayo · UYU") dentro de `aria-describedby`. Solo edita texto: el paso a unidad menor es `parseMoneyInput`. Sirve con `register()`. Probado en `money-field.test.tsx` |
| `SelectField` (KAN-91) | `components/select-field.tsx` | `label`, `error`, `description`, `optional`, `placeholder`, `id` y las props de `<select>`; los hijos son las `<option>` | `<select>` nativo (en el móvil abre el selector del sistema) con el cableado de `TextField` (`htmlFor`/`id`, `aria-invalid`, `aria-describedby`, `data-invalid`). 48 px, texto de 16 px, borde `--input`, fondo `card-solid` y flecha decorativa. `placeholder` añade una primera opción vacía en color atenuado ("Elige"): con ella nada queda preseleccionado (los días de cierre y de vencimiento de una tarjeta). Sirve con `register()`. Probado en `select-field.test.tsx` |
| `SegmentedControl` (KAN-91) | `components/segmented-control.tsx` | `legend`, `options` (`{ value, label }[]`), `name`, `value`/`defaultValue`, `onChange`, `onBlur`, `ref`, `error`, `disabled` | `fieldset` de radios nativos ocultos (flechas, Tab y el anuncio "radio 2 de 3" los da el navegador), en una píldora con borde `--input`. El segmento elegido se rellena en `primary` con texto en negrita (no depende solo del color); cada segmento mide 44 px como mínimo y parte la etiqueta larga en varias líneas; el foco de teclado dibuja el anillo del proyecto. Sirve con `register()`. Probado en `segmented-control.test.tsx` |
| `Sheet` (KAN-91) | `components/ui/sheet.tsx` (sobre Base UI Dialog; escrito a mano: ver CLAUDE.md) | `Sheet`, `SheetTrigger`, `SheetContent` (`side`: `right` o `bottom`; `closeLabel` para la hoja), `SheetHeader` (`showClose`), `SheetTitle`, `SheetDescription`, `SheetBody`, `SheetFooter`, `SheetClose` | Modal: foco atrapado y devuelto al disparador, Escape y el velo (`bg-scrim`, sin desenfoque) lo cierran, la página detrás queda inerte, `initialFocus` para llevar el foco a un campo. **`side="right"`, el panel lateral (desde 1024 px, D17 › Escritorio v2):** flota a 12 px de los bordes (o la safe area), 440 px (`max-w` de la pantalla menos 24 px), `glass-strong`, `rounded-sheet` (30), `shadow-panel`; cabecera con el título a la izquierda y «Cerrar» de 44 px a la derecha, cuerpo con scroll propio y pie "Cancelar · acción" abajo a la derecha. **`side="bottom"`, la hoja (bajo 1024 px):** ancho completo, radio 30 arriba, `shadow-sheet`, relleno inferior de 24 px más la safe area, "grabber" decorativo (`aria-hidden`: la hoja no se arrastra) y un «Cancelar» visible de 44 px al final del contenido (el cierre que no depende de Escape ni del velo). Todo `SheetContent` necesita un `SheetTitle`. Probado en `sheet.test.tsx` |
| `Dialog` (KAN-91) | `components/ui/dialog.tsx` (sobre Base UI Dialog) | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose` | Diálogo centrado de 480 px (24 px de aire a los bordes), `popover` sólido, nunca glass, `rounded-dialog` (24), `shadow-dialog`, título de 22 px (`text-panel-title`; el lienzo dibuja 21). Solo para avisos y elecciones cortas ("Moneda de tu espacio"); crear y editar va en el panel. Mismo comportamiento modal que `Sheet`. Siempre con un «Cancelar» (`DialogClose`) en el pie, a la izquierda de la acción. Probado en `dialog.test.tsx` |
| `AccountForm`, `AccountPanelHost`, `AccountPanelSheet` (KAN-70) | `components/accounts/` (cliente) | `AccountForm`: `space` (`{ id, currency }`), `variant` (`page` o `panel`), `onDone`, `onCancel` y `api` (el cliente de la API, por defecto el del navegador). `AccountPanelHost`: `space` (opcional). `AccountPanelSheet`: `open`, `space`, `onClose`, `api` | **El formulario de «Nueva cuenta» (D18), un componente en dos contenedores.** react-hook-form + `accountFormSchema(exponent)` + `useMutation(createAccount)`; solo crea (editar es `AccountEditForm`). Tipo con `SegmentedControl`, **siempre con uno elegido** («Banco»); nombre con el ejemplo según el tipo («Ej.: Itaú», «Ej.: Billetera», «Ej.: Visa Itaú»); `MoneyField` «Saldo actual» (banco, efectivo) o «Deuda actual» en `debt` (tarjeta), con la ayuda del lienzo; en tarjeta, «Día de cierre» y «Día de vencimiento» (`SelectField`, **sin día preseleccionado**: «Elige»). Un 422 marca los campos que nombra (`initial_balance_minor` es el saldo) y el resto, o un fallo de red o un 404, va a un `Alert` en español; un 401 lleva a `/login`. Un solo envío: el botón queda ocupado mientras corre y después de crear. Sin conexión la petición queda pausada y el formulario avisa con el texto de un fallo de red. Al terminar invalida `["spaces", id]`, muestra «Creaste «…»» y llama a `onDone`; **el contenedor** sale del formulario y hace `router.refresh()` (la barra lateral y el Inicio vienen del servidor): el panel cierra y después refresca, para que el refresco no traiga de vuelta `?cuenta=nueva`, y el foco va al `h1` de la pantalla (el botón que lo abrió puede desaparecer con el refresco); la página `/cuentas/nueva` hace `router.refresh()` y `router.back()` si se llegó desde la app (el historial queda en `[/]` y el Inicio se pide de nuevo al servidor, no se muestra el cacheado) o `router.replace("/")` si se abrió directo. **`page`** (bajo 1024 px, `/cuentas/nueva`): «Crear cuenta» a todo el ancho; **`panel`** (desde 1024 px): los campos en la parte que scrollea y «Cancelar · Crear cuenta» en el pie. **`AccountPanelHost`** (montado por `AppShell`) abre el panel cuando la URL trae `?cuenta=nueva` y hay 1024 px o más (lo carga con `next/dynamic` y lo deja montado, cerrado, para su salida); cerrarlo quita el parámetro con `history.replaceState` (sin entradas de historial ni petición); bajo 1024 px manda a `/cuentas/nueva`. **`AccountPanelSheet`** es el `Sheet` `right` «Nueva cuenta» con el foco inicial en el nombre. Probado en `account-form.test.tsx`, `account-panel.test.tsx` y `account-panel-sheet.test.tsx` |
| `PrimaryActionLink` (KAN-70) | `components/primary-action-link.tsx` (cliente) | `href`, `panel` (`{ param, value }`, opcional) y las props de `Link` | El enlace de la acción principal: el botón de la barra lateral y «Crear mi primera cuenta» del Inicio. Es un enlace real a una página (`href`, lo que ve un celular, un clic con Ctrl o en otra pestaña); desde 1024 px un clic normal no navega: abre el panel (`?{param}={value}`). El ancho se pregunta con `matchMedia` en el clic, así el servidor y el cliente pintan lo mismo. Sin prefetch. El «+» de la barra inferior es un `Link` normal: solo se ve bajo 1024 px. Probado en `primary-action-link.test.tsx` |
| `BackLink` (KAN-70) | `components/back-link.tsx` (cliente) | `fallbackHref` (por defecto `/`), `className` | El «Volver» de una pantalla de formulario (`AppShell` `leading`): flecha redonda de 44 px, `aria-label="Volver"`. Va atrás en el historial si se llegó desde esta misma app (hay una entrada anterior y el `referrer` es del mismo origen); si se abrió directo, es un enlace a `fallbackHref`. Probado en `back-link.test.tsx` |
| `CurrencyCard` y `CurrencyPicker` (KAN-70) | `components/currency/` (cliente) | `CurrencyCard`: `space` (`{ id, currency: { code } }`), `className`, `api`. `CurrencyPicker`: `space`, `open`, `onOpenChange`, `chosen`, `onChoose`, `api` | **La moneda del espacio (D18).** La tarjeta muestra «Moneda de tu espacio», «Peso uruguayo · UYU» (`describeCurrency`), «Cambiar» y «Puedes cambiarla hasta que registres tu primer movimiento.»: una fila glass con la nota debajo bajo 1024 px y una tarjeta sólida (`surface`, radio 20) con el ícono, el título, la moneda, la nota y el botón apilados desde 1024 px; es el mismo marcado (la fila es `lg:contents` y el botón `lg:order-last`). El Inicio no la dibuja si `space.currency_locked`. «Cambiar» abre el selector: **diálogo** de 480 px desde 1024 px y **hoja inferior** bajo 1024 px (`useIsDesktop`; la elección vive en la tarjeta, así que un cambio de ancho no la pierde). La lista sale de `GET /currencies` al abrir, en el orden de `CURRENCY_NAMES` (`orderCurrencies`), con un solo reintento (y ninguno ante un 401): esqueleto de 6 filas, error con «Reintentar» y, sin red, el aviso de conexión. En el diálogo de escritorio el nombre mide 15 px y el código 14 px sin negrita, con radios de 18 px; en la hoja, 16 px, código en negrita y radios de 22 px (como el lienzo). El ícono de la tarjeta es la moneda con el signo de dólar en celular y un billete desde 1024 px. «Usar esta moneda» sin cambio solo cierra; con cambio hace `PATCH` y, si sale bien, invalida `["spaces"]`, hace `router.refresh()` y cierra. Un **409** `space_has_transactions` (el espacio recibió su primer movimiento mientras tanto) se explica dentro («Ya no puedes cambiar la moneda»), apaga el botón y refresca la página **al cerrar**, no antes, para que la tarjeta no desaparezca mientras se lee. Probado en `currency-card.test.tsx` |
| `FirstUse` y `AccountsSummary` (KAN-70) | `app/_components/first-use.tsx` y `accounts-summary.tsx` (servidor) | `AccountsSummary`: `accounts`, `currency` | **`FirstUse`**: la tarjeta del Inicio sin cuentas: el grillo (`kanza-symbol.svg`, 120 px y 140 px desde `lg`, `alt=""`), «Empieza por tus cuentas», el texto de D18 y el botón «Crear mi primera cuenta» (un `PrimaryActionLink` al formulario de cuenta, que no cambia cuando FE-20 cambie la acción principal). Centrada en una columna bajo 1024 px; el grillo a la izquierda y el texto alineado a la izquierda desde 1024 px. **`AccountsSummary`**: «Tus cuentas», lo que el Inicio muestra mientras FE-24 no exista: una fila por cuenta (ícono duotone del tipo en `primary-soft`, o en `debt` suave si es tarjeta; nombre cortado con «…»; el tipo en español o «Cierra el 5 · vence el 12»; el monto con `formatMoney`). Una tarjeta se muestra por lo que debe, en positivo y en `debt`; una cuenta en descubierto, con «−». Desde KAN-71 cada fila enlaza a `/cuentas?sel=<id>`. El Inicio usa una u otra, y las deja lado a lado con la tarjeta de la moneda desde 1024 px (hasta 1120 px) |
| `AccountIcon` (KAN-71) | `components/accounts/account-icon.tsx` | `type` (`bank`, `cash`, `credit_card`), `size` (`md` 42 px en celular y 36 px desde 1024 px, `sm` 36 px, `lg` 48 px), `className` | El ícono duotone del tipo de cuenta en su tile (`primary-soft`; una tarjeta en `debt` suave). Decorativo (`aria-hidden`): el nombre al lado dice qué es. Lo usan el Inicio y Cuentas |
| `AccountEditForm`, `ReconcileForm`, `AccountEditPanel`, `ArchiveBlocked`, `AccountLink` (KAN-92) | `components/accounts/` (cliente) y `components/ui/alert-dialog.tsx` | `AccountEditForm`: `account`, `space`, `variant` (`page` o `panel`), `onDone(saved)`, `onArchived`, `onReconcile`, `onCancel`, `api`. `ReconcileForm`: `account`, `space`, `variant` (`panel` o `sheet`), `onDone`, `onCancel`, `api`. `AccountEditPanel`: `open`, `view` (`editar` o `cuadrar`), `space`, `accountId`, `onView`, `onClose`, `api`. `ArchiveBlocked`: `account`, `currency`, `open`, `onOpenChange`, `onReconcile`. `AccountLink`: `accountId` y las props de `Link` | **Editar, cuadrar y archivar (D18).** El formulario de edición muestra el tipo fijo con su nota, el nombre y, en tarjeta, los días de la cuenta; envía solo lo que cambió (nada que guardar: no hay petición) y tiene el grupo «Más acciones». «Cuadrar saldo» empieza vacío y avisa en `aria-live` qué ajuste se registrará. «Archivar cuenta» no pide confirmación: «Archivaste «X»» con «Deshacer»; con saldo distinto de 0 abre el `alertdialog` (`AlertDialog`, Base UI: 460 px centrado desde 1024 px, hoja inferior debajo). El panel cambia entre Editar y Cuadrar sin cerrarse |
| Pantalla Cuentas (KAN-71) | `app/cuentas/page.tsx` (servidor) y `app/cuentas/_components/` (cliente): `AccountsScreen`, `AccountGroup`, `AccountRow`, `ArchivedAccounts`, `AccountDetail`, `AccountsSkeleton`, `AccountsEmpty`, `AccountsError` | `AccountsScreen`: `space` (`{ id, currency }`) y `api`. `AccountGroup`: `title`, `total` (BigInt), `debt`, `accounts`, `currency`, `selectedId`. `AccountRow`: `account`, `currency`, `selected`. `ArchivedAccounts`: `accounts`, `space`, `api` | **Cuentas (D18).** Lista agrupada en Disponible y Deuda con su total (el de Deuda en `debt`), «Archivadas (n)» plegable con «Desarchivar», y desde 1024 px el detalle de la cuenta elegida (`?sel`). Estados de carga (esqueleto), vacío y error con «Reintentar». Los nombres se cortan con «…» (completos en `title`); un monto nunca se corta: pasa a otra línea. Las filas son `AccountLink` a `/cuentas/<id>` |
| `Card` | `components/ui/card.tsx` | `variant`: `glass` (tile bento, token `card`), `tile` (KAN-91: glass bajo 1024 px y tarjeta sólida `surface` con borde, radio `card` y 24 px de relleno desde 1024 px, utilidad `tile-surface`) o `solid`; partes `CardHeader`, `CardTitle` (`as`), `CardDescription`, `CardContent` | Los formularios van en `solid`; las pantallas de Hito 1 usan `tile` |
| `Alert` | `components/ui/alert.tsx` | `variant` (`error` con `role="alert"`, `info` con `role="status"`), `title`, `action`, hijos | Icono y texto, nunca solo color |
| `Skeleton` | `components/ui/skeleton.tsx` | Props de `<div>` | Decorativo (`aria-hidden`); el contenedor lleva `aria-busy`. Sin animación con `prefers-reduced-motion` |
| `Empty` (API compuesta de shadcn) | `components/ui/empty.tsx` | `<Empty>` con `<EmptyHeader>` (`<EmptyMedia variant="icon">` con un icono Phosphor duotone, `<EmptyTitle>`, `<EmptyDescription>`) y `<EmptyContent>` para la acción | Invita a actuar |
| `Toaster` | `components/ui/sonner.tsx` | Props de Sonner | Montado en `layout.tsx`; ver D8 |
| `AppShell` | `components/app-shell.tsx` (servidor) | `title`, `actions` (acciones propias de la pantalla, a la izquierda del avatar), `user` (opcional: `display_name` y `email` de `GET /me`; sin él, avatar genérico), `space` (opcional: `id`, `name` y `currency` de `GET /spaces`: la fila del espacio de la barra lateral y, con el `id` y la moneda, el panel «Nueva cuenta»; sin él, la fila no se dibuja y el panel no abre), `subtitle` (opcional, KAN-70: la línea secundaria bajo el `h1`, 15 px en `muted-foreground`, **solo desde 1024 px**; el Inicio escribe la fecha, «Miércoles 21 de octubre», con `formatWeekdayDate`), `leading` (opcional, KAN-70: lo que va antes del título; una pantalla de formulario pone ahí su `BackLink`), `hideBottomNav` (opcional: las pantallas de formulario con «Volver» no llevan la barra inferior; ver «Navegación del Hito 1»), `phoneOnly` (opcional: una pantalla que solo existe bajo 1024 px, como «Más», oculta desde 1024 px toda la columna de contenido, encabezado incluido, mientras la página redirige; la barra lateral se queda), `children` | Dos blobs, safe areas y, **como el lienzo (KAN-41)**, un solo grupo. Bajo 1024 px, una columna centrada de hasta 640 px (`max-w-160`; en un celular es el ancho de la pantalla) con gutters de 16 px, y la barra inferior (`BottomNav`) flotando sobre su pie: `main` deja `--bottom-nav-offset + --bottom-nav-height + 1,5 rem` de aire abajo (sin barra, `1,5 rem + inset`). Desde 1024 px, la barra lateral y el contenido forman un grupo de hasta 1440 px **contando la barra**, centrado (`mx-auto`), con 16 px de aire arriba y a la izquierda, 24 px a la derecha y abajo, 24 px entre la barra y el contenido, y la columna de contenido `flex-1 min-w-0`. El padding es del grupo, así que el encabezado y la página nunca se desalinean. **Encabezado plano** (sin `glass`, sin sticky) dentro de la columna de contenido: `h1` a la izquierda (24 px; 26 px desde 768 px; 30 px desde 1024 px, Montserrat 700, −0,02em) y a la derecha las acciones y, **bajo 1024 px**, el avatar (`lg:hidden`; desde 1024 px el avatar vive abajo en la barra lateral, Escritorio v2); arriba suma `env(safe-area-inset-top)`. Cada lado es `max(gutter, env(safe-area-inset-*))`, no una suma. **KAN-27:** siempre incluye un menú de la cuenta con "Cerrar sesión" (el del encabezado bajo 1024 px y el de la barra lateral desde 1024 px, los dos en la página y cada uno oculto por CSS donde no toca: ninguna pantalla con sesión puede olvidarlo) y `BfcacheGuard`; **KAN-70:** monta además `AccountPanelHost` (detrás de un `Suspense`, porque lee la URL), que abre el panel lateral «Nueva cuenta» sobre cualquier pantalla con sesión cuando la URL trae `?cuenta=nueva`. Al cliente solo le pasa `{ name, email, initials }` (y a la barra lateral, el espacio) |
| `useLogout` (KAN-27, movido en KAN-41) | `components/use-logout.ts` | Sin props; devuelve `{ logout, busy }` | La lógica de "Cerrar sesión" que antes era `LogoutButton`: `DELETE /api/auth/session` y, en éxito, `markSessionEnded()`, `queryClient.clear()` y carga completa de `/login` (no `router.replace`: ver `CLAUDE.md` > Sesión). `busy` sigue en `true` hasta que carga `/login`; una segunda llamada no envía otra petición ni en el mismo tick. Lo llama `UserMenu`, el único avatar de la pantalla. Si falla (403 o red): toast en español y se puede volver a llamar. Probado en `use-logout.test.tsx` (los casos de `logout-button.test.tsx`, uno a uno) |
| `UserMenu` (KAN-41; FE-15, KAN-69) | `components/user-menu.tsx` (cliente) | `user` (`{ name, email, initials }`, opcional), `variant` (`avatar`, por defecto, o `sidebar`), `className` | El menú de la cuenta, con dos presentaciones que `AppShell` dibuja las dos (cada una oculta por CSS donde no toca). **`avatar`** (encabezado, bajo 1024 px; lleva `lg:hidden`): como el lienzo, bajo 768 px 44×44 px estilo tile glass (`card-surface`, texto `foreground`, 14 px); desde 768 px, 48×48 px con `secondary` / `secondary-foreground` (el `primarySoft` / `onPrimarySoft` del lienzo, 15 px). **`sidebar`** (abajo en la barra lateral, desde 1024 px): fila con borde superior (`sidebar-line`), avatar decorativo de 36 px (`sidebar-tile`), nombre (14 px, 700, `sidebar-title`), correo (14 px, `sidebar-foreground`; los dos cortados con «…») y el botón «Menú de la cuenta» de 36 px con tres puntos (44 px con `pointer: coarse`: el tamaño de 34 a 40 px es solo para mouse, D17). Sin `user`, el avatar es un ícono de persona y la fila dice «Tu cuenta». Dos iniciales (`initialsOf`: "Juan David" → "JD", "Ana" → "A"), o un ícono de persona si no hay letras. Mismo menú en las dos: se abre hacia abajo (`bottom`, `end`) en el encabezado y hacia arriba (`top`, `end`) en la barra lateral; trae el nombre y el correo enteros (grupo con nombre) y el ítem "Cerrar sesión" (44 px). Llama a `useLogout()`: el ítem queda en el menú con spinner, `aria-busy` y `aria-disabled` mientras corre (no cierra el menú) y el disparador también lleva `aria-busy`, así sobrevive a un Escape. Disparador: `aria-label="Menú de la cuenta"`, `aria-haspopup="menu"`, `aria-expanded`. Teclado (Base UI Menu): Enter o flechas abren, flechas / Home / End / escritura mueven, Escape cierra y devuelve el foco al disparador. Probado en `user-menu.test.tsx` |
| `Sidebar` (KAN-41; rehecha en FE-15, KAN-69, D17 › Escritorio v2) | `components/sidebar.tsx` (servidor) | `user` (`UserMenuUser`, opcional) y `space` (`{ name, currency: { code } }`, opcional). Exporta también `SidebarBody` y `SIDEBAR_CARD` (el catálogo los usa para mostrar la barra completa) | Desde 1024 px (`lg`), una **tarjeta flotante** de **240 px** de ancho (216 como mínimo: `lg:w-60 lg:min-w-54 lg:shrink`), radio 28 px (`rounded-tile`), padding 20/14 px, 18 px entre bloques y borde `sidebar-border`, separada 16 px del borde de arriba y de la izquierda, `sticky` y de alto **una pantalla menos el padding del grupo**: `100dvh − max(1rem, inset-top) − max(1.5rem, inset-bottom)`, es decir, 40 px menos sin insets (16 px arriba y 24 px abajo, como el lienzo; mientras va pegada queda 24 px de aire debajo, no 16). Va dentro de una columna que se estira con la página. En una página corta el documento mide justo una pantalla (padding de arriba + tarjeta + padding de abajo) y no scrollea; si la tarjeta fuera 8 px más alta, sí. Los dos números viven juntos en `shell-layout.ts` y `shell-layout.test.ts` comprueba la suma con y sin insets. Si la ventana es tan baja que no cabe todo, la tarjeta scrollea por dentro (`overflow-y-auto`, `overscroll-contain`); sin tope de alto (el de 920 px del lienzo es del artboard). Oscura en los dos temas (tokens `sidebar*`). De arriba abajo: **`KanzaBrand` compacto** (ícono de 36 px con `alt=""` y «Kanza» en Bricolage 22 px, `sidebar-primary`; no es un enlace); **fila del espacio** (48 px, `rounded-field`, borde `sidebar-line` y fondo `sidebar-surface`: tile de 30 px con la inicial —`spaceInitialOf`—, nombre en 14 px 700 y `describeCurrency` en 13 px (`text-caption`), p. ej. «Peso uruguayo · UYU»; **no interactiva**, es un `div`: en v1 hay un solo espacio y se vuelve selector con los hogares; sin espacio no se dibuja); **botón de la acción principal** (píldora `sidebar-primary` de 46 px con ícono «+» y el texto de `PRIMARY_ACTION.buttonText`, sin `aria-label` para que el nombre accesible sea el texto visible; sin la pista «N» hasta que exista el atajo; **no se dibuja mientras `PRIMARY_ACTION` es `null`**; desde KAN-70 es un `PrimaryActionLink`: un enlace real a `/cuentas/nueva` que, desde 1024 px, abre el panel «Nueva cuenta» sobre la pantalla en vez de navegar); `SidebarNav` principal; y abajo (`mt-auto`) `SidebarNav` de lo que cuelga de «Más» (Categorías) y la fila de la cuenta (`UserMenu` `variant="sidebar"`). `data-slot="sidebar"` en el envoltorio. El contador de Pendientes llega en Hito 2, y Ayuda y Ajustes en Hito 3. Menos de 1024 px es `display: none`. Probado en `sidebar.test.tsx` |
| `SidebarNav` (KAN-41; rehecha en FE-15, KAN-69, D17 › Escritorio v2) | `components/sidebar-nav.tsx` (cliente: `usePathname`) | `group` (`main` o `more`); `nav` y `pathname` solo para el catálogo | `<nav aria-label="Principal">` (grupo `main`: `NAV_SECTIONS`) o `<nav aria-label="Organiza">` (grupo `more`: `MORE_SECTIONS`; no dibuja nada si está vacío). Cada sección es un enlace de al menos 44 px (radio `rounded-icon`, ícono de 20 px, nombre en Karla 15 px `text-item`: 700 la activa y 600 el resto, color `sidebar-text` en reposo). **El nombre es visible**, así que el enlace no lleva `aria-label` ni globo (WCAG 2.5.3); `aria-current="page"` en la actual. La sección actual se ve sin depender del color: nombre en negrita, ícono relleno (`fill`) en `sidebar-primary` y píldora de menta translúcido (`sidebar-accent`), la misma que pinta el mouse al pasar (`hover:`, solo bajo `@media (hover: hover)`). Ya no hay la marca de 4×24 px de KAN-41 (con los nombres visibles sobra). Foco: `sidebarFocusRing` (`--ring` claro llega a 2,86:1 sobre la barra, por eso el token propio `--sidebar-ring`). Probado en `sidebar-nav.test.tsx` y `nav-sections.test.ts` |
| `NAV_SECTIONS` y compañía (KAN-41; ampliado en FE-15, KAN-69) | `components/nav-sections.ts` | `NAV_SECTIONS` (`{ id, href, label, icon }[]`), `MORE_SECTIONS` (lo mismo más `description`), `MORE_ITEM` (la pestaña «Más», a `/mas`), `PRIMARY_ACTION` (`{ href, label, buttonText, panel? }` o `null`), `NAV` (los tres juntos), `isSectionActive(pathname, href)`, `isMoreActive`, `barItems`, `splitAroundAction` | **La navegación de Hito 1 se enciende pantalla por pantalla**: una sección entra cuando su pantalla existe (ningún enlace lleva a un 404 en staging) y lo hace la tarea que la construye. Hoy: `NAV_SECTIONS` = Inicio y Cuentas (KAN-71); `MORE_SECTIONS` vacío (FE-21 añade Categorías y con ella aparecen la pestaña «Más» y la fila de la barra lateral); `PRIMARY_ACTION` = el formulario de cuenta desde KAN-70 (`href` `/cuentas/nueva`, `label` «Nueva cuenta» —el `aria-label` del «+»—, `buttonText` «Nueva cuenta» y `panel` `{ param: "cuenta", value: "nueva" }`, el `?cuenta=nueva` con el que se abre el panel desde 1024 px); FE-20 lo cambia a «Registrar movimiento» y «Registrar». Guarda íconos, que son funciones: un Server Component puede leerlo, pero no pasárselo a un componente cliente como prop (solo el catálogo, que es cliente, pasa un `NavConfig` propio). `isSectionActive`: `/` solo es ella misma; el resto también por segmentos completos (`/movimientos/abc` sí, `/movimientos-viejos` no). `isMoreActive`: `/mas` y todo lo que cuelga de «Más». `splitAroundAction`: el «+» va en medio de las pestañas (con cuatro, dos y dos; con un número impar, la izquierda lleva la de más) |
| `BottomNav` / `BottomNavBar` (FE-15, KAN-69) | `components/bottom-nav.tsx` (cliente: `usePathname`) | `BottomNav` sin props (lee `NAV`); `BottomNavBar`: `nav`, `pathname` y las props de `<nav>` (el catálogo lo muestra sin fijarlo) | La barra inferior de celular y tablet, ver «Navegación del Hito 1». `<nav aria-label="Principal" data-slot="bottom-nav">`, `glass`, radio `rounded-nav`, sombra `shadow-nav`, 68 px (`--bottom-nav-height`), `fixed` a `--bottom-nav-offset` del borde de abajo y a `max(12px, inset)` de los lados; desde 768 px de 480 px y centrada; desde 1024 px `lg:hidden`. Pestañas: enlace de al menos 64×52 px (radio `rounded-xl`, ≈22 px), ícono de 22 px (relleno en la activa), label Karla `text-nav-label` (11 px; 12 px desde 768 px), 700 la activa y 600 el resto; la activa lleva píldora de `primary` al **10 %** en claro y al 14 % en oscuro (al 12 % el texto de 11 px no llega a 4,5:1 sobre glass con el primer blob detrás: `tokens.test.ts` lo vigila) y `aria-current="page"`. «+»: círculo `primary` de 52 px (54 desde 768 px) con `shadow-fab` y el `aria-label` de `PRIMARY_ACTION`; sin acción no se dibuja. Probado en `bottom-nav.test.tsx` |
| `MoreList` y `/mas` (FE-15, KAN-69) | `components/more-list.tsx` (servidor) y `app/mas/page.tsx` | `MoreList`: `sections` (`MoreSection[]`) | La pantalla «Más»: `h1` «Más» y un grupo «Organiza» (`h2` Karla 14 · 700 `muted-foreground`) en una tarjeta glass (`card-surface`, radio 28) con una fila de 72 px por entrada: ícono duotone de 42 px en `bg-secondary text-primary`, título (`text-item`, 700), línea secundaria y chevron. `/mas` se redirige a `/` en servidor si `MORE_SECTIONS` está vacío, y a `/login` ante un 401; ante otro fallo de `/me` o `/spaces`, `Alert` + «Reintentar». Desde 1024 px redirige a `/` en el navegador (`DesktopRedirect`) y su columna de contenido, con el `h1`, es `lg:hidden` mientras tanto (`AppShell` con `phoneOnly`). Probado en `more-list.test.tsx` y `app/mas/page.test.tsx` |
| `useIsDesktop` y `DesktopRedirect` (FE-15, KAN-69; el hook salió de `Toaster`) | `components/use-is-desktop.ts`, `components/desktop-redirect.tsx` (cliente) | `DesktopRedirect`: `to` (por defecto `/`) | `DESKTOP_MEDIA_QUERY` (`(min-width: 64rem)`, el `lg` de Tailwind) vive solo ahí. `useIsDesktop()` vale `false` en el servidor y al hidratar, así que solo se usa para lo que el CSS no puede (la posición del `Toaster`, un redirect); el diseño cambia con clases `lg:`. `DesktopRedirect` hace `router.replace` al llegar (o ensancharse la ventana) a 1024 px. Probado en `desktop-redirect.test.tsx` y `ui/sonner.test.tsx` |
| `loadShellData` (FE-15, KAN-69) | `lib/core/data/shell.ts` | `api` (`ApiClient`) | `GET /me` y `GET /spaces` juntos (`allSettled`; un 401 de cualquiera gana sobre otro fallo; sin 401, se informa el primero, `/me` antes que `/spaces`). Devuelve `{ ok, user, spaces }` o `{ ok: false, error }` sin lanzar, para que la página llame a `redirect()` fuera de un `try`. Lo usan Inicio y `/mas`; toda pantalla con `AppShell` necesita `user` y `space`. Probado en `shell.test.ts` y, a través de las páginas, en `app/page.test.tsx` |
| `DropdownMenu` (KAN-41) | `components/ui/dropdown-menu.tsx` (shadcn, Base UI Menu, recortado a lo que se usa) | `DropdownMenu`, `Trigger`, `Content` (`side`, `align`, `sideOffset`), `Group`, `Label`, `Item`, `Separator` | Superficie `popover` sólida (nunca glass), radio `rounded-field`, ítems de 44 px. El puntero solo tiñe la fila (`hover:`, bajo `@media (hover: hover)`) y el teclado, además, pinta el anillo de foco (`highlightItemOnHover={false}`) |
| `Tooltip` (KAN-41; sin uso en la barra lateral desde FE-15) | `components/ui/tooltip.tsx` (shadcn, Base UI Tooltip) | `TooltipProvider` (retardo de 300 ms), `Tooltip`, `TooltipTrigger` (`render` con el enlace o botón), `TooltipContent` | Globo visual como el del lienzo: a la derecha del ícono (12 px), **invertido respecto a la página** (tokens `tooltip` / `tooltip-foreground`: oscuro sobre una página clara, claro sobre una oscura), radio 10 px, padding 6/12 px, 13 px bold, sombra (`shadow-tooltip`). Se abre con mouse o lápiz y con el foco de teclado, nunca con un toque; Escape lo cierra. El disparador lleva su propio `aria-label` (el globo no lo nombra). **Desde FE-15 (KAN-69) la barra lateral ya no lo usa** (con los nombres a la vista sobra); queda para los botones de solo ícono que vienen, como las acciones Editar y Eliminar de cada fila de la tabla de Movimientos (FE-18). Los gráficos (D9) usan el globo propio de Recharts, no este componente; el color `tooltip` coincide con el del globo del lienzo de los gráficos |
| `BfcacheGuard` (KAN-27) | `components/bfcache-guard.tsx` | Sin props | Sin interfaz. Recarga la página si el navegador la restaura de su caché atrás/adelante (`pageshow` con `persisted`). `markSessionEnded()` pone `data-session-ended` en `<html>` y `globals.css` oculta el `body` (sin ni un fotograma con datos). Probado en `bfcache-guard.test.tsx` |

- **Foco** de todos los controles: `components/ui/focus.ts` (`outline-solid` de 2 px con offset y color `ring`). **Nunca añadas `outline-none` ni `outline-hidden` a un control**: en Tailwind v4 fijan `--tw-outline-style: none` y el anillo no se pinta (`focus.test.ts` lo vigila). Si lo cambias, mantén 3:1.
- **Errores del backend:** `describeApiError(error)` (`lib/core/i18n.ts`) devuelve `{ title, message }` en español para un `ApiError` (por `code`; en un 422 por `type`; si no, por status), un fallo de red o cualquier otra cosa, y nunca muestra el `detail` en inglés ni un código crudo. Un código nuevo del backend necesita su traducción en ese archivo. `fieldErrorMessage(type)` traduce el `type` de un 422 para marcar un campo.
- **CLI de shadcn:** `shadcn add` añadió `cn` y `next-themes` a `package.json` y generó componentes de 32 px con el estilo por defecto. Se revirtió `package.json` (el repo usa su `cn()` de `lib/utils.ts` y `Toaster` usa `theme="system"`) y se rehicieron los estilos a Menta. Tras cada `shadcn add`, revisa `git diff package.json package-lock.json`. Los archivos generados importan `cn` del paquete `cn` (dependencia transitiva de `shadcn`): cámbialo a `@/lib/utils`. `Field`, `Empty`, `Label` y `Separator` salen de `shadcn add field empty` y se ajustaron a Menta (label en negrita, error con icono, media de 42 px); no hay componentes propios que los reemplacen. Para react-hook-form el cableado de ids lo hace `TextField` (KAN-26); con `Field` directo (checkbox, grupos de radios), el llamador enlaza `htmlFor`/`id`, `aria-invalid` y `aria-describedby` a mano.
- **Catálogo** (`/catalog`): `src/app/catalog/page.dev.tsx` muestra cada componente en sus estados (normal, foco, deshabilitado, cargando, error), en claro y oscuro (según el sistema), con datos extremos (etiquetas y errores largos, monto enorme) y un panel "Auditoría" que, al ancho actual (prueba con 360, 375, 393, 430, 768, 1024, 1280 y 1440 px), lista los controles menores de 44 px, los elementos que se salen de la pantalla (mide cada elemento, porque `AppShell` recorta el desbordamiento horizontal) y los botones o enlaces con el texto recortado; desde KAN-41 dice además si la barra lateral está visible, cuánto mide el contenido (`main`) y si la página hace scroll horizontal. El header del catálogo lleva un usuario de nombre y correo larguísimos para probar el menú del avatar. `/catalog?title=<texto largo>` prueba un título largo en el header (hasta dos líneas, luego se corta). El estado "Foco" aplica el mismo anillo sin esperar a Tab.
- **Solo en local:** los archivos se llaman `page.dev.tsx` y `layout.dev.tsx`, y `next.config.ts` solo acepta la extensión `dev.tsx` en `next dev` (`lib/env/page-extensions.ts`, con test). En `next build` y `next start` la ruta no se registra ni se compila. Comprobado: `/catalog` no aparece en la salida del build ni en `.next/server/app-paths-manifest.json`. Una ruta de catálogo nueva debe llamarse `*.dev.tsx` (los componentes que no son rutas pueden ser `.tsx`). `proxy.ts` (KAN-27) deja pasar `/catalog` sin sesión (está en su `PUBLIC_PATHS`). Efecto secundario: `.next/dev/types` (que crea `npm run dev`) conoce `/catalog` y haría fallar el chequeo de tipos del build; por eso `package.json` tiene un script `prebuild` (multiplataforma, con `fs.rmSync`) que borra `.next/dev` antes de cada `npm run build`. No hay que borrarlo a mano.

**Verificado en KAN-33** (con `shadcn` 4.21.2, en una copia desechable): `shadcn init` ofrece **Base UI como primitiva recomendada** (`--base base`; el preset por defecto es `base-nova`); el paquete es **`@base-ui/react`** (1.8.0); `iconLibrary` por defecto es `lucide` y `phosphor` es un valor válido (lo usa el preset `lyra`), así que `components.json` se escribió a mano con `"iconLibrary": "phosphor"`. Además `init` añade `tw-animate-css` y el paquete `shadcn` (`@import "shadcn/tailwind.css"` trae las variantes `data-open`/`data-closed` que usan los componentes), ambos ya instalados, y un `utils.ts` que importa un paquete `cn` de npm: el repo usa su propio `cn()` con `clsx` + `tailwind-merge`. `init` no se corrió en el repo para no sobrescribir `globals.css`/`layout.tsx` ni generar `button.tsx` (es de KAN-34); al hacer `shadcn add`, revisa que no traiga `lucide-react` ni reescriba los tokens.

### D5. Iconos

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Phosphor (`@phosphor-icons/react`) | **Elegida** |
| lucide-react | Alternativa evaluada; descartada: un solo estilo de trazo, sin fill ni duotone que la dirección visual usa |

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
| Fuente del sistema | Descartada: sin identidad propia y los numerales cambian entre iOS y Android |
| Una sola familia para todo | Descartada: la dirección visual separa números y títulos del texto corrido |

**Elección:** Montserrat 600/700 para números y títulos; Karla 400–700 para texto.
**Motivo:** identidad "Menta"; Montserrat da legibilidad y presencia a los montos y lleva `tnum`, así que los montos se alinean en columnas; que Karla también tenga `tnum` (cifras en texto corrido) se verifica en KAN-34.

**Reglas de uso**
- Carga con `next/font/local` (KAN-42), no con `next/font/google`: el build descargaba las fuentes de Google y un fallo de red intermitente rompía el check `frontend` del CI. Los woff2 variables viven en `src/app/fonts/<familia>/` (subset `latin`, que cubre el español; Montserrat con pesos `600 700` y Karla con `400 700`, declarados como rango en `layout.tsx`), cada uno con su `OFL.txt`. Origen y SHA-256 están en `src/app/fonts/fonts.json` (fuente única; `README.md` explica cómo repetirlos), `fonts.test.ts` los comprueba y ESLint prohíbe importar `next/font/google`. Son los mismos bytes que servía Google, así que la UI no cambia; solo el fallback previo a la carga usa métricas calculadas del archivo (Montserrat 110,19 % de `size-adjust`, antes 112,83 %; Karla 103,51 %, antes 102,4 %), y un carácter fuera de `latin` (cirílico, vietnamita, latin-ext) se pinta con Arial en vez de pedir otro subset a Google.
- Montos y cifras comparables con `tabular-nums` (`font-variant-numeric`).
- Escala tipográfica en D13.
- **Fuente de marca (KAN-40):** Bricolage Grotesque ExtraBold (800, tamaño óptico 96, `letter-spacing: -0.03em`) solo para el nombre "Kanza" (logotipo y cabecera del login). Va por `next/font/local` (`components/brand/brand-font.ts`, woff2 de 21,7 kB en `src/app/fonts/bricolage/`), no por `next/font/google`: este no deja fijar el tamaño óptico con un solo peso (con `weight` fijo rechaza `axes`; con `weight: "variable"` baja el rango completo, ~77 kB). Clases `font-brand`, `tracking-brand` (`--tracking-brand: -0.03em`) y `text-brand` (`--text-brand: 1.4375rem`, 23 px: el tamaño del login), definidas en `globals.css`. Se declara en el componente del nombre y no en `layout.tsx`, para que solo las rutas que lo muestran lo precarguen. Licencia OFL en `marca-kanza.md`.

**Verificar en KAN-34:** que el archivo de fuente que sirve `next/font` conserva `tnum` en Montserrat y en Karla. El catálogo (sección "Cifras") trae una columna de montos y una fila `1111 / 8888` en cada fuente. **Visto a ojo en KAN-62, sin medir:** las cifras de Montserrat y de Karla en el catálogo se dieron por buenas visualmente; no se midió el ancho de "1111" y "8888" ni se comprobó la fuente servida (ver Pendientes). Si las cifras no son tabulares, anótalo aquí.

### D7. Formularios

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| react-hook-form + zod | **Elegida** |
| `useActionState` nativo (Server Actions) | Alternativa evaluada; descartada: las Server Actions no existen en la app nativa y los esquemas zod de core no se reutilizarían |

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
| Toast de Base UI | Descartada: Sonner es el que integra shadcn y trae la acción y el gesto de cerrar listos |
| Toast propio | Descartada: reimplementar cola, apilado y accesibilidad |

**Elección:** Sonner, con acción "Deshacer".
**Motivo:** integración con shadcn y una acción de primera clase (`action: { label, onClick }`).

**Reglas de uso**
- Un solo `<Toaster />`, montado en `layout.tsx`; `toast()` solo desde código cliente. Consulta la skill `ask-sonner` (`.claude/skills/ask-sonner/`).
- El toast es cromo flotante: usa el token `glass` (D14), con el fallback sólido de D13 › Glass.
- Posición por encima de la nav inferior y de la safe area (`offset` y `mobileOffset` —Sonner usa uno bajo 600 px y el otro desde ahí—: `var(--toast-offset-bottom, calc(16px + env(safe-area-inset-bottom, 0px)))`). **KAN-69 (FE-15), con la barra inferior:** una pantalla que la lleva deja el toast 20 px por encima de ella, es decir, su borde de abajo queda a `max(12px, env(safe-area-inset-bottom)) + 68px + 20px` del borde de la pantalla. Lo hace solo CSS, sin estado ni desajuste de hidratación: `globals.css` define `--toast-offset-bottom` en el `body` cuando la página contiene `[data-slot="bottom-nav"]` (`body:has(...)`; `:has()` está en todo navegador que Tailwind v4 ya exige), con `--bottom-nav-offset` y `--bottom-nav-height` como única fuente de las medidas; una pantalla sin barra (`hideBottomNav`, el formulario de cuenta) no define la variable y el `Toaster` usa su offset base de arriba. `tokens.test.ts` lee esa regla y `ui/sonner.test.tsx` el valor que recibe Sonner (Sonner pasa los strings de `offset` tal cual a sus variables CSS, así que `var()` funciona). **KAN-41 (D17):** hasta 1023 px va abajo y centrado; desde 1024 px, abajo a la derecha (`24px` más las safe areas), lejos de la barra lateral, y ahí no usa la variable (la barra inferior no existe). Sonner recibe la posición como prop, no por CSS, así que el `Toaster` pregunta el ancho con `useIsDesktop()` (`components/use-is-desktop.ts`, que guarda `matchMedia("(min-width: 64rem)")`, el `lg` de Tailwind, y usa `useSyncExternalStore`); en el servidor y al hidratar vale "celular", sin desajuste ni parpadeo (el contenedor está vacío hasta el primer toast). Si cambias el breakpoint de la barra lateral, cambia también esa constante (es la única, y `DesktopRedirect` la comparte). **Duración 6000 ms** (KAN-34; el valor por defecto de Sonner son 4000 ms), para poder llegar a "Deshacer". El botón "Deshacer" mide 44 px y lleva el anillo de foco del proyecto (`focus.ts`) con `!`, porque el foco propio de Sonner es casi invisible sobre glass. Sonner inyecta CSS sin capa: sus variables (`--normal-bg`…) se fijan en `sonner.tsx` y las utilidades que lo pisan llevan `!`.
- Copy: la misma palabra en acción y confirmación: "Eliminaste «Café»" + **Deshacer**. El borrado es suave (`deleted_at`), así que deshacer restaura el registro y se invalidan las queries.

### D9. Gráficos

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Diferir: barras CSS (lista accesible) en v1; `Progress` en v1.1 | Elegida el 2026-10-05; **reemplazada el 2026-10-21** para los gráficos del Inicio de escritorio (el top-5 sigue en barras CSS y presupuestos y metas en `Progress`) |
| shadcn Charts (Recharts 3) | **Elegida desde el Hito 1 (2026-10-21)**: variables CSS, `accessibilityLayer` con teclado |
| Nivo | Solo para un tipo que Recharts no tenga (calendar heatmap, sankey), añadiendo solo ese `@nivo/*` con tema mapeado a tokens |

**Elección:** shadcn Charts (Recharts) desde el Hito 1. Cambió el 2026-10-21 con el rediseño de escritorio (D17): el Inicio de escritorio trae dos gráficos reales.
**Motivo:** el dashboard de escritorio necesita la evolución del neto y la comparación de ingresos y gastos por mes; Recharts usa variables CSS y tiene `accessibilityLayer` con teclado. El top-5 y las barras de progreso siguen siendo CSS. Contras de Nivo: último release v0.99.0 (mayo 2025), tema como objeto JS (sin variables CSS) y ARIA parcial.

**Reglas de uso**
- **Evolución del neto** (Inicio, tarjeta del Neto): área con línea de 2 px, 6 meses (el último es el mes en curso, "hoy"), punto en cada mes y globo con el mes y el neto al pasar el mouse o con el teclado. Datos: el neto al cierre de cada mes (endpoint de backend nuevo).
- **Ingresos y gastos** (Inicio): barras agrupadas por mes, 6 meses; leyenda siempre visible; globo con ingresos, gastos y ahorro del mes. Datos: totales por mes (endpoint de backend nuevo). Un solo eje: nunca dos escalas.
- **Colores:** `chart-income` (`#23895F` claro / `#3AA97A` oscuro) y `chart-expense` (`#B5652A` claro / `#C27535` oscuro), validados con el validador de la skill `dataviz` (pasan banda de luminosidad, contraste 3:1 y visión normal; para daltonismo quedan en la franja de 6 a 8, así que **la leyenda y el globo son obligatorios**). El color sigue a la serie, nunca al orden. Texto de ejes y etiquetas con tokens de texto, no con el color de la serie.
- Cada gráfico tiene su alternativa en texto o tabla para lectores de pantalla (la tabla de movimientos y las cifras de las tarjetas ya dicen lo mismo; el gráfico lleva `aria-label` con el resumen).
- Top-5 por categoría: barras CSS dentro de una lista accesible (categoría, monto y porcentaje en texto).
- v1.1: presupuestos y metas con `Progress`.

### D10. Tests

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| vitest + Testing Library | **Elegida** |
| Jest | Descartada: más configuración para TypeScript y módulos ESM, sin ventaja para este proyecto |
| Playwright con un solo navegador | Descartada: en iOS, en la práctica, casi todos los navegadores son WebKit (la UE permite otros motores desde iOS 17.4) y Safari es la referencia, así que se prueban los dos motores |

**Elección:** vitest + Testing Library para lógica y componentes; Playwright para E2E en tres proyectos: **"Escritorio"** (Chromium, 1280 px, el principal desde el 2026-10-21), **"iPhone"** (WebKit) y **"Pixel"** (Chromium, con **viewport de 360 px de ancho**).
**Motivo:** el escritorio es el uso principal de la web (D15); los dos proyectos de celular cubren los dos motores móviles y el mínimo de 360 px que garantizamos.

**Reglas de uso**
- Tests de lógica junto al archivo (`*.test.ts` o `*.test.tsx`), solo para lógica no trivial: formateo de dinero y fechas, traducciones, esquemas y utilidades. Tests de componentes solo para lógica no trivial.
- E2E en `e2e/`, 3–5 flujos reales; los escribe qa.
- Todo flujo E2E corre en "Escritorio"; los que cambian en el celular (barra inferior, hojas, teclado) corren también en "iPhone" y "Pixel".
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
- **Mapa fijo en core** (las seis monedas sembradas, KAN-91): UYU → es-UY, COP → es-CO, USD → es-UY, ARS → es-AR, BRL → pt-BR y EUR → es-ES; **fallback es-UY**. Una moneda desconocida muestra su código. Nunca el locale del dispositivo. **Es solo para dinero:** la interfaz está en español, así que las fechas y los textos siguen en es-UY (un espacio en reales no muestra meses en portugués; `locale.test.ts` lo comprueba). `formatMoney` agrupa los miles siempre (`useGrouping: "always"`), porque es-ES no separa los números de cuatro cifras ("1234,50 €").
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
| ARS (exp. 2) | es-AR | `123450` | `$ 1.234,50` |
| BRL (exp. 2) | pt-BR | `123450` | `R$ 1.234,50` |
| EUR (exp. 2) | es-ES | `123450` | `1.234,50 €` |

**Motivo:** el formato depende del espacio y no del teléfono, lo mostrado coincide con lo guardado y se minimiza el riesgo de mismatch de hidratación entre servidor y cliente.

**Contrato:** `SpaceRead` (`GET /spaces`, `GET /spaces/{id}`) ya expone `currency { code, exponent }` y `timezone`; `formatMoney` recibe exactamente ese `currency` y los formateadores de fecha reciben `timezone`. (Esta nota decía que faltaban hasta BE-09; se corrigió en KAN-33.)

**Implementación (KAN-33; KAN-91 sumó `parseMoneyInput` y `currencySymbolOf`):** `lib/core/locale.ts`, `lib/core/money.ts` (`formatMoney`, `minorToDecimalString`) y `lib/core/dates.ts` (`formatLocalDate`, `formatInstant`, `todayInTimezone` y, desde KAN-70, `formatWeekdayDate`: «Miércoles 21 de octubre», con el día de la semana en mayúscula y sin coma, en la zona del espacio, para el subtítulo del Inicio), con tests. `parseMoneyInput(text, exponent, { allowNegative })` es el camino inverso para lo que escribe la persona: acepta "," o "." como decimal (sin separador de miles), como máximo `exponent` decimales (más es un error, nunca se redondea), un "−" inicial solo si se pide y el tope del backend (`MAX_SAFE_INTEGER`), todo con enteros y cadenas. `formatMoney` acepta `number` entero seguro, `bigint` o `string`; el signo "+" se pide con `{ sign: "exceptZero" }` y el cero nunca lleva signo. Con Node 24 (ICU de `.nvmrc`) la hora sale como `11:30 p. m.` con espacios normales; la comparación con WebKit y Chromium sigue pendiente (§4).

### D12. Modo oscuro

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Seguir el sistema con CSS `prefers-color-scheme` | **Elegida** para v1 |
| Toggle manual con `next-themes` | Después de v1 |
| Solo tema claro | Descartada: la dirección Menta incluye paleta oscura |
| Clase `.dark` activada por JavaScript desde el inicio | Descartada: depende de un script y puede parpadear al cargar |

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
| Título de pantalla | Montserrat | 24 · 700 · −0,02em (celular). Desde 768 px: 26 (`text-title-tablet`); desde 1024 px: 30 (`text-title-desktop`); tracking `tracking-title` (KAN-41) |
| Título de sección | Montserrat | 16–19 · 700 |
| Monto en tile | Montserrat | 18 · 600 |
| Monto en lista | Montserrat | 15 · 600 |
| Título de ítem | Karla | 15 · 700 (`text-item`, KAN-69; también el nombre de una sección de la barra lateral: 700 la activa y 600 el resto, y el título de una fila de «Más») |
| Cuerpo | Karla | 16 |
| Secundario | Karla | 13–14 (mínimo 13). Los 13 px son `text-caption` (KAN-69): la moneda de la fila del espacio en la barra lateral. No uses `text-tooltip-label`, que es del globo |
| Label de la nav | Karla (KAN-63) | 11 (`text-nav-label`, KAN-69) · 700 en la sección activa y 600 en el resto; 12 desde 768 px, como K-Tablet (excepción al mínimo de 13) |
| Texto de inputs | Karla | ≥16 (evita el zoom de iOS) |
| Iniciales del avatar | Montserrat | 14 · 700 en el tile de celular; 15 · 700 (`text-avatar`) en el de 48 px desde 768 px (KAN-41) |
| Texto de un globo (`Tooltip`) | Karla | 13 · 700 (`text-tooltip-label`; el mínimo de 13) (KAN-41; la barra lateral ya no tiene globos desde FE-15) |

**Espaciado:** base de 4 px (escala de Tailwind). Gutter 16. Gap del bento 10. Padding de tile 14–16. Área táctil ≥44. Botón primario 52. Campos 48.

**Radios**

| Elemento | Radio |
|---|---|
| Tile / hero | 28 |
| Contenedor de icono | 14–16 |
| Campo | 16 |
| Nav | 30 |
| Globo (`Tooltip`) y botones pequeños de la barra lateral (el de «Menú de la cuenta», 36 px) | 10 (`rounded-tooltip`, KAN-41) |
| Borde superior de la hoja (sheet) | 30 |
| Botones, chips y segmented | Pill (totalmente redondeado) |

**Glass**
- Solo en cromo flotante (nav, sheet, toast, header sticky) y en tiles bento o grupos sobre el fondo decorativo.
- Qué token usa cada superficie: **tiles bento y grupos → `card`** (bajo 1024 px; desde 1024 px son tarjetas sólidas `surface`, D17 › Escritorio v2); **nav, toast y header sticky → `glass`**; **sheet y panel lateral → `glass-strong`** (D14).
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
| Solo la paleta por defecto de Tailwind, sin nombres semánticos | Descartada: sin tokens semánticos no hay tema claro y oscuro ni mapeo a nativo |
| Herramienta de tokens externa (por ejemplo Style Dictionary) | Descartada: complejidad innecesaria con un solo cliente hoy |

**Elección:** variables CSS con nombres de shadcn (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--destructive`…) más las de finanzas (`--income`, `--expense`, `--debt`).
**Motivo:** los componentes de shadcn funcionan sin renombrar; `income` / `expense` / `debt` expresan el dominio; una futura librería nativa (React Native Reusables o HeroUI Native) puede mapearlos; todos los pares de texto cumplen AA (tabla de abajo).

Se definen como variables CSS (`:root` y su versión oscura) y se exponen con `@theme inline`; los radios son `--radius-tile` (28), `--radius-icon` (16), `--radius-field` (16), `--radius-nav` (30), `--radius-sheet` (30), y desde KAN-41 `--radius-tooltip` (10; también el de los botones pequeños de la barra lateral), y, desde KAN-91 (Escritorio v2), `--radius-card` (20) y `--radius-dialog` (24) (clases `rounded-tile`, `rounded-icon`…; `--radius: 1rem` alimenta la escala `sm`…`4xl` de shadcn) y los blobs `--blob-1` y `--blob-2` (`bg-blob-1`, `bg-blob-2`). Las superficies glass son utilidades: `card-surface` (blur 20 px; se mantiene, falta verlo en dispositivo), `glass` (24 px) y `glass-strong` (28 px). Los `sidebar*` y `tooltip` (KAN-41) son los colores de la barra lateral y de su globo, uno por tema (valores del lienzo); `--shadow-tooltip` es la sombra del globo. KAN-41 sumó también los tamaños de texto `--text-title-tablet` (26 px), `--text-title-desktop` (30 px), `--text-tooltip-label` (13 px) y `--text-avatar` (15 px), y el tracking `--tracking-title` (−0,02em). KAN-69 (FE-15) quitó `--radius-mark` (la marca de 4×24 px de la sección activa desapareció con los nombres a la vista) y sumó: los tamaños `--text-nav-label` (11 px, el label de la barra inferior), `--text-item` (15 px, título de ítem), `--text-caption` (13 px, texto secundario: la moneda de la barra lateral) y `--text-brand-compact` (22 px, el nombre Kanza en la barra lateral); las sombras `--shadow-nav` (la barra inferior) y `--shadow-fab` (su «+»); los colores `sidebar-title`, `sidebar-text`, `sidebar-surface`, `sidebar-line`, `sidebar-tile` y `sidebar-tile-foreground` (solo en `:root`, iguales en los dos temas); y las variables de medida (no son tokens de tema) `--bottom-nav-height` (68 px) y `--bottom-nav-offset` (`max(12px, env(safe-area-inset-bottom, 0px))`), de las que cuelgan la barra, el espacio que la página le deja y el offset del toast (D8). Todos del lienzo, y los de tamaño, tracking, radio y sombra registrados en `extendTailwindMerge` (`lib/utils.ts`) con su caso en `utils.test.ts`. No uses valores arbitrarios entre corchetes (un tamaño o un radio escrito en píxeles dentro de la clase) para estas medidas. Tailwind también lee los `.md`: una clase de ejemplo escrita así en la documentación se genera en el CSS de verdad.

**Tokens de Escritorio v2 (KAN-91):** `surface`, `primary-soft`, `scrim`, `radius-card`, `radius-dialog`, `shadow-panel`, `shadow-dialog`, `shadow-sheet` y `text-panel-title` (22 px: el título del panel y del diálogo) ya existen en `globals.css`, con sus pares de contraste en `tokens.test.ts` y registrados en `lib/utils.ts`. `scrim` y las sombras del lienzo (`0 24px 60px`, `-16px 0 40px`, `0 -10px 30px`) valen para el panel, la hoja y el diálogo. La utilidad `tile-surface` hace que un tile sea glass bajo 1024 px y `surface` desde 1024 px (`Card variant="tile"`). **Siguen por agregar** (con el primer gráfico, con su par de contraste y su registro): `chart-income`, `chart-expense` y `chart-1..5`; las filas de abajo marcadas con «(por agregar)» son esas.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `background` | `#E9F4EE` | `#08110D` | Fondo de la app |
| `foreground` | `#0E1A14` | `#EAF5EF` | Texto principal |
| `card` (glass) | `rgba(255,255,255,0.62)` | `rgba(28,44,36,0.55)` | **Tiles bento y grupos de lista** sobre el fondo decorativo |
| `card-solid` | `#F7FBF9` | `#142019` | Fallback sólido de `card` |
| `surface` | `#FFFFFF` | `#142019` | **Tarjetas de escritorio** (desde 1024 px, Escritorio v2); sólido, con borde `border` y radio `card` (20) |
| `primary-soft` | `#E3F1EA` | `#173B2C` | Contenedor del ícono de una tarjeta de escritorio (`primary` encima, 3:1 como no-texto) |
| `chart-income` (por agregar) | `#23895F` | `#3AA97A` | Serie de ingresos en gráficos (D9) |
| `chart-expense` (por agregar) | `#B5652A` | `#C27535` | Serie de gastos en gráficos (D9) |
| `scrim` | `rgba(8,17,13,0.22)` | `rgba(0,0,0,0.55)` | Velo detrás del panel lateral, la hoja inferior y los diálogos (Escritorio v2). La hoja móvil del lienzo dibuja 0,40 en claro; manda el token |
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
| `sidebar` | `#0E1A14` | `#13241B` | **Barra lateral** de escritorio (tarjeta flotante): sólida y oscura **en los dos temas**, con el valor del lienzo de cada uno |
| `sidebar-foreground` | `#A0B6AA` | `#A0B6AA` | Íconos en reposo, y el texto secundario (moneda, correo) y el ícono de «Menú de la cuenta» |
| `sidebar-accent` | `rgba(110,221,170,0.14)` | `rgba(110,221,170,0.14)` | Fondo al pasar el mouse y píldora de la sección actual: menta translúcido sobre `sidebar` (los tests lo componen) |
| `sidebar-primary` | `#6EDDAA` | `#6EDDAA` | Ícono y nombre de la sección actual, el nombre «Kanza» y el botón de la acción principal (Hito 1); el contador de Pendientes llega en Hito 2 |
| `sidebar-primary-foreground` | `#062016` | `#062016` | Texto sobre `sidebar-primary` (la cifra del contador, el "+"; el `#062016` fijo del lienzo, ahora token) |
| `sidebar-ring` | `#6EDDAA` | `#6EDDAA` | Foco sobre la barra. `ring` claro (`#146E4D`) llega a 2,86:1 sobre ella, por eso no se usa (en oscuro `ring` ya es este mismo menta) |
| `sidebar-border` | `rgba(14,26,20,0.9)` | `rgba(255,255,255,0.08)` | **Decorativo**: borde de la tarjeta de la barra |
| `sidebar-title` | `#EAF5EF` | `#EAF5EF` | Nombre del espacio y del usuario (KAN-69); solo en `:root` |
| `sidebar-text` | `#C3D4CB` | `#C3D4CB` | Nombre de una sección en reposo (KAN-69); solo en `:root` |
| `sidebar-surface` | `rgba(255,255,255,0.05)` | `rgba(255,255,255,0.05)` | Fondo de la fila del espacio (translúcido sobre `sidebar`; los tests lo componen) |
| `sidebar-line` | `rgba(255,255,255,0.10)` | `rgba(255,255,255,0.10)` | **Decorativo**: borde de la fila del espacio y separador de la cuenta |
| `sidebar-tile` | `#173B2C` | `#173B2C` | Fondo de la inicial del espacio y del avatar de la barra (es el `secondary` oscuro) |
| `sidebar-tile-foreground` | `#A9EFCF` | `#A9EFCF` | Letra sobre `sidebar-tile` (es el `secondary-foreground` oscuro) |
| `tooltip` | `#0E1A14` | `#EAF5EF` | Globo (`Tooltip`, KAN-41; la barra lateral ya no los usa, quedan para los botones de solo ícono de las tablas): **invertido** respecto a la página |
| `tooltip-foreground` | `#EAF5EF` | `#0E1A14` | Texto del globo |
| `chart-1..5` | por definir | por definir | Para gráficos con más de dos series (categorías); se definen con el primero que los necesite. Ingresos y gastos usan `chart-income` y `chart-expense` |

**Reglas de uso**
- **Controles:** el borde de campos y selectores usa `--input` (≥3:1), no `--border`. `--border` queda para separadores y tarjetas y nunca es el único indicador de un estado o de un control.
- **Dinero:** `income` con "+", `expense` con "−" y color `foreground`, `debt` en ámbar. El signo informa, no solo el color. `destructive` nunca marca un gasto.
- **Superficies:** tiles bento y grupos de lista → `card` (glass) bajo 1024 px y `surface` (sólido, radio `card`) desde 1024 px; nav, toast y header sticky → `glass`; sheet y panel lateral → `glass-strong`; popovers y menús → `popover` (sólido). Fuera de esos casos y como fallback de glass, `card-solid`. Glass solo donde D13 › Glass lo permite.
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
| `sidebar-foreground` / `sidebar` (íconos en reposo) | 8,30 | 7,54 |
| `sidebar-foreground` / `sidebar-accent` compuesto sobre `sidebar` (ícono en reposo bajo el mouse) | 6,15 | 5,45 |
| `sidebar-primary` / `sidebar` (ícono y nombre de la sección actual; ≥3 como ícono, y como texto de 15 px cumple 4,5) | 10,70 | 9,71 |
| `sidebar-primary` / `sidebar-accent` compuesto sobre `sidebar` (ícono activo sobre su píldora, ≥3) | 7,93 | 7,03 |
| `sidebar-primary-foreground` / `sidebar-primary` ("+" de Hito 1 y contador de Pendientes de Hito 2) | 10,27 | 10,27 |
| `sidebar-ring` / `sidebar` (no texto, ≥3) | 10,70 | 9,71 |
| `sidebar-ring` / `sidebar-accent` compuesto (≥3) | 7,93 | 7,03 |
| `sidebar-title` / `sidebar` (nombre del espacio y del usuario) | 15,98 | 14,51 |
| `sidebar-text` / `sidebar` (nombre de una sección en reposo) | 11,56 | 10,50 |
| `sidebar-text` / `sidebar-accent` compuesto sobre `sidebar` (nombre en reposo bajo el mouse) | 8,57 | 7,59 |
| `sidebar-title` / `sidebar-surface` compuesto sobre `sidebar` (nombre del espacio) | 14,15 | 12,60 |
| `sidebar-foreground` / `sidebar-surface` compuesto sobre `sidebar` (moneda del espacio) | 7,35 | 6,54 |
| `sidebar-tile-foreground` / `sidebar-tile` (letra de la inicial y del avatar) | 9,38 | 9,38 |
| Label activo de la barra inferior: `primary` sobre la píldora (`primary` al 10 % claro / 14 % oscuro) sobre `glass`, con el fondo, el primer blob o el segundo detrás | 5,13 / **4,61** / 4,95 | 7,91 / 5,21 / 6,25 |
| `foreground` / `surface` (texto de una tarjeta de escritorio) | 17,85 | 15,04 |
| `muted-foreground` / `surface` | 6,60 | 7,81 |
| `primary` / `surface` (texto) | 6,24 | 10,07 |
| `debt` / `surface` | 5,78 | 9,10 |
| `destructive` / `surface` | 6,54 | 8,24 |
| `primary` / `primary-soft` (ícono, no texto, ≥3) | 5,36 | 7,41 |
| Texto (`foreground`, `muted-foreground`, `primary`, `debt`) y borde `--input` sobre `glass-strong` con el velo `scrim` encima, sobre el fondo o un blob (el panel y la hoja) | ≥4,5 / ≥3 | ≥4,5 / ≥3 |
| `tooltip-foreground` / `tooltip` (texto del globo) | 15,98 | 15,98 |
| `tooltip` / `background` (el globo se distingue de la página; ≥3) | 15,84 | 17,15 |
| `sidebar` / `background` (decorativo: la tarjeta se distingue por su borde) | 15,84 | 1,18 |

Todos los pares de texto superan 4,5:1 y todos los no-texto 3:1. Antes de KAN-34, `input` sobre `card` con un blob detrás en oscuro quedaba en 2,61:1; se subió el alfa de `--input` a 0,40 (3,04:1). `src/app/tokens.test.ts` comprueba estos pares, incluidos los translúcidos compuestos sobre el fondo y cada blob (con el alfa antiguo ese test falla), los de la barra lateral (KAN-41 y KAN-69; los de su fila del espacio y de la píldora se miden sobre el color compuesto), el label activo de la barra inferior (el peor caso, el primer blob, queda en 4,61:1 con la píldora al 10 %; con el 12 % del lienzo bajaba a 4,47:1 y el texto de 11 px no llegaba a 4,5:1), la regla del toast sobre la barra inferior (D8) y que los tokens de la barra sean iguales y oscuros en los dos temas. Los pares de `muted-foreground` y `primary` de la tabla de arriba usan hex sólidos; los de glass, los calcula el test.

### D15. Viewport y móvil

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Diseñar a 360 px y ampliar | Elegida el 2026-10-05; **reemplazada el 2026-10-21**: el escritorio salía como el celular estirado (barra de íconos, columnas de 560 px, filas táctiles) |
| **Escritorio primero, con pantallas propias de celular** | **Elegida (2026-10-21)** |
| Diseñar a 390 px y encoger | Descartada: 360 px es el mínimo que garantizamos y los Android pequeños se romperían |
| Solo web móvil sin pensar en nativo | Descartada: iPhone y Android web primero, luego nativo |

**Elección:** la primera versión funcional se diseña **para escritorio** (1440 y 1280 px; ver [Escritorio v2](#escritorio-v2-2026-10-21)) y cada pantalla tiene **su versión de celular** en el lienzo (las `K-H1-*`, que siguen valiendo). El mínimo garantizado sigue siendo **360 px**, con la matriz **375** (iPhone SE), **~393** (iPhone) y **~430** (Pro Max / Pixel). En el código no cambia la forma de escribir Tailwind: la base es el celular y `md:` / `lg:` amplían.
**Motivo:** en la web el uso principal será el escritorio, y diseñar a 360 px y ampliar dejaba el escritorio pobre. Las pantallas de celular ya estaban bien para la app y se mantienen; las reglas de abajo siguen aplicando a todo lo que se ve en un celular o una tablet.

**Reglas de uso** (detalle y porqués en la skill `mobile-native`)
- **Safe areas:** `viewport-fit=cover` y `env(safe-area-inset-*)` para el botón "+" fijo, la nav inferior, los toasts y las hojas. Ya los aplican `AppShell` (arriba, abajo y a los lados), la barra lateral (arriba, abajo y a la izquierda) y el `Toaster` (abajo y, desde 1024 px, a la derecha); cada elemento fijo nuevo debe aplicarlos con fallback `env(..., 0px)` y probarse en hardware.
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
- **Estados vacíos con la mascota: sí en v1** (KAN-63). La ilustración del grillo detrás de la moneda (la de K-Vacio) va en los estados vacíos que invitan a actuar: el Inicio sin cuentas, Cuentas vacía y Movimientos vacío (lo dibuja FE-18 en el lienzo). Es una imagen decorativa (`alt=""`: el título del estado ya dice lo que pasa), de 120 px en celular y 140 px en escritorio. Los estados de error no la llevan (usan su ícono en `destructive`). El archivo es `public/brand/kanza-symbol.svg` (copiado del kit de marca en KAN-91, junto con `marca-kanza.md` §2 y `src/app/brand-assets.test.ts`, que vigila qué SVG hay en esa carpeta); la pantalla del Inicio sin cuentas (KAN-70) lo usa con `next/image` y `alt=""`.
- Fuera de v1 / otras tareas: pantalla de carga y registro formal de marca. **Avisos del grillo** ("Cri, cri…", el toast de K-Inicio y el peek de Pendientes): dependen de Pendientes, así que se deciden en Hito 2.
- Los estáticos de marca son públicos: `proxy.ts` (KAN-27) los deja pasar sin sesión (`/favicon.ico`, `/favicon.svg`, `/site.webmanifest`, `/brand/*` y los `*.png` de la raíz): su `matcher` excluye solo los archivos de la raíz de `public/` (`png`, `svg`, `ico`, `webmanifest`) y los de `public/brand/` (`png`, `svg`), no cualquier ruta que acabe en `.png`. Un estático nuevo va en la raíz o en `public/brand/`; otra carpeta exige ampliar el matcher, y `proxy.test.ts` recorre `public/` para que un archivo nuevo no se rompa en silencio.

### D17. Web responsive y escritorio

Aprobada por Juan David el 2026-10-07. La web es el producto de ahora (celular, tablet y escritorio); la app nativa llega después. Pantallas de referencia en el lienzo de Kanza: "Inicio con aviso del grillo" (360 px), "Inicio en tablet (768 px)" e "Inicio en escritorio" (1440 px, claro y oscuro).

> **Vigente desde el 2026-10-21:** desde 1024 px manda [Escritorio v2](#escritorio-v2-2026-10-21) (barra ancha con nombres, avatar en la barra, tarjetas sólidas y panel lateral). FE-15 (KAN-69) ya lo implementó: la barra lateral, el avatar y el `Toaster` son los de Escritorio v2. Las viñetas de abajo que dicen otra cosa (barra de íconos de 76 px, globos, avatar en el encabezado desde 1024 px) quedan marcadas como «historia de KAN-41» y no valen; bajo 1024 px todo sigue vigente. Las tarjetas sólidas `surface` de escritorio las usa cada pantalla con su tarea; el token y `Card variant="tile"` existen desde KAN-91.

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Columna de celular centrada en todos los anchos (`max-w-md`, lo que hay hasta KAN-27) | Descartada: en escritorio la app se ve como un teléfono en medio de la pantalla |
| Barra inferior por debajo de 1024 px y barra lateral de íconos desde 1024 px | **Elegida** (la barra de íconos fue reemplazada el 2026-10-21 por la ancha de [Escritorio v2](#escritorio-v2-2026-10-21); la barra inferior sigue) |
| Cambio a barra lateral en 768 px | Descartada: en una tablet vertical la barra inferior se usa mejor con el dedo |
| Barra lateral ancha con nombres | Descartada el 2026-10-07 (la de íconos dejaba más espacio al contenido); **elegida el 2026-10-21** en [Escritorio v2](#escritorio-v2-2026-10-21) |

**Elección**
- **Menos de 1024 px (celular y tablet):** encabezado con el espacio y el avatar, y la barra de navegación inferior flotante. En tablet el contenido se ensancha hasta unos 640 px, centrado. _Hecho en KAN-41: el encabezado plano con el título y el avatar (como el lienzo) y la columna de 640 px; el espacio en el encabezado llega con el selector de espacios. Hecho en FE-15 (KAN-69): la barra inferior con el botón "+" y «Más» ([Navegación del Hito 1](#navegación-del-hito-1-kan-63))._
- **Desde 1024 px (`lg` de Tailwind):** barra lateral ancha con nombres a la izquierda ([Escritorio v2](#escritorio-v2-2026-10-21), FE-15), con el avatar y el menú de la cuenta abajo. El contenido se reparte en tarjetas hasta 1440 px de ancho. _Historia de KAN-41 (la barra de íconos con globos, que Escritorio v2 reemplazó): como el lienzo: la barra es una tarjeta flotante y, junto con el contenido, forma un grupo de hasta 1440 px. Tiene el logo y las secciones (solo Inicio en Hito 0). El avatar no está en la barra sino en el encabezado; abajo queda vacía hasta Hito 1, que trae el botón "+" y, abajo, Categorías ([Navegación del Hito 1](#navegación-del-hito-1-kan-63)); el contador de Pendientes llega en Hito 2, y Ayuda y Ajustes en Hito 3._
- **Las mismas secciones en todos los anchos.** Celular y tablet: Inicio · Movimientos · "+" · Pendientes (con contador) · Más. "Más" agrupa Cuentas, Ayuda y Ajustes. Escritorio: Inicio, Movimientos, Pendientes, Cuentas, "+", y abajo Ayuda y Ajustes. _Es la navegación final (desde Hito 2-3). En Hito 1 todavía no hay Pendientes, Ayuda ni Ajustes: ver [Navegación del Hito 1](#navegación-del-hito-1-kan-63)._
- **"Cerrar sesión" va en el menú de la cuenta**: el avatar del encabezado bajo 1024 px y, desde 1024 px, la fila de la cuenta abajo en la barra lateral (FE-15; antes el avatar estaba en el encabezado en todos los anchos). Sigue lo de KAN-27: siempre disponible en una pantalla con sesión, y la página no muestra datos al volver atrás.
- **Login:** sin versión propia de escritorio; la tarjeta centrada (`max-w-md`) sirve en todos los anchos. Un diseño de escritorio dedicado queda como idea para más adelante.

**Motivo:** la web va primero y tiene que ser cómoda en un computador, no solo en el celular. 1024 px separa el uso con el dedo (celular, tablet vertical) del uso con mouse o en apaisado. Las mismas secciones evitan que el usuario aprenda dos menús. Pendientes va en la barra porque se confirma a diario; Cuentas se consulta menos. En Hito 1, sin Pendientes, ese lugar lo ocupa Cuentas.

**Reglas de uso**
- El diseño parte de los dos artboards de cada pantalla, escritorio (`K-V2-*`) y celular (`K-H1-*`) (D15); en el código, la base de Tailwind es el celular y se amplía con los prefijos (`md:` 768, `lg:` 1024), nunca al revés.
- Matriz de prueba de anchos grandes: **768** (tablet vertical), **1024** (cambio a barra lateral), **1280** y **1440**. El panel "Auditoría" del catálogo y `break-ui` se pasan también en esos anchos.
- Un globo (`Tooltip`) se muestra al pasar el mouse solo bajo `@media (hover: hover)` (D15) y siempre con el foco del teclado, y el botón de solo ícono que lo lleva tiene su `aria-label`. Desde Escritorio v2 la barra lateral no tiene globos (los nombres están a la vista). _KAN-41: lo hace el `Tooltip` de Base UI, que abre con mouse o lápiz y con `:focus-visible` pero nunca con un toque (equivale a `hover: hover`), y se cierra con Escape; el estilo de hover de los enlaces sí usa `hover:` de Tailwind._
- _Historia de KAN-41, resuelta por Escritorio v2:_ en una tablet táctil apaisada (≥1024 px) la barra de íconos no tenía globo al tocar. La barra ancha lleva los nombres, así que ya no hay nada que agregar; su botón «Menú de la cuenta» sube a 44 px con `pointer: coarse`.
- La barra lateral es una tarjeta sólida y oscura también en tema claro. Sus colores (fondo, ícono, ítem activo, contador, globo) son tokens nuevos con su par de contraste en `tokens.test.ts`; nada de hex sueltos (el lienzo tiene `#062016` fijo en el contador: pasa a token). _Hecho en KAN-41: los tokens `sidebar*` y `tooltip` de D14, con los valores del lienzo de cada tema (la barra es `#0E1A14` en claro y `#13241B` en oscuro; el globo, invertido); FE-15 sumó `sidebar-title`, `sidebar-text`, `sidebar-surface`, `sidebar-line`, `sidebar-tile` y `sidebar-tile-foreground`; el contador usará `sidebar-primary` y `sidebar-primary-foreground`._
- Las safe areas siguen aplicando en todos los anchos (`env(safe-area-inset-*)`), incluida la barra lateral en un iPad apaisado: el aire de la tarjeta y el padding del grupo valen `max(aire, inset)`.
- El `Toaster` se sube por encima de la barra inferior (D8) y, desde 1024 px, va abajo a la derecha. _Hecho en KAN-41 para desde 1024 px; hecho en FE-15 (KAN-69) para la barra inferior: el `Toaster` queda 20 px por encima de ella, más la safe area, y en las pantallas sin barra vuelve al offset base (D8)._
- Las listas de dinero (top-5 de gastos) muestran el porcentaje en texto en todos los anchos (D9).

**Implementación (KAN-41; lo de la barra, el avatar y el encabezado cambió con FE-15 desde 1024 px: ver Escritorio v2)**
- **Referencia:** los artboards del lienzo (escritorio claro y oscuro, tablet de 768 px y celular de 360 px). Donde el lienzo y la descripción de la tarea chocaron, ganó el lienzo.
- **Anchos:** bajo 1024 px, una columna centrada de hasta 640 px (`max-w-160`) con gutters de 16 px (los celulares en vertical miden como máximo 430 px, así que ahí es el ancho de la pantalla; sin salto entre 448 y 640 px). Desde 1024 px, la barra y el contenido son **un solo grupo de hasta 1440 px contando la barra**, centrado: con una ventana de 1920 px el grupo queda en el centro, con aire a los lados. Padding del grupo: 16 px arriba y a la izquierda, 24 px a la derecha y abajo; 24 px entre la barra y el contenido; la columna de contenido es `flex-1 min-w-0`.
- **La barra (historia de KAN-41: la de 76 px; la vigente, de 240 px, está en D4 › `Sidebar` y en Escritorio v2; el alto, la posición `sticky` y el padding del grupo siguen igual):** una tarjeta flotante de 76 px, radio 28 px, padding 16/14 px y borde `sidebar-border`, `sticky` a 16 px del borde de arriba y de alto `100dvh − 40 px` (sin insets; con insets, `100dvh − max(1rem, inset-top) − max(1.5rem, inset-bottom)`). Va dentro de una columna que se estira con el contenido, y la tarjeta es un bloque normal de esa columna: en una página corta el documento mide el padding de arriba (16) + la tarjeta + el padding de abajo (24), que es justo una pantalla, así que no scrollea; con la tarjeta 8 px más alta (el alto que tuvo primero, `100dvh − 32 px`) sí lo hacía. Por eso mientras va pegada queda 24 px de aire debajo (no 16), igual que en el lienzo. Los dos valores están en `shell-layout.ts` y un test fija la suma. Sin avatar (el menú de la cuenta estaba en el encabezado); abajo quedaba vacía. FE-15 la llena: el botón de la acción principal, las secciones y, abajo, Categorías y la cuenta del usuario ([Navegación del Hito 1](#navegación-del-hito-1-kan-63)); el contador de Pendientes llega en Hito 2, y Ayuda y Ajustes en Hito 3.
- **El encabezado:** plano, dentro de la columna de contenido y con el mismo ancho y los mismos gutters que la página (el padding es del grupo, no de cada parte). `h1` a la izquierda y, a la derecha, las acciones de la pantalla y (bajo 1024 px; desde 1024 px el avatar vive en la barra lateral, FE-15) el avatar. Medidas del lienzo: celular `padding: 18px 16px 12px` (más el inset de arriba) y 8 px más hasta el contenido; **tablet (768 a 1023 px, K-Tablet): 24 px arriba (más el inset) y 18 px hasta el contenido**; escritorio 8 px de aire arriba (el resto lo pone el padding del grupo) y 20 px hasta el contenido. `h1` de 24 px, 26 px desde 768 px y 30 px desde 1024 px (Montserrat 700, −0,02em; tokens `text-title-tablet`, `text-title-desktop` y `tracking-title`). Un solo `h1` por pantalla. (Los 18 px son los del lienzo: 4 px de `padding-bottom` del `header` de K-Tablet más 14 px de gap; en el código, `md:pb-1` en el encabezado y `md:pt-3.5` en el `main`. El encabezado de escritorio vuelve a `pb-0` con `lg:pb-0`.)
- **El avatar** (del encabezado, bajo 1024 px): 44 px estilo tile glass bajo 768 px; 48 px con `secondary` desde 768 px. Dos iniciales (`initialsOf`). Desde 1024 px, el de la barra lateral (36 px, `sidebar-tile`).
- **Safe areas:** cada lado es `max(gutter, env(safe-area-inset-*))`, no una suma: el inset es espacio que la pantalla ya ocupa (un notch en apaisado). Arriba, el encabezado suma `env(safe-area-inset-top)` a sus 18 px bajo 1024 px, y desde 1024 px lo hacen el aire del grupo y la posición `sticky` de la tarjeta. Falta confirmarlo en hardware (Pendientes).
- **Verificación sin Playwright:** el panel "Auditoría" del catálogo en 360, 375, 393, 430, 768, 1024, 1280 y 1440 px; los anchos y la barra no se pueden probar con jsdom (no carga el CSS de Tailwind). El proyecto "Escritorio" de Playwright (D10) cubrirá los criterios cuando se instale.

#### Escritorio v2 (2026-10-21)

Aprobado por Juan David el 2026-10-21. **Reemplaza, desde 1024 px, lo que dicen arriba la elección, las reglas y la implementación de KAN-41 sobre la barra de íconos de 76 px, el globo, el avatar en el encabezado y el contenido en tarjetas glass**; bajo 1024 px no cambia nada. Referencia: lienzo, filas "Escritorio v2 · Hito 1 (claro)" y "(oscuro)" (`K-V2-*`), que salen del componente base `K-V2-Escritorio`. Las exploraciones A, B y C se borraron del lienzo; se eligió **A+B**: la estructura de A con la identidad de B, y las tarjetas de A.

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Barra de íconos de 76 px con globos (KAN-41) | Reemplazada: no muestra dónde estás sin pasar el mouse y parece la barra del celular de lado |
| **Barra lateral ancha con nombres (240 px)** | **Elegida** |
| Barra superior horizontal | Descartada: con 4 a 6 secciones y el "Registrar" queda apretada, y la barra lateral ya existe |
| A · Clásico ordenado (barra clara, tarjetas sólidas) | Base de la estructura y de las tarjetas |
| B · Menta expresiva (barra oscura, glass, neto grande con el grillo) | Base de la identidad: barra oscura, fondo con blobs, neto con el grillo, panel en glass |
| C · Denso tipo planilla | Descartada: la más fría; puede abrumar a un usuario nuevo |
| **Crear y editar en un panel lateral derecho** | **Elegida**: la lista sigue visible detrás |
| Crear y editar en un diálogo centrado | Descartada: tapa el contexto; se usa solo para avisos y elecciones cortas |
| Crear y editar en una página (D18, celular) | Descartada en escritorio: una columna de 560 px en una pantalla de 1440 px |

**Marco**
- **Grupo:** barra + contenido, hasta 1440 px contando la barra, centrado; padding 16 px arriba y a la izquierda, 24 px a la derecha y abajo; 24 px entre barra y contenido (igual que KAN-41). Fondo `background` con los dos blobs.
- **Barra lateral:** tarjeta flotante oscura en los dos temas (tokens `sidebar*`: `#0E1A14` en claro, `#13241B` en oscuro), de **240 px** (mínimo 216), radio 28, padding 20/14 px, `sticky` a 16 px de arriba y **de una pantalla de alto** (`100dvh − 40 px`, como `shell-layout.ts`). De arriba abajo:
  1. Ícono de 36 px y "Kanza" (Bricolage 800, 22 px, `sidebar-primary`).
  2. **Espacio:** bloque de 48 px con la inicial del espacio, su nombre y la moneda ("Mi espacio · Peso uruguayo · UYU"). En v1 hay un solo espacio: **no es interactivo** (ni botón ni flecha); se vuelve selector cuando existan los hogares (v2).
  3. **"Registrar":** píldora `sidebar-primary` de 46 px con el atajo **N** visible (cuando exista: ver «Atajos y búsqueda»). Abre el panel "Registrar movimiento". **Mientras abra el formulario de cuenta (sin cuentas, o con cuentas antes de que exista el panel de registro de FE-20), el botón dice "Nueva cuenta"** y abre ese formulario (D18); no lleva `aria-label`, para que el nombre accesible sea el texto visible (WCAG 2.5.3).
  4. **Secciones con nombre:** Inicio, Movimientos y Cuentas; enlaces de 44 px, ícono de 20 px y nombre en Karla 15 (700 la activa, con fondo `sidebar-accent`; 600 el resto). Ícono fill en la activa (D5). `aria-current="page"`.
  5. **Abajo:** Categorías (en Hito 3 se suman Ayuda y Ajustes) y, tras un separador, **la cuenta del usuario**: avatar de 36 px con las iniciales, nombre, correo (cortado con "…") y un botón "Menú de la cuenta" que abre el menú con "Cerrar sesión". **Desde 1024 px el avatar sale del encabezado y vive aquí**; bajo 1024 px sigue en el encabezado (KAN-41).
- **Encabezado:** `h1` (30 px) con una línea secundaria debajo ("Martes 21 de octubre · así va tu mes" en el Inicio; el neto en Cuentas; el mes y el número de movimientos en Movimientos). A la derecha, las acciones de la pantalla: en el Inicio, la búsqueda ("Buscar movimientos": al enviarla lleva a Movimientos con la búsqueda aplicada) y el selector de mes; en Cuentas, "Nueva cuenta"; en Movimientos, "Registrar movimiento".
- **Tarjetas:** sólidas, token nuevo `surface` (`#FFFFFF` claro / `#142019` oscuro), borde `border`, radio **20** (token nuevo `radius-card`), padding 22 a 24 px; sin glass. Contenedores de ícono en `primary` suave (`#E3F1EA` / `#173B2C`) o `debt` suave en tarjetas. Las filas se reparten con `flex-wrap` y bases de 560 y 320 px (2/3 y 1/3), así que a 1024 px pasan a una columna sin romperse.
- **Densidad de escritorio:** filas de lista de 50 a 54 px, filas de tabla de 48 px, texto de tabla Karla 15, controles principales de 42 a 46 px. Los controles secundarios (botones de ícono de fila, "Menú de la cuenta", "Volver", filtros, chips como "Hoy" y "Ayer" y el segmentado de tipo) miden de 34 a 40 px: es una excepción al mínimo de 44 de D13 que vale **solo desde 1024 px y con `pointer: fine`**; con `pointer: coarse` (una tablet apaisada usada con el dedo) suben a 44.
- **Panel lateral** (`Sheet` de shadcn con `side="right"`): flotante a 12 px de los bordes, **440 px**, radio 30, `glass-strong`, sombra y velo (`scrim`) sobre la página; `role="dialog"` modal, foco atrapado, Escape y el velo lo cierran. Título a la izquierda y "Cerrar" (44 px) a la derecha; contenido con scroll propio; abajo a la derecha **Cancelar · acción primaria**. Se usa para **Nueva cuenta, Editar cuenta, Cuadrar saldo, Registrar movimiento y Editar movimiento**. Cuadrar saldo abierto desde Editar cuenta lleva "Volver" a la izquierda del título.
- **Diálogos centrados:** solo para avisos y elecciones cortas: "Moneda de tu espacio" (480 px) y "Todavía no puedes archivar…" (`alertdialog`, 460 px). Fondo `popover` sólido, radio 24.
- **Toasts:** abajo a la derecha (D8, sin cambio).
- **Lienzo y tokens:** donde el lienzo pinta un valor suelto, mandan los tokens: el panel usa `glass-strong` (D14), los diálogos `popover`, el velo `scrim` y el toast el de D8 (`glass`, no el sólido invertido del lienzo). Los bordes de los controles usan `input`, y las acciones de cada fila se ven con contraste completo (3:1 mínimo para íconos), aunque el lienzo las dibuje más tenues. La barra no tiene tope de alto: el de 920 px del lienzo es solo del artboard.

**Pantallas** (cada una en claro y oscuro)
- **Inicio (dashboard):** fila 1, la tarjeta del **Neto** (2/3: monto de 42 px, chip "+ $ 4.330,00 este mes", el grillo asomado y la evolución de 6 meses, D9) y, a la derecha (1/3), tres tarjetas apiladas: **Disponible**, **Deuda de tarjetas** y **Gastos de {mes}** ("Gastos de octubre", con la comparación contra el mes pasado: "8 % menos que en septiembre"). Fila 2: **Ingresos y gastos** de 6 meses (2/3, D9) y **Gastos por categoría** (top-5, 1/3). Fila 3: **Últimos movimientos** en tabla (Fecha, Descripción, Categoría como chip, Cuenta, Monto; 6 filas y "Ver todos") y **Cuentas** (lista compacta con saldo; cada fila abre su detalle).
- **Inicio sin cuentas:** dos tarjetas lado a lado, hasta 1120 px: la del grillo ("Empieza por tus cuentas", el texto de D18 y "Crear mi primera cuenta") y la de la moneda ("Moneda de tu espacio", la moneda, la nota y "Cambiar", que abre el diálogo).
- **Cuentas:** a la izquierda (hasta 400 px), los grupos Disponible y Deuda con su total y "Archivadas (n)" plegable; la cuenta elegida queda marcada. A la derecha, **el detalle**: ícono, nombre y tipo; "Cuadrar saldo" y "Editar"; el saldo de hoy (o la deuda) y una cifra del mes ("Movimiento neto de octubre" en banco y efectivo; "Consumos de octubre" en tarjetas); y la tabla de **movimientos de esa cuenta** con el mes, "Filtrar" y la columna **Saldo** (o **Deuda**) después de cada movimiento.
- **Movimientos:** tarjeta de filtros (búsqueda por descripción, mes, cuenta, categoría y tipo: Todos · Gastos · Ingresos · Transferencias, como botones con `aria-pressed`); tres cifras del período filtrado (**Ingresos**, **Gastos** y **Te quedan**); tabla con Fecha (orden por defecto, descendente, `aria-sort`), Descripción, Categoría con subcategoría ("Comida › Supermercado"), Cuenta ("Itaú → Visa Itaú" en transferencias), Monto (ordenable) y acciones Editar y Eliminar en cada fila; "Mostrando 14 de 48 movimientos" y "Cargar más" (cursor, D2). Transferencias en `muted`, sin signo y rotuladas "Transferencia"; ajustes en `muted`, con su signo (suben o bajan el saldo) y rotulados "Ajuste" (sin categoría). Eliminar en la fila borra sin confirmación y muestra "Eliminaste «…»" con "Deshacer" (D8). Sin resultados: "No hay movimientos con estos filtros" y "Quitar filtros". Vacío: el grillo, "Aún no tienes movimientos", "Registra un gasto, un ingreso o una transferencia entre tus cuentas. Puedes empezar por lo que gastaste hoy." y "Registrar movimiento". Los filtros van en la URL (D2).
- **Registrar y editar movimiento** (panel): tipo Gasto · Ingreso · Transferencia (los ajustes no se registran a mano: salen de "Cuadrar saldo"); **Monto** grande (Montserrat 28, prefijo de la moneda con `formatMoney`, D11); Gasto e Ingreso: **Cuenta** y **Categoría** (la de gasto agrupada por principal con `optgroup`); Transferencia: **Desde** y **Hacia** y la nota "Pagar la tarjeta es una transferencia: no cuenta como gasto. El gasto ya contó cuando compraste."; **Fecha** con "Hoy" y "Ayer" (hoy en la zona del espacio, D11); **Descripción (opcional)**. Botón "Guardar gasto", "Guardar ingreso" o "Guardar transferencia"; al editar, "Guardar cambios" y "Eliminar movimiento", que cierra el panel y muestra "Eliminaste «Uber»" con "Deshacer" (D8).

**Atajos y búsqueda (decidido el 2026-10-21):** el atajo **N** (abrir "Registrar movimiento" cuando el foco no está en un campo de texto) entra en el Hito 1 con FE-20; la pista "N" de la barra lateral se muestra solo cuando el atajo exista. La búsqueda global con **Ctrl K** (paleta de comandos) queda para el Hito 2: hasta entonces no se muestra su pista y la búsqueda es la de Movimientos por descripción (la caja del Inicio lleva ahí).

#### Navegación del Hito 1 (KAN-63)

Aprobada por Juan David el 2026-10-18. Referencia en el lienzo: "H1 · Barra inferior", "H1 · Más" y la barra lateral de las pantallas `K-V2-*` (claro y oscuro). La implementó FE-15 (KAN-69). **Cómo quedó el código:** `components/nav-sections.ts` guarda `NAV_SECTIONS`, `MORE_SECTIONS` y `PRIMARY_ACTION`, y la barra inferior (`BottomNav`), la barra lateral (`Sidebar`) y `/mas` los leen; **cada tarea que construye una pantalla enciende su entrada** (ver «Solo secciones que existen»). Al cerrar FE-15 la navegación real muestra solo Inicio, sin «+» ni «Más»; el catálogo (`/catalog`, sección «Navegación del Hito 1») enseña la navegación completa con las piezas reales.

- **Barra inferior (menos de 1024 px):** Inicio · Movimientos · "+" · **Cuentas** · Más. Es la barra completa del Hito 1. Mientras falten pantallas, solo se muestran las secciones que ya existen (ver «Solo secciones que existen»). Cuentas ocupa el lugar que en Hito 2 toma Pendientes (con su contador); entonces Cuentas pasa a "Más", como dice la elección de arriba.
  - Medidas de K-Inicio: tarjeta glass flotante (`glass`, D13) a 12 px de los bordes (abajo, 12 px o la safe area, lo que sea mayor: `max(12px, env(safe-area-inset-bottom))`), 68 px de alto y radio 30. Cada sección es un enlace de al menos 64 × 52 px con el ícono de 22 px y el label debajo (2 px de separación); la activa lleva una píldora `primary` al **10 %** en claro (el lienzo dibuja 12 %, pero con ese alfa el label de 11 px baja a 4,47:1 sobre glass con el primer blob detrás; `tokens.test.ts` lo mide) y al 14 % en oscuro, radio 22 (`rounded-xl`, 22,4 px), ícono **fill** y texto `primary` (D5); el resto, ícono regular y `muted-foreground`. `aria-current="page"` en la activa.
  - **Label:** Karla 11 px, 700 en la activa y 600 en el resto; desde 768 px, 12 px (K-Tablet). Es la única excepción al mínimo de 13 px (D13).
  - **"+":** círculo `primary` de 52 px (54 desde 768 px) con sombra, `aria-label` según su destino (ver al final de esta viñeta). Hasta que llegue la hoja de registro (FE-20), y siempre que el espacio no tenga cuentas, lleva al formulario de cuenta (D18). Mientras lleve al formulario de cuenta, su `aria-label` es "Nueva cuenta"; con la hoja de registro pasa a "Registrar movimiento". _Hecho en FE-15: el destino es `PRIMARY_ACTION` (`nav-sections.ts`) y vale `null` hasta que exista la pantalla a la que lleva: sin destino no se dibuja ni el «+» ni el botón de la barra lateral, para no mandar a un 404. Hecho en FE-16 (KAN-70): la ruta `/cuentas/nueva` existe y `PRIMARY_ACTION` la apunta; el «+» (que solo se ve bajo 1024 px) es un enlace normal a esa página. FE-20 cambia el destino y los textos._
  - **Tablet (768 a 1023 px):** la barra de K-Tablet, de 480 px centrada, con Cuentas en lugar de Pendientes; no tiene artboard propio en Hito 1.
  - El `Toaster` va **20 px por encima de la barra** (como "H1 · Cuenta archivada"): su borde de abajo queda a `max(12px, env(safe-area-inset-bottom)) + 68px + 20px` del borde de la pantalla (D8). En las pantallas sin barra inferior (el formulario de cuenta) vuelve al offset base de D8. _Hecho en FE-15: `AppShell` con `hideBottomNav` no monta la barra y `globals.css` solo define el offset del toast cuando la página contiene la barra (D8)._
- **"Más" (solo bajo 1024 px):** pantalla con `h1` "Más" y grupos de enlaces con título de sección (Karla 14 · 700, `muted-foreground`). En Hito 1 tiene un solo grupo, "Organiza", con **Categorías** (la dibuja FE-18 en el lienzo y la implementa su sub-tarea de frontend). En Hito 2 se suma Cuentas; en Hito 3, Ayuda y Ajustes. No se rellena con opciones que no existen. Cada fila mide 72 px: contenedor de ícono de 42 px (duotone, D5), título, una línea secundaria y un chevron.
- **Barra lateral (desde 1024 px):** la de [Escritorio v2](#escritorio-v2-2026-10-21): logo; el espacio; "Registrar" (mismo destino que el "+" de la barra inferior; sin cuentas dice "Nueva cuenta"); Inicio, Movimientos y Cuentas; y **abajo, Categorías** (en Hito 3, junto a Ayuda y Ajustes) y la cuenta del usuario. Desde 1024 px no hay "Más": `/mas` no tiene sentido ahí (redirige a `/`: ver abajo).
- **Solo secciones que existen:** la navegación muestra una sección cuando su pantalla ya está construida (cada una es una entrada de `NAV_SECTIONS`). En el sprint 1 del Hito 1 son Inicio, "+" y Cuentas; Movimientos entra con su pantalla, y "Más" (con Categorías) cuando exista Categorías. Así ningún enlace lleva a un 404 en staging.
- **`/mas` desde 1024 px redirige a `/`:** en escritorio sus opciones ya están en la barra lateral. _Hecho en FE-15: `DesktopRedirect` (cliente) hace `router.replace("/")` desde 1024 px, también si la ventana crece estando en `/mas`, y toda la columna de contenido (`AppShell` con `phoneOnly`, el `h1` incluido) es `lg:hidden` mientras tanto. Mientras `MORE_SECTIONS` esté vacío (no hay Categorías), `/mas` redirige a `/` en el servidor y la pestaña «Más» no se dibuja._
- **Sección activa en subpáginas:** en celular, "Más" queda activa en sus subpáginas (`/categorias`); en escritorio, la activa es Categorías, abajo en la barra lateral.
- **Pantallas sin barra:** las de formulario con "Volver" (la de cuenta, D18) no muestran la barra inferior, para dejar sitio al teclado; la barra lateral sí se queda en escritorio.

### D18. Primer uso y Cuentas (Hito 1)

Aprobada por Juan David el 2026-10-18 (KAN-63 [FE-14]). Referencia en el lienzo: fila "Hito 1 · navegación, primer uso y Cuentas" (celular, claro y oscuro) y, en escritorio, las filas "Escritorio v2 · Hito 1" (`K-V2-*`). La implementan FE-16 (KAN-70, primer uso y formulario), FE-17 (KAN-71, Cuentas) y FE-26 (KAN-89, detalle de cuenta en escritorio). Reglas de producto en [`docs/decisiones-producto.md`](../../docs/decisiones-producto.md) (Primer uso, Moneda, Cuentas) y en `docs/modelo-de-datos.md` (`accounts`).

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Formulario de cuenta en una hoja (sheet) | Descartada: tiene hasta cinco campos y el teclado taparía la mitad de la hoja |
| Formulario de cuenta en un diálogo en escritorio | Descartada: tapa el contexto |
| Formulario de cuenta en una página en todos los anchos | Elegida el 2026-10-18; **cambiada el 2026-10-21** en escritorio |
| **Formulario de cuenta en una página bajo 1024 px y en el panel lateral desde 1024 px** | **Elegida (2026-10-21)**: el mismo componente de formulario dentro de dos contenedores; la URL `/cuentas/nueva` y `/cuentas/{id}` sigue existiendo y en escritorio abre el panel sobre Cuentas |
| Moneda dentro del formulario de la primera cuenta | Descartada: el formulario lo reutiliza FE-17 y la moneda es del espacio, no de la cuenta |
| **Moneda como una fila "Cambiar" en el Inicio vacío** | **Elegida** |
| Archivar con confirmación | Descartada: archivar se deshace; un toast con "Deshacer" (D8) basta |
| Pantalla de detalle de cuenta con sus movimientos | **Desde 1024 px, dentro del Hito 1 (2026-10-21)**: lista y detalle lado a lado ([Escritorio v2](#escritorio-v2-2026-10-21)). Bajo 1024 px sigue igual: tocar una cuenta abre su edición |

**Elección y reglas de uso**
- **Fuente de verdad:** los textos exactos salen de los artboards (`K-H1-*` en celular y `K-V2-*` en escritorio), salvo lo que este documento fija explícitamente (por ejemplo, el símbolo de la moneda y el `aria-label` del "+"). Este documento fija la estructura, las reglas y los casos que el lienzo no dibuja.
- **Dinero y moneda:** ningún "$" va fijo. El prefijo del campo de dinero y todos los importes de los textos ("$ 0,00", el saldo del aviso, el ajuste) se arman con `formatMoney` (o `formatToParts` para el símbolo) y la moneda del espacio (D11): en un espacio en USD se ve "US$". Los nombres de las monedas para la lista ("Peso uruguayo"…) van en `lib/core/i18n.ts`, porque `currencies` no trae nombre; la lista sigue el orden de ese mapa (UYU, COP, USD, ARS, BRL, EUR), y una moneda sin nombre se muestra con su código.
- **Inicio sin cuentas** ("H1 · Inicio sin cuentas" en celular; "Inicio sin cuentas" de `K-V2-*` en escritorio): encabezado "Hola, {nombre}" y avatar (desde 1024 px, el avatar está en la barra lateral); una tarjeta con el grillo (D16), el título "Empieza por tus cuentas", el texto "Agrega dónde está tu dinero hoy: un banco, tu efectivo o una tarjeta. Con su saldo actual verás tu neto al instante." y el botón primario "Crear mi primera cuenta", que abre el formulario. Debajo, la fila **"Moneda de tu espacio: Peso uruguayo · UYU"** con el botón "Cambiar" y la nota "Puedes cambiarla hasta que registres tu primer movimiento.". En escritorio, la tarjeta y la de la moneda van lado a lado, hasta 1120 px ([Escritorio v2](#escritorio-v2-2026-10-21)).
  - La fila de moneda se muestra en el Inicio **mientras el espacio no tenga movimientos**, haya cuentas o no: es la misma regla del backend (BE-17). Una primera cuenta con saldo inicial crea un ajuste y la fila desaparece; con saldo 0 no hay ajuste y la fila sigue hasta el primer movimiento. En Hito 3 la moneda también estará en Ajustes.
- **Elegir la moneda** ("H1 · Elegir la moneda"): hoja (`glass-strong`, radio 30 arriba, D13) con el título "Moneda de tu espacio", la explicación y la lista de las monedas de `GET /currencies` como radios (nombre en español y código; la elegida en negrita sobre `primary` al 8 % en claro y al 12 % en oscuro); botón "Usar esta moneda". En escritorio, el mismo contenido en un diálogo. El 409 de "ya hay movimientos" se muestra con su traducción (FE-16).
- **Formulario de cuenta** ("H1 · Nueva cuenta", "Nueva tarjeta" y "Editar tarjeta"): página con "Volver" y `h1` "Nueva cuenta" o "Editar cuenta", sin barra inferior. Una tarjeta con:
  - **Tipo:** control segmentado (radios) Banco · Efectivo · Tarjeta, solo al crear. **Al editar, el tipo se muestra fijo** con la nota "El tipo no se cambia después de crear la cuenta.".
  - **Nombre** (placeholder según el tipo: "Ej.: Itaú", "Ej.: Billetera", "Ej.: Visa Itaú").
  - **Saldo actual** (banco y efectivo) o **Deuda actual** (tarjeta), solo al crear: campo de dinero con el símbolo de la moneda delante (ver «Dinero y moneda»), `inputmode="decimal"`, Montserrat 600 18 px; la deuda se escribe en positivo y se ve en color `debt`. Ayuda: "Se registra como ajuste: no cuenta como ingreso" (o "como gasto" en la tarjeta).
  - **Día de cierre** y **Día de vencimiento** (solo tarjeta): dos `select` de 1 a 31 lado a lado, con la ayuda "Con estos días Kanza calcula cuánto pagar cada mes.".
  - Botón "Crear cuenta" o "Guardar cambios". **Desde 1024 px, el formulario va en el panel lateral** sobre Cuentas, con "Cancelar · Crear cuenta" abajo a la derecha y "Más acciones" dentro del panel al editar ([Escritorio v2](#escritorio-v2-2026-10-21)).
  - **Al editar**, debajo hay un grupo "Más acciones" con **Cuadrar saldo** y **Archivar cuenta** ("Solo con saldo en $ 0,00").
- **Cuentas** ("H1 · Cuentas" en celular; "Cuentas (lista y detalle)" de `K-V2-*` en escritorio): encabezado "Cuentas" con el botón "Nueva cuenta" (ícono de 44 px en celular; píldora `primary` con texto desde 1024 px) y, bajo 1024 px, el avatar (desde 1024 px está en la barra lateral).
  - Dos grupos con su total a la derecha del título: **Disponible** (bancos y efectivo) y **Deuda** (tarjetas, total y saldos en `debt`, en positivo como en el Inicio). Van uno debajo del otro en todos los anchos; desde 1024 px forman una columna de hasta 400 px con el detalle de la cuenta elegida a la derecha ([Escritorio v2](#escritorio-v2-2026-10-21)).
  - Bajo 1024 px, cada cuenta es una fila-enlace de 68 px a su edición; desde 1024 px, una fila de 54 px que elige la cuenta del detalle (`aria-current`). En los dos casos: ícono duotone en un contenedor de 42 px (banco, billetes o tarjeta), nombre (cortado con "…" si no cabe), una línea secundaria (el tipo, o "Cierra el 5 · vence el 12" en la tarjeta) y el saldo con `formatMoney`.
  - Al final, **"Archivadas (n)"** plegado (`aria-expanded`); al abrirlo, cada archivada en `muted-foreground` con su botón "Desarchivar". Si no hay archivadas, la fila no aparece. Desarchivar usa el endpoint de desarchivar de BE-16 (KAN-67), igual que el "Deshacer" del toast.
  - Estados: **carga** (esqueleto de un grupo de 3 filas), **vacío** (el grillo, "Aún no tienes cuentas" y "Crear cuenta"; solo pasa sin ninguna cuenta, porque el primer uso empieza en el Inicio) y **error** (ícono en `destructive`, "No se pudieron cargar tus cuentas", "Revisa tu conexión e inténtalo de nuevo; tus datos están a salvo." y "Reintentar"). Están en los Tweaks del artboard.
- **Archivar** (desde "Editar cuenta"): con saldo 0, sin confirmación: se vuelve a Cuentas, la cuenta aparece en "Archivadas" y sale el toast "Archivaste «{nombre}»" con "Deshacer" (D8, "H1 · Cuenta archivada"), que desarchiva con el endpoint de BE-16 (KAN-67). Si el saldo no es 0 (409 de BE-16), se abre sobre la edición una hoja de alerta en celular y un diálogo de alerta desde 1024 px (`alertdialog`, "H1 · No se puede archivar" en celular y "No se puede archivar" de `K-V2-*` en escritorio). Título "Todavía no puedes archivar {nombre}"; primera frase "Para archivar una cuenta, su saldo tiene que ser {$ 0,00}." más el saldo de hoy ("Hoy debes {saldo} en esta tarjeta." o, en banco y efectivo, "Hoy tiene {saldo}."); segunda frase según el tipo: tarjeta, "Págala con una transferencia o, si ya no la usas, cuadra su saldo en {$ 0,00}."; banco y efectivo, "Pasa el dinero a otra cuenta con una transferencia o, si ya no la usas, cuadra su saldo en {$ 0,00}.". Botones "Cuadrar saldo" (abre el cuadre de esa cuenta) y "Entendido". Los artboards dibujan estas hojas sobre la lista solo como fondo; en la app se abren sobre la edición.
- **Cuadrar saldo** (desde "Editar cuenta" o desde el aviso de archivar; "H1 · Cuadrar saldo" en celular y "Cuadrar saldo (panel)" de `K-V2-*` en escritorio): hoja en celular y, desde 1024 px, **el mismo panel lateral** (con "Volver" si viene de Editar cuenta), en lugar del diálogo de 440 px (cambiado el 2026-10-21). Muestra la cuenta y su tipo, el "Saldo en Kanza" y un campo cuya etiqueta depende del tipo: «Saldo real en tu banco» (banco), «Efectivo que tienes» (efectivo) o «Deuda real de la tarjeta» (tarjeta; la deuda se escribe en positivo, como en el formulario). Debajo, en `primary` suave y con `aria-live="polite"`, la vista previa del ajuste: con el campo vacío, "Escribe el saldo que ves en tu banco." ("…que tienes en efectivo." / "…que dice el resumen de tu tarjeta."); con diferencia, "Se registrará un ajuste de +{monto}. No cuenta como ingreso ni gasto." (con "−", U+2212, si baja). En una tarjeta, sin signo y en palabras, porque la deuda se escribe en positivo: "Tu deuda sube {monto}. No cuenta como ingreso ni gasto." o "Tu deuda baja {monto}. No cuenta como ingreso ni gasto."; sin diferencia, "El saldo ya coincide: no se registra ningún ajuste.". Botones "Cuadrar saldo" y "Cancelar" (en escritorio, abajo a la derecha del panel: Cancelar · Cuadrar saldo).

**Cómo quedó el código (FE-16, KAN-70).**
- **El formulario en escritorio es un panel sobre la pantalla actual, no una página.** `PrimaryActionLink` (la barra lateral y «Crear mi primera cuenta») pone `?cuenta=nueva` en la URL con `history.replaceState` y `AccountPanelHost` (montado por `AppShell`) lo lee con `useSearchParams` (Next integra ambos: no hay petición al servidor ni entradas de historial). Así el panel abre sobre el Inicio hoy y sobre Cuentas mañana (FE-17), con refresco y enlace directo funcionando. La URL `/cuentas/nueva` es la página de celular; desde 1024 px redirige a `/?cuenta=nueva` (desde KAN-71 apunta a `/cuentas?cuenta=nueva`, el panel sobre la lista).
- **Días de cierre y de vencimiento sin preselección** (el lienzo los dibuja en 5 y 12 como estado de ejemplo): «Elige» y obligatorios en tarjeta; un día inventado alimentaría «cuánto pagar» con una fecha falsa.
- **Monto:** decimal con «,» o «.», sin separador de miles; más decimales que el `exponent` de la moneda es un error (no se redondea); «−» inicial solo en banco y efectivo (descubierto); la deuda de una tarjeta se escribe positiva y viaja negativa (`initial_balance_minor`); vacío o 0 no crea ajuste.
- **La moneda y el primer movimiento:** crear la primera cuenta con un saldo distinto de 0 registra un ajuste y bloquea la moneda (`currency_locked`); la tarjeta de la moneda desaparece entonces del Inicio. Quien crea la cuenta antes de mirar la moneda se queda con UYU; el campo de saldo muestra el símbolo de la moneda para que se note.
- **Inicio con cuentas, mientras FE-24 no exista:** «Tus cuentas» (`AccountsSummary`) y la tarjeta de la moneda si el espacio aún no tiene movimientos. Una cuenta que falla al cargar es un error con «Reintentar», nunca «sin cuentas». Con solo cuentas archivadas, el Inicio vuelve al primer uso.
- **Desviaciones del lienzo, por D14 y D17:** el borde de los campos es `--input` (3:1) y no el 14 % del lienzo; el símbolo de la moneda es el del espacio, no un «$» fijo; el título de «Empieza por tus cuentas» mide 20 px en celular (el lienzo, 19) por no inventar un tamaño; el contenedor del ícono es `primary-soft`.

**Cómo quedó el código (FE-17, KAN-71 y FE-28, KAN-92).**
- **Pantalla Cuentas (KAN-71):** la pantalla `/cuentas` (lista, totales, archivadas con «Desarchivar» y, desde 1024 px, el detalle de la cuenta elegida) y la entrada Cuentas de la navegación. La cifra del mes y la tabla de movimientos del detalle son de KAN-89 (hace falta el endpoint de movimientos; no hay relleno mientras tanto).
- **Datos:** el Server Component precarga **una sola lista con las archivadas** (`include_archived=true`) y la pantalla separa activas y archivadas en el cliente; las mutaciones invalidan `["spaces", id]` y llaman `router.refresh()` (el neto del encabezado, la barra lateral y el Inicio vienen del servidor). Los totales y el neto salen de esa misma lista con BigInt (`summarizeAccounts`), no de `/balance-summary`, para que el subtítulo, los totales y las filas siempre cuadren.
- **Selección en escritorio:** `?sel=<id>` en la URL (`history.replaceState`, sin petición ni entradas de historial); `?cuenta=` es del panel. Sin param, o con una cuenta archivada o inexistente, el detalle muestra la primera activa (Disponible antes que Deuda).
- **Filas (KAN-92):** todas son un `AccountLink` a `/cuentas/<id>`, la página de la cuenta en celular. Desde 1024 px un clic sin modificadores en Cuentas escribe `?sel`, y desde el Inicio (también las filas de «Tus cuentas») lleva a `/cuentas?sel=<id>`; así el celular y el escritorio no comparten un destino que parpadee con la redirección.
- **Paneles de una cuenta (KAN-92):** `?cuenta=editar` y `?cuenta=cuadrar` con `?sel=<id>` abren un solo panel (`AccountEditPanel`) que cambia entre las dos vistas; lo abren los botones «Cuadrar saldo» y «Editar» de la cabecera del detalle (escriben `sel` y `cuenta` de una vez porque el detalle puede mostrar la primera cuenta sin `?sel`). Mientras la cuenta carga el cuerpo es un esqueleto y si falla, un `Alert` con «Reintentar» dentro del panel. Bajo 1024 px el host lleva a `/cuentas/<id>` (cuadrar, con `?cuenta=cuadrar`, que abre la hoja inferior de «Cuadrar saldo»).
- **Cuadrar:** el campo empieza vacío; la vista previa se calcula con enteros (`previewReconcile`). Tras cuadrar el panel se cierra siempre (también si se llegó con «Volver»), con el toast «Cuadraste «X»» sin «Deshacer», y la página se refresca después de cerrar.
- **Archivar:** sin confirmación; «Deshacer» desarchiva. Ante el 409 el aviso lee la cuenta de nuevo para decir el saldo de ahora, y se apila sobre el panel de edición (el diálogo es hijo del popup del panel). Su «Cuadrar saldo» cambia el panel a Cuadrar con «Volver».
- **Ayuda de «Cuadrar saldo» por tipo:** el lienzo la escribe solo para el banco («Iguálalo con lo que dice tu banco»); en efectivo y tarjeta se adaptó («Iguálalo con el efectivo que tienes», «Iguálala con el resumen de tu tarjeta»).
- **Sin cuentas activas:** el estado vacío («Aún no tienes cuentas», «Crear cuenta») ocupa el lugar de la lista y el detalle, y si hay archivadas van debajo para poder desarchivarlas.
- **Ancho a 1024 px:** la lista mide 320 px (300 como mínimo si falta sitio) y el detalle ocupa el resto con `min-w-0`; como el detalle ya no lleva tabla, cabe sin envolver debajo de la lista.
- **Desviaciones del lienzo:** el título de cada grupo va fuera de la tarjeta de filas también en escritorio (el lienzo lo mete dentro); «Desarchivar» muestra el toast “Desarchivaste «…»” sin «Deshacer», que el lienzo no dibuja. Cada archivada muestra el tipo y el saldo en dos líneas (el lienzo, en una) porque un saldo nunca se trunca (break-ui): el nombre y el tipo se cortan con «…», el saldo pasa a otra línea. En escritorio la fila elegida va en `primary` al 10 % (12 % en oscuro) con un anillo interior en `primary` pleno (3:1, WCAG 1.4.11) y el hover usa `primary` al 5 %, para que pasar el ratón por otra fila no oculte cuál está elegida.

**Motivo:** el primer uso tiene que llevar a crear la primera cuenta sin pasos de onboarding (decisión de producto), y la moneda se elige justo antes porque después queda fija. Agrupar por Disponible y Deuda repite el modelo mental del Inicio (Disponible − Deuda = Neto). Archivar con "Deshacer" sigue el patrón de borrado de toda la app, y el aviso de saldo distinto de 0 dice qué hacer en vez de solo bloquear.

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

Las filas de revisión visual y de hardware se actualizaron con lo que verificó KAN-30 (aceptación del Hito 0 en staging, 17/10/2026: [`docs/qa/hito-0-aceptacion-staging.md`](../../docs/qa/hito-0-aceptacion-staging.md)) y con KAN-62 (revisión visual: [`docs/qa/hito-0-revision-visual.md`](../../docs/qa/hito-0-revision-visual.md)). **Verificado a ojo** quiere decir que el humano lo miró contra el artboard del lienzo, sin medir; **medido**, que hubo una lectura numérica. En KAN-62 no se midió nada: todo lo que se ejecutó quedó a ojo.

| Pendiente | Estado / lo resuelve |
|---|---|
| Actualizar `frontend/CLAUDE.md` | Hecho (KAN-33) |
| ESLint: `no-restricted-imports` para core (fusionado con la regla de `process`) y Phosphor siempre desde `/ssr` | Hecho (KAN-33) |
| Verificaciones de `shadcn init`, de `@hookform/resolvers` con zod 4 y de `optimizePackageImports` | Hecho (KAN-33): ver D4, D5 y D7 |
| Glass: CSS generado con ambas declaraciones y fallback | Hecho sobre el CSS del build (KAN-33). **Pendiente de hardware:** Safari 16.4–17 real, `prefers-reduced-transparency: reduce` y Android de gama baja (Juan David o qa). KAN-62 no pudo verificarlo: sin dispositivo con iOS 16.4-17 (B1), sin Android de gama baja (B4), y `prefers-reduced-transparency` no se ejecutó (A9, por decisión del humano) |
| Export `viewport` (`viewportFit`, `interactiveWidget`, `themeColor` por esquema, `colorScheme`) | Hecho (KAN-33). Prueba en dispositivo real pendiente |
| Adaptar el CSS de shadcn a `prefers-color-scheme` y definir tokens, radios y blobs | Hecho (KAN-33) |
| Convención de errores tipados para el `queryFn` y dónde viven las query keys / `queryOptions` | Hecho (KAN-33): `unwrap` + `ApiError`, `lib/core/data/<recurso>.ts` |
| Comprobar en `typecheck` que un esquema zod de request es asignable al tipo generado | Patrón documentado en `CLAUDE.md` (Formularios); se aplica con el primer esquema real (no existe ninguno aún) |
| Playwright: instalar, proyectos "Escritorio" (Chromium, 1280 px, el principal), "iPhone" (WebKit) y "Pixel" (Chromium, viewport de 360 px) | **No se instaló en KAN-33** (decisión de Juan David: no hay specs ni CI de frontend aún). Lo resuelve la primera sub-tarea de E2E (qa) |
| Comparar la salida del formateador de dinero y fechas en Node con la de WebKit y Chromium (diferencias de ICU: NBSP o NNBSP, símbolos, separadores de grupo) | Con el E2E de iPhone y Pixel (misma sub-tarea que Playwright) |
| `Toaster` de Sonner montado en `layout.tsx` | Hecho (KAN-34) |
| `lib/core/i18n.ts` (mapa único de traducciones) | Hecho (KAN-34): errores del backend (`describeApiError`, `fieldErrorMessage`). Los valores de dominio (`expense`, `pending`, `credit_card`…) se añaden con la primera pantalla que los muestre |
| `lib/core/schemas/` | Hecho (KAN-26): `auth.ts` (login y registro) |
| `tnum` de Montserrat y Karla con el archivo que sirve `next/font` | Catálogo hecho (KAN-34). **Visto a ojo (KAN-62), sin medir:** las cifras de Montserrat y de Karla en el catálogo (sección "Cifras") se dieron por buenas visualmente. No se midió el ancho de "1111" y "8888" ni se comprobó la fuente servida; si más adelante se ve una desalineación, reabrir |
| Contraste AA en claro y oscuro, incluido `--input` sobre cada superficie y los pares con alfa o blob | Hecho (KAN-34): `--input` oscuro subió a alfa 0,40 y `tokens.test.ts` compone los pares translúcidos sobre fondo y blobs. **Visto en pantalla a ojo (KAN-62)**, en Chrome de escritorio: el catálogo en claro y oscuro se lee bien; sin medir. Los pares calculados siguen en `tokens.test.ts` |
| `popover-foreground` asumido igual a `foreground` | Hecho (KAN-34): `popover-foreground` sobre `popover` tiene su par en `tokens.test.ts` y `Toaster` y los popovers usan `foreground` |
| Excepción del label de la nav de 11 px y su fuente | Hecho (KAN-63 y FE-15, KAN-69): Karla 11 px (`text-nav-label`), 700 activa / 600 resto, 12 px desde 768 px (D13 y [Navegación del Hito 1](#navegación-del-hito-1-kan-63)) |
| Safe areas: `AppShell` y `Toaster` ya aplican `env(safe-area-inset-*)` (KAN-34); cada elemento fijo nuevo (nav inferior, botón "+", sheet) debe aplicarlo y **todo se prueba en hardware** (un iPhone con notch y uno con home indicator) | **Pendiente de hardware** (KAN-62 no pudo: sin iPad): un iPad horizontal, en Safari y con la app instalada en la pantalla de inicio (los insets reales de la barra de estado y del indicador de inicio no se ejercieron). Tampoco consta una prueba específica de las safe areas en un iPhone con notch y con home indicator. Juan David o qa; la nav y el botón "+" (FE-15, KAN-69: la barra inferior usa `max(12px, env(safe-area-inset-bottom))` abajo y `max(0.75rem, inset)` a los lados, y el toast la sigue, pero **no se probó en hardware**) y el sheet, en sus tareas |
| Foco por defecto: la base usa `outline-ring` sólido (3:1 mínimo; con `/50` quedaba en ~2,15:1 en claro); un test lo comprueba. Los componentes que cambien el foco deben mantener 3:1 | Hecho (KAN-34): todos los controles usan `components/ui/focus.ts` (outline sólido, con test) |
| Blur de `card-surface` (20 px, elegido en KAN-33 porque D13/D14 no lo fijan) | Se mantiene en 20 px; **sin confirmar en un dispositivo real** (KAN-62: la prueba en Safari 16.4-17 quedó NO VERIFICABLE y la decisión, sin respuesta). El lienzo usa `blur(18px) saturate(150%)`; el código, `blur(20px)` sin saturación. Juan David lo confirma viendo el Inicio de staging o el catálogo en un iPhone o un Android reales: no depende de la versión de iOS |
| Duración del toast con "Deshacer" (Sonner usa 4000 ms por defecto; valorar más tiempo) | Hecho (KAN-34): 6000 ms (D8) |
| Revisión humana del catálogo: dirección visual, 360/375/393/430 px, claro y oscuro, panel "Auditoría", foco con Tab, en un iPhone y un Android reales | **Parcial (KAN-62):** en Chrome de escritorio, a ojo, en varios anchos y en claro y oscuro (panel "Auditoría", foco con Tab, menú con teclado); falta en iPhone y Android reales (dirección visual, 375 / 393 / 430 px). Juan David o qa (KAN-34) |
| Revisar los motivos marcados con † (motivos redactados en FE-06) | Hecho (KAN-62): revisados los 19 motivos; 18 quedan como estaban y pierden la †; el de D4 sobre Radix se reescribe como "Base UI es el default de shadcn (verificado en KAN-33)", también sin †. Ningún motivo conserva la marca |
| Identidad Kanza (KAN-40) a ojo y en hardware: el favicon legible a 16 px en pestaña clara y oscura (Chrome, Safari y Firefox), el login a 360 / 375 / 393 / 430 px en claro y oscuro (fila de marca, grillo sobre la tarjeta sin tapar el título, sin desbordes), el contraste del nombre cerca del blob y la carga de Bricolage sin salto visible | **Parcial (KAN-62).** Favicon legible a 16 px en pestaña clara y oscura: visto a ojo, sin medir, en Chrome de escritorio; no consta otro navegador. **Sigue pendiente:** la carga de Bricolage sin salto visible (no ejecutado, por decisión del humano: requiere throttling de DevTools), el login a 360 / 375 / 393 / 430 px en claro y oscuro, el grillo sobre la tarjeta sin tapar el título, el contraste del nombre cerca del blob y el favicon en Firefox y Safari. Juan David o qa |
| `proxy.ts` (KAN-27) debe excluir los estáticos de marca de la redirección a `/login` (D16) | Hecho (KAN-27): el `matcher` los excluye (raíz de `public/` y `public/brand/`, por extensión); `proxy.test.ts` recorre `public/`. Comprobado con `curl` sobre `next start` |
| "Atrás" tras cerrar sesión (KAN-27; desde KAN-41 el flujo es Home → avatar → "Cerrar sesión"): con Home → "Cerrar sesión" → atrás no debe verse ningún dato, en iPhone Safari y en Android Chrome, también con varias pantallas privadas en el historial (cuando existan). La capa del bfcache (`BfcacheGuard` y `data-session-ended`) y la carga completa solo se prueban en el navegador. En local el origen es solo `localhost`: hace falta staging para un dispositivo real | **Parcial.** Verificado en staging (KAN-30, 17/10/2026) en un Pixel 10 (Chrome), un iPhone 17 Pro (Safari, también con el gesto de "atrás" de Safari) y Chrome de escritorio: tras "Cerrar sesión" desde el menú del avatar, "atrás" no muestra datos del usuario. **Sigue pendiente:** con varias pantallas privadas en el historial (QA-06, KAN-85) y el E2E de Playwright "login → logout → atrás" cuando se instale. Juan David o qa |
| Login (KAN-26) en hardware: popup de Google en Safari iOS (que el primer toque abra la ventana, sin `auth/popup-blocked`: el SDK se calienta al montar la pantalla, ver `CLAUDE.md` > Sesión) y en un Android real (con el emulador no se puede: escucha solo en `127.0.0.1`; hace falta el proyecto de staging), 360 / 375 / 393 / 430 px en claro y oscuro, y el teclado abierto en el formulario | **Parcial.** Popup de Google verificado en staging (KAN-30, 17/10/2026): abrió al primer toque, sin `auth/popup-blocked`, en un Pixel 10 (Chrome) y un iPhone 17 Pro (Safari). **Sigue pendiente:** 360 / 375 / 393 / 430 px en claro y oscuro y el teclado abierto en el formulario. Juan David o qa |
| Cookie de sesión en un navegador real (`Set-Cookie` de `POST /api/auth/session` a través del rewrite y de vuelta en `browserApi`): curl lo confirmó en KAN-26; el navegador (`/catalog` > "Probar GET /me") quedaba por hacer | Hecho (KAN-30, 17/10/2026), en un navegador real contra staging: `__Host-session` con HttpOnly, Secure, SameSite Lax, Path `/` y unos 14 días; `POST` y `DELETE /api/auth/session` responden 204; `GET /api/spaces` desde la barra del navegador viaja con la cookie por el rewrite. **Matiz:** "Probar GET /me" del catálogo no se ejecutó (no existe en staging), así que `browserApi` leyendo con la cookie en el cliente no se probó como tal; el equivalente fue ese `GET /api/spaces` por el mismo rewrite |
| `AppShell` responsive (D17): barra lateral desde 1024 px, menú del avatar con "Cerrar sesión", tokens de la barra lateral y posición del `Toaster` en escritorio | Hecho (KAN-41, alineado con el lienzo). Rehecho en FE-15 (KAN-69) según Escritorio v2: barra lateral de 240 px con nombres, espacio, acción principal, cuenta del usuario abajo, barra inferior bajo 1024 px y pantalla «Más». **Pendiente de Hito 1, cada cosa con su pantalla:** las secciones Movimientos y Cuentas, «Registrar» (FE-20; hoy el «+» y el botón de la barra lateral abren «Nueva cuenta», KAN-70), Categorías (con ella aparecen «Más» y la fila de la barra lateral), el buscador del encabezado; Pendientes en Hito 2; Ayuda y Ajustes en Hito 3. **Sugerencia para FE-18 (Movimientos):** ocultar la barra inferior mientras el teclado está abierto. El layout usa `interactiveWidget: "resizes-content"`, así que en Android la barra (`fixed`) subiría sobre el teclado cuando se escriba en el buscador de Movimientos; los formularios de cuenta evitan el problema con `hideBottomNav`, pero el buscador convive con la lista y la barra |
| Panel "Auditoría" del catálogo en 768 / 1024 / 1280 / 1440 px (hoy mide los anchos de celular) | Hecho (KAN-41): el panel mide en cualquier ancho y suma barra lateral, ancho del contenido y scroll horizontal. FE-15 (KAN-69) suma la barra inferior (`data-slot="bottom-nav"`) y separa en una lista aparte los controles de 34 a 43 px, que solo valen desde 1024 px con `pointer: fine` y si son secundarios (hoy «Menú de la cuenta», 36 px); la vista previa de la barra lateral del catálogo queda fuera del panel a propósito. **Visto a ojo (KAN-62), sin medir:** revisado a ojo en varios anchos de la checklist (360 a 1440 px), en claro y oscuro; el humano no detalló cuáles y no hay lecturas registradas del panel. **Diferencia conocida:** a 768 px el contenido mide 608 px (el `max-w-160` de 640 px incluye el padding de 16 px por lado) y el lienzo 640 px; por código, no medida; registrada sin tarea por decisión del humano |
| `AppShell` responsive (KAN-41) a ojo y en hardware, **contra el lienzo** (escritorio claro y oscuro, tablet, celular): la barra flotante a 1024 / 1280 / 1440 px (tarjeta de 76 px con 16 px de aire, `#0E1A14` en claro y `#13241B` en oscuro, sin pegarse al borde), el grupo barra + contenido de hasta 1440 px centrado a 1920 px, el contenido de 640 px centrado a 768 px, el encabezado plano alineado con el contenido (`h1` de 24 / 26 / 30 px), el avatar de 44 px tile bajo 768 px y de 48 px verde suave desde 768 px con dos iniciales, sin scroll horizontal a 360 / 375 / 393 / 430 px, Tab por la barra (globo invertido y foco visibles en los dos temas), el menú del avatar con teclado (flechas, Escape) y con el dedo en un iPhone y un Android, "Cerrar sesión" desde el menú y "atrás" sin datos, las safe areas de la tarjeta y del grupo en un iPad apaisado (y que el título y el contenido compartan el borde derecho con inset, también en un celular apaisado), y el `Toaster` abajo a la derecha a 1280 px | **Parcial.** Verificado a ojo contra el lienzo (KAN-62), sin medir, en Chrome de escritorio, en varios anchos y en claro y oscuro (el humano no detalló anchos ni tema por paso): barra lateral, grupo centrado, `Toaster` abajo a la derecha, Tab por la barra y menú del avatar con teclado. El lienzo no tiene artboard de referencia para 768 px oscuro ni para 1024 px. En staging (KAN-30, 17/10/2026), en un Pixel 10 (Chrome) y un iPhone 17 Pro (Safari): el menú del avatar con el dedo, "Cerrar sesión" desde el menú, "atrás" sin datos y el Inicio frente al lienzo en claro y oscuro. Esos teléfonos miden unos 400 px CSS de ancho (a confirmar), así que **el Inicio no se verificó a 360 px exactos**: el paso en DevTools no se ejecutó (requería sesión en staging y Cloud SQL no se encendió). **Diferencia conocida:** a 768 px el contenido mide 608 px (el `max-w-160` de 640 px incluye el padding de 16 px por lado) y el lienzo 640 px; por código, no medida; registrada sin tarea por decisión del humano. **Sigue pendiente:** las safe areas de la tarjeta y del grupo en un iPad horizontal (sin iPad), que el título y el contenido compartan el borde derecho con inset en un celular apaisado, y 375 / 393 / 430 px a ojo contra el lienzo en un celular real. Juan David o qa |
| Menú de la cuenta y modo `modal` de Base UI (bloquea el scroll de la página al abrir): confirmar que en escritorio no hay salto de layout por la barra de scroll | Hecho (KAN-30, 17/10/2026): verificado en Chrome de escritorio a 1280 px, sin salto de layout al abrir el menú |
| Primer uso (KAN-70) a ojo contra el lienzo (`K-V2-PrimerUso`, `K-V2-Moneda` y `K-V2-NuevaCuenta` a 1280 y 1440 px; `K-H1-PrimerUso`, `K-H1-Moneda` y `K-H1-CuentaForm` a 360 px; claro y oscuro): las dos tarjetas lado a lado desde 1024 px y una bajo la otra antes; el grillo; «Cambiar» abre el diálogo o la hoja; el panel «Nueva cuenta» con el foco en el nombre, Escape y el velo; el formulario de página sin barra inferior y con el teclado abierto (en un celular real); «Volver»; el subtítulo con la fecha desde 1024 px | Secciones «Inicio sin cuentas y moneda del espacio», «Inicio con cuentas» y «Formulario de cuenta» de `/catalog` (un servidor de mentira responde lo que elijas, para ver cada estado sin sesión), y el flujo real en staging con el emulador: lo revisa el humano. No hay navegador en el entorno del agente: lo verificado por el código son los tests de comportamiento, de clases y de contraste, y `next dev` + `curl` del catálogo para el límite servidor/cliente |
| Base del primer uso (KAN-91) a ojo contra el lienzo (`K-V2-*` a 1280 y 1440 px, `K-H1-*` a 360 px, claro y oscuro): el panel de 440 px a 12 px de los bordes con su cabecera, cuerpo con scroll y pie; la hoja inferior con grabber y «Cancelar»; el diálogo de 480 px; el campo de dinero con "$", "US$", "R$" y "€"; el segmentado y el selector; la tarjeta `tile` al cruzar 1024 px; el grillo de 120 y 140 px. Con Tab y Escape en cada uno, y el teclado decimal en un móvil | Sección «Panel lateral, hoja inferior y diálogo» y las vecinas de `/catalog`, con el panel «Auditoría»: lo revisa el humano. No hay navegador en el entorno del agente: lo verificado por el código son los tests de comportamiento (rol, nombre, foco, Escape, inerte), de clases (440 px, 12 px, `glass-strong`) y de contraste (`tokens.test.ts`) |
| Escritorio v2 (2026-10-21) a ojo contra el lienzo: barra de 240 px de una pantalla de alto a 1024 / 1280 / 1440 px, tarjetas sólidas, panel lateral (foco atrapado, Escape, velo), diálogos, tablas sin scroll horizontal a 1280 px, claro y oscuro | Cada sub-tarea de frontend del Hito 1 con su pantalla; QA-04 a QA-07. **FE-15 (KAN-69):** la barra lateral y la inferior, a ojo contra `K-V2-*` y `K-H1-*` (360, 375, ~393, ~430, 768, 1024, 1280 y 1440 px, claro y oscuro), con el panel «Auditoría» y la vista previa del catálogo: lo revisa el humano; no hay navegador en el entorno del agente, así que lo verificado por el código son los tests de lógica, de contraste y de clases |

Dependencias instaladas en KAN-33 (`tailwindcss`, `@tailwindcss/postcss`, `tw-animate-css` y `shadcn` van en devDependencies: solo se usan en el build, `tw-animate-css` y `shadcn` como `@import` de CSS): `tailwindcss`, `@tailwindcss/postcss`, `tw-animate-css`, `shadcn`, `class-variance-authority`, `clsx`, `tailwind-merge`, `@base-ui/react`, `@phosphor-icons/react`, `sonner`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react` y `@testing-library/dom`. Dependencia añadida en KAN-26: `firebase` (SDK modular; el código usa solo `firebase/app` y `firebase/auth`, en `lib/firebase.ts`). `npm audit` marca `@grpc/grpc-js` (de `@firebase/firestore`, solo servidor/Node): no entra en el bundle del navegador porque no se importa Firestore. No se instalan: `@playwright/test` (ver arriba), `@testing-library/jest-dom` y `user-event` (cuando un test los necesite), `vite-tsconfig-paths` (Vite 8 resuelve los alias con `resolve.tsconfigPaths`), `recharts` (con el primer gráfico real), `next-themes` ni Zustand (v1).
