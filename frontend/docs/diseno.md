# Diseño y librerías (frontend)

Estado: **aprobado por Juan David el 2026-10-05** · Tarea KAN-32 [FE-06] (historia KAN-31, HU-6 Sistema de diseño base) · Lo implementan KAN-33 (setup) y KAN-34 (catálogo de componentes).
Dirección visual "Menta": mockup de referencia en https://claude.ai/artifact/WdpLUxb8M6VgXupjqezr5M (nombre de la app: sin definir).

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
| Fuentes | Montserrat (números, títulos) + Karla (texto) | [D6](#d6-fuentes) |
| Formularios | react-hook-form + zod | [D7](#d7-formularios) |
| Toasts con "Deshacer" | Sonner (vía shadcn) | [D8](#d8-toasts-con-deshacer) |
| Gráficos (dashboard v1) | Diferidos: barras CSS; shadcn Charts con el primer gráfico real | [D9](#d9-gráficos) |
| Tests | vitest + Testing Library; E2E Playwright iPhone (WebKit) y Pixel (Chromium, 360 px) | [D10](#d10-tests) |
| Dinero y fechas | Locale por moneda del espacio; `exponent` decimales; zona horaria del espacio | [D11](#d11-formato-de-dinero-y-fechas) |
| Modo oscuro | Sí en v1, siguiendo el sistema con CSS | [D12](#d12-modo-oscuro) |
| Dirección visual | "Menta" (verde/blanco/negro + oscuro, bento + glass) | [D13](#d13-dirección-visual-menta) |
| Tokens | Nombres shadcn + `income` / `expense` / `debt` | [D14](#d14-tokens) |
| Viewport y móvil | 360 px mínimo; matriz 375 / ~393 / ~430 | [D15](#d15-viewport-y-móvil) |

## 1. Checklist para una pantalla nueva

Sigue los pasos en orden. Entre paréntesis, la decisión que lo respalda.

1. **Contrato.** Confirma que los endpoints y campos existen en `../backend/openapi.json` y que `src/lib/api/schema.d.ts` está generado. Si falta algo, la tarea queda **bloqueada** hasta que backend lo exponga; no lo inventes. (`CLAUDE.md`)
2. **Datos.** Prefetch en el Server Component con `getServerApi()` + `HydrationBoundary`; en el cliente `useQuery` / `useInfiniteQuery` sobre funciones de `lib/core`. Tras mutar, invalida las queries afectadas. (D1, D2)
3. **Estados de pantalla.** Carga, vacío (invita a actuar) y error (qué pasó + qué hacer + datos a salvo). (D13 › Tono)
4. **Layout.** Diseña a 360 px y revisa 375, ~393 y ~430 antes de ampliar. Safe areas, `dvh`/`svh` (nunca `100vh`), inputs ≥16 px. (D15)
5. **Componentes.** Busca en `components/ui` y en el catálogo (KAN-34). Si falta, añádelo con la CLI de shadcn (Base UI); no lo escribas desde cero. (D4)
6. **Tokens.** Solo clases de token (`bg-background`, `text-muted-foreground`, `text-income`…). Nada de hex ni `rgb()` sueltos. Dinero: `income` / `expense` / `debt`. Glass solo en cromo flotante y tiles. (D14, D13 › Glass)
7. **Tipografía.** Montserrat para números y títulos, Karla para texto; montos con `tabular-nums`. Usa la escala de D13. (D6, D13)
8. **Iconos.** Phosphor: regular 20–22 px, fill solo en el tab activo, duotone en iconos de categoría. En Server Components importa de `@phosphor-icons/react/ssr`. (D5)
9. **Dinero y fechas.** Solo con los formateadores de `lib/core`: locale derivado de la moneda del espacio, exactamente `exponent` decimales, zona horaria del espacio. Sin aritmética con floats. (D11)
10. **Textos.** Español, tú, sentence case, verbos. Valores del backend (`expense`, `pending`…) solo a través del mapa único de traducciones. (D13 › Tono, `CLAUDE.md`)
11. **Formularios.** react-hook-form + esquema zod de `lib/core` + `useMutation`; los 422 se mapean a campos; `inputmode="decimal"` en montos; campos 48 px, botón primario 52 px. (D7)
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
| Botón, campo, selector, tarjeta, hoja inferior, nav, lista, skeleton, estado vacío | Componente de `components/ui` (se añaden en KAN-34) | D4 |
| Tile bento, nav flotante, sheet, header sticky | Tokens `glass` / `glass-strong` | D13, D14 |
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
- Core **no importa** `next/*`, `react-dom` ni `server-only`. Se impone con ESLint `no-restricted-imports` (KAN-33).
- Core puede hacer `import type` de `@/lib/api/schema`; no importa `server.ts` ni `browser.ts`.
- Estructura propuesta (KAN-33 la confirma): `src/lib/core/{money,dates,i18n,tokens}.ts`, `src/lib/core/schemas/`, `src/lib/core/data/`.
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
- **Cambia una convención actual de `CLAUDE.md`** (ver sección 4); se actualiza en KAN-33.

### D3. Estilos

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Tailwind CSS v4 | **Elegida**: es lo que trae shadcn y los tokens quedan como variables CSS |
| CSS Modules | Alternativa evaluada |

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
| shadcn/ui con primitivas **Base UI**, código copiado al repo | **Elegida** (Base UI es el default de shadcn desde julio 2026) |
| shadcn/ui con primitivas Radix | Descartada: Base UI es el default actual de shadcn † |
| Radix o Base UI solos, sin shadcn | Descartada: habría que escribir y mantener a mano el estilo y los estados de cada componente † |
| Componentes propios desde cero | Descartada: reimplementar accesibilidad (foco, teclado, ARIA) en cada componente † |
| HeroUI v3 | Descartada: dependencia npm y riesgo de reescritura v2 a v3 |

**Elección:** shadcn/ui con Base UI, código copiado a `components/ui`.
**Motivo:** el código es nuestro (sin dependencia de librería de UI); accesibilidad de las primitivas; los tokens usan nombres shadcn más `income` / `expense` / `debt`, de modo que una futura librería nativa (React Native Reusables o HeroUI Native) pueda mapearlos. La librería nativa se decide al empezar el nativo.

**Reglas de uso**
- Se añaden con la CLI de shadcn y se ajustan a Menta (tokens, radios, tamaños táctiles). Si falta un componente, no lo escribas desde cero.
- Cada componente del catálogo (KAN-34) se prueba a 360 px en sus estados: normal, foco, presionado, deshabilitado, error y carga, en claro y oscuro.
- Iconos de shadcn: `iconLibrary: "phosphor"` en `components.json` (ver D5).

**Verificar en KAN-33:** que `shadcn init` ofrezca Base UI como primitiva por defecto y `phosphor` como `iconLibrary`, y el nombre exacto del paquete de Base UI.

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
- En Server Components importa de `@phosphor-icons/react/ssr`. Habrá una regla ESLint (el mecanismo se decide en KAN-33).
- Importa icono por icono, nunca el barrel completo (`bundle-barrel-imports` de la skill `vercel-react-best-practices`).
- Iconos decorativos con `aria-hidden`; un botón solo con icono lleva `aria-label` en español.

**Verificar en KAN-33:** añadir `@phosphor-icons/react` a `optimizePackageImports` en `next.config.ts` (no está en la lista por defecto de Next 16).

### D6. Fuentes

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Montserrat (600/700) + Karla (400–700) | **Elegida** (dirección visual Menta) |
| Fuente del sistema | Descartada: sin identidad propia y los numerales cambian entre iOS y Android † |
| Una sola familia para todo | Descartada: la dirección visual separa números y títulos del texto corrido † |

**Elección:** Montserrat 600/700 para números y títulos; Karla 400–700 para texto.
**Motivo:** identidad "Menta"; Montserrat da legibilidad y presencia a los montos; ambas con `tnum`, así que los montos se alinean en columnas.

**Reglas de uso**
- Carga con `next/font/google` (autoalojada en el build, subset `latin`, que cubre el español).
- Montos y cifras comparables con `tabular-nums` (`font-variant-numeric`).
- Escala tipográfica en D13.

**Verificar en KAN-34:** que el archivo de fuente que sirve `next/font` conserva `tnum` en Montserrat y en Karla (una columna de montos en el catálogo lo demuestra).

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
- Los tipos de las peticiones y respuestas siguen siendo los generados: un esquema zod valida el formulario, no sustituye al tipo del API.

**Verificar en KAN-33:** compatibilidad de `@hookform/resolvers` con zod 4 (el proyecto ya usa `zod` ^4.6.5).

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
- Posición por encima de la nav inferior y de la safe area (`offset` / `mobileOffset`).
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
| Playwright con un solo navegador | Descartada: todos los navegadores iOS son WebKit, así que se prueban los dos motores |

**Elección:** vitest + Testing Library para lógica y componentes; Playwright para E2E en dos proyectos: **"iPhone"** (WebKit) y **"Pixel"** (Chromium, con **viewport de 360 px de ancho**).
**Motivo:** cubre los dos motores móviles; el ancho de 360 px es el mínimo que garantizamos.

**Reglas de uso**
- Tests de lógica junto al archivo (`*.test.ts` o `*.test.tsx`), solo para lógica no trivial: formateo de dinero y fechas, traducciones, esquemas y utilidades. Tests de componentes solo para lógica no trivial.
- E2E en `e2e/`, 3–5 flujos reales; los escribe qa.
- Los tests de formato de dinero comparan con el espacio **NBSP** (U+00A0) entre símbolo y cifra y con el signo menos **U+2212** (ver D11).
- WebKit de Playwright aproxima Safari iOS, no lo reemplaza: la prueba en dispositivo real sigue siendo obligatoria (skill `mobile-native`).

### D11. Formato de dinero y fechas

**Opciones evaluadas**

| Opción | Veredicto |
|---|---|
| Locale derivado de la moneda del espacio, con mapa fijo en core | **Elegida** |
| Locale del dispositivo | Descartada: el mismo monto se vería distinto según el teléfono, y hay desajuste servidor y cliente (hydration mismatch) |
| Decimales por excepción de moneda | Descartada: se usa una regla genérica: mostrar `exponent` decimales (opción A) |

**Elección y reglas**
- **Mapa fijo en core:** UYU → es-UY, COP → es-CO, USD → es-UY; **fallback es-UY**. Una moneda desconocida muestra su código. Nunca el locale del dispositivo.
- **Decimales (opción A):** la fuente de verdad es el exponente ISO 4217. Se muestran **siempre exactamente `exponent` decimales** (`minimumFractionDigits` y `maximumFractionDigits` explícitos, iguales). Lo mostrado es lo guardado. El input acepta como máximo `exponent` decimales. El frontend no tiene tabla propia de monedas: el backend expone el exponente con la moneda del espacio (KAN-36 [BE-09]).
- Los montos llegan como enteros en la unidad menor (10^exponent). Para mostrarlos se convierten a **texto decimal con operaciones sobre enteros o cadenas** (nunca `/ 100` ni floats) y esa cadena se pasa a `Intl.NumberFormat`, que formatea cadenas decimales de forma exacta.
- **Signo:** el gasto va con el signo menos tipográfico **"−" (U+2212)**, generado con `formatToParts` (reemplazando la parte `minusSign`, que `Intl` emite como "-" ASCII). El ingreso va con "+". Entre símbolo y cifra `Intl` pone NBSP (U+00A0).
- **Fechas** siempre con la **zona horaria del espacio** (`spaces.timezone`); el servidor corre en UTC. Los instantes (`timestamptz`) se convierten a esa zona. La fecha de una transacción es un `date` local sin hora: se formatea tal cual, sin aplicar zona horaria (así no se corre un día).
- Hallazgos de `Intl` (verificados en Node 24): es-UY muestra COP como "COP" y es-CO muestra UYU como "UYU"; `Intl` formatea COP con 0 decimales (redondea) si no se le pasan los decimales explícitos.

Ejemplos (unidad menor → texto):

| Moneda | Locale | Unidad menor | Texto |
|---|---|---|---|
| UYU (exp. 2) | es-UY | `155050` | `$ 1.550,50` |
| COP (exp. 2) | es-CO | `123450` | `$ 1.234,50` |
| USD (exp. 2) | es-UY | `123450` | `US$ 1.234,50` |
| CLP (exp. 0, fuera del mapa) | es-UY | `1500` | `CLP 1.500` |
| UYU, gasto | es-UY | `-155050` | `−$ 1.550,50` |

**Motivo:** el mismo número se ve igual para todos los miembros de un espacio, lo mostrado coincide con lo guardado y no hay hydration mismatch.

**Pendiente de backend:** el API aún no expone `timezone`, `currency` ni `exponent` del espacio (KAN-36 [BE-09] los incluirá). Hasta entonces, el formateo con datos reales está bloqueado.

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
- El CSS que genera `shadcn init` usa la clase `.dark`; KAN-33 lo adapta al enfoque `prefers-color-scheme`.
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
| Label de la nav | fuente por fijar en KAN-34 contra el mockup | 11 · 600/700 (excepción al mínimo de 13) |
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
- Nunca por fila de lista (un grupo glass por día); nunca en popovers, menús ni texto largo.
- Fallback a `card-solid` con `@supports not (backdrop-filter)` y con `prefers-reduced-transparency: reduce`. El soporte de esa media query es desigual: no dependas solo de ella.
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

Se definen como variables CSS (`:root` y su versión oscura) y se exponen con `@theme inline`; los nombres de las variables de radios y blobs los fija KAN-33.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `background` | `#E9F4EE` | `#08110D` | Fondo de la app |
| `foreground` | `#0E1A14` | `#EAF5EF` | Texto principal |
| `card` (glass) | `rgba(255,255,255,0.62)` | `rgba(28,44,36,0.55)` | Tiles bento y grupos sobre el fondo decorativo |
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
| `input` | `rgba(14,26,20,0.48)` | `rgba(255,255,255,0.34)` | **Borde de los controles** (campos, selectores) |
| `ring` | `#146E4D` | `#6EDDAA` | Foco visible |
| `income` | = `primary` | = `primary` | Ingresos, con "+" (token separado) |
| `expense` | = `foreground` | = `foreground` | Gastos, con "−" |
| `debt` | `#96560A` | `#F0B45A` | Deuda de tarjetas |
| `glass` | `rgba(255,255,255,0.58)` | `rgba(20,32,26,0.60)` | Nav, toasts; desenfoque 24 px |
| `glass-strong` | `rgba(255,255,255,0.74)` | `rgba(16,28,22,0.82)` | Sheets; desenfoque 28 px |
| `glass-border` | `rgba(255,255,255,0.9)` | `rgba(255,255,255,0.10)` | Borde de superficies glass |
| blobs decorativos | `#9FE0BF`, `#CDEFD9` | `#1E6B4C`, `#12432F` | Fondo decorativo (máximo 2 por pantalla) |
| `chart-1..5` | por definir | por definir | Se definen con el primer gráfico real |

**Reglas de uso**
- **Controles:** el borde de campos y selectores usa `--input` (≥3:1), no `--border`. `--border` queda para separadores y tarjetas y nunca es el único indicador de un estado o de un control.
- **Dinero:** `income` con "+", `expense` con "−" y color `foreground`, `debt` en ámbar. El signo informa, no solo el color. `destructive` nunca marca un gasto.
- **Glass:** solo donde D13 › Glass lo permite; el resto usa `card-solid`, `popover` o `card`.
- **Campos sobre glass:** pon los campos sobre `card-solid`, `popover` o la hoja (`glass-strong`). En oscuro, `--input` sobre `card` con un blob detrás queda en 2,61:1 (ver abajo): evita ese caso.
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
| Peor caso de texto sobre glass con blob | 4,88 (`debt`) | 4,81 (`muted-foreground`) |
| `ring` / `background` (no texto, ≥3) | 5,54 | 11,48 |
| `input` sobre `background` (no texto, ≥3) | 3,13 | 3,07 |
| `input` sobre `card-solid` / `popover` | 3,18 / 3,21 | 3,11 / 3,11 |
| `input` sobre `glass-strong` con blob | 3,13 | 3,01 |
| `input` sobre `card` con blob | 3,09 | **2,61** |
| `border` sobre `background` (decorativo) | 1,23 | 1,28 |

Todos los pares de texto superan 4,5:1. El único no-texto que no llega a 3:1 es `input` sobre `card` con un blob detrás en oscuro (2,61:1); con alfa 0,40 llegaría a 3:1. Se resuelve con la regla "Campos sobre glass" o subiendo ese alfa; KAN-34 lo confirma en el catálogo.

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
- **Safe areas:** `viewport-fit=cover` y `env(safe-area-inset-*)` para el botón "+" fijo, la nav inferior, los toasts y las hojas.
- **Alto:** `dvh` o `svh`, nunca `100vh`.
- **Teclado:** `interactive-widget=resizes-content` (en Next, `viewport.interactiveWidget`). iOS ignora esa propiedad y superpone el teclado; Chrome Android ≥108 también lo superpone por defecto. Prueba el formulario en la hoja inferior (bottom sheet) en un dispositivo real, en iOS y en Android.
- **Inputs ≥16 px** (evita el zoom de iOS). Nunca `user-scalable=no` ni `maximum-scale=1`.
- **Táctil:** `-webkit-tap-highlight-color: transparent` con un `:active` propio en cada elemento pulsable; hover solo bajo `@media (hover: hover)`; `touch-action: manipulation` en botones y enlaces.
- **Overscroll:** `overscroll-behavior: none` en `html` y `body`; `contain` en contenedores internos con scroll.
- **Export `viewport` de Next**, con `viewportFit: "cover"`, `interactiveWidget: "resizes-content"`, `colorScheme: "light dark"` y `themeColor` por esquema (D12).
- Emulación de Chrome no reproduce nada de esto: cada cambio de este bloque se confirma en hardware real.

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

Convenciones de `frontend/CLAUDE.md` que este documento cambia (**no se modificaron en FE-06**; las actualiza KAN-33 en la misma tarea):

| Dónde (`frontend/CLAUDE.md`) | Cambio |
|---|---|
| Cabecera (stack) | Añadir Tailwind v4, shadcn/ui + Base UI, TanStack Query, react-hook-form, vitest |
| Comandos › Tests de lógica y E2E | `npm test` pasa a vitest + Testing Library; Playwright en dos proyectos (iPhone y Pixel a 360 px) |
| Estructura | `lib/money.ts` e `lib/i18n.ts` pasan a `lib/core/`; `components/` se divide en `components/ui` y el resto; añadir `lib/core/`, el provider de TanStack Query y la regla ESLint de core |
| Convenciones › API | "`browserApi.GET` desde handlers o efectos" pasa a `queryFn` / `mutationFn` de TanStack Query sobre funciones de core; el servidor hace prefetch con `getServerApi()` |
| Convenciones › Server vs. client | Añadir el patrón prefetch + `HydrationBoundary` |
| Convenciones › Dinero y Textos | Rutas en `lib/core`; locale por moneda del espacio; exactamente `exponent` decimales |
| Convenciones › Estilo de código | Convenciones de Tailwind y de tokens |
| Tests | Añadir tests de componentes (`*.test.tsx`) |

Tabla de pendientes por tarea:

| Pendiente | Lo resuelve |
|---|---|
| Actualizar `frontend/CLAUDE.md` (tabla anterior) | KAN-33 |
| ESLint: `no-restricted-imports` para core (fusionándolo con la regla actual de `process`: en flat config un bloque posterior reemplaza las opciones de la regla) | KAN-33 |
| ESLint o convención para importar Phosphor de `/ssr` en Server Components (ESLint no distingue Server de Client Component: ¿prohibir el import raíz y usar siempre `/ssr`?) | KAN-33 |
| Verificaciones al correr `shadcn init`: Base UI por defecto, `iconLibrary: "phosphor"`, nombre del paquete de Base UI, compatibilidad `@hookform/resolvers` + zod 4 | KAN-33 |
| `optimizePackageImports` para `@phosphor-icons/react` en `next.config.ts` | KAN-33 |
| Export `viewport`: `viewportFit: "cover"`, `interactiveWidget: "resizes-content"`, `themeColor` por esquema | KAN-33 |
| Adaptar el CSS de shadcn (clase `.dark`) a `prefers-color-scheme` y definir las variables de tokens, radios y blobs | KAN-33 |
| Playwright: proyecto "Pixel" con viewport de 360 px de ancho | KAN-33 |
| Convención de errores tipados para el `queryFn` (openapi-fetch devuelve `{ data, error }`, TanStack Query espera que lance) y dónde viven las query keys / `queryOptions` (añadido en FE-06) | KAN-33 |
| Comprobar en `typecheck` que lo que infiere un esquema zod de request es asignable al tipo generado del API (propuesta de FE-06) | KAN-33 |
| `tnum` de Montserrat y Karla con el archivo que sirve `next/font` | KAN-34 |
| Contraste AA en claro y oscuro en el catálogo, incluido `--input` sobre cada superficie (oscuro sobre `card` con blob: 2,61:1) | KAN-34 |
| `popover-foreground` asumido igual a `foreground` | KAN-34 |
| Excepción del label de la nav de 11 px y su fuente | KAN-34 |
| Duración del toast con "Deshacer" (Sonner usa 4000 ms por defecto; valorar más tiempo) (añadido en FE-06) | KAN-34 |
| Backend expone `timezone`, `currency` y `exponent` del espacio; hasta entonces el formateo de dinero y fechas con datos reales está bloqueado | KAN-36 [BE-09] |
| Revisar los motivos marcados con † (motivos redactados en FE-06) | Juan David, en el repaso |

Dependencias previstas (las instala KAN-33; nombres a confirmar al instalar): `tailwindcss` y `@tailwindcss/postcss`, `class-variance-authority`, `clsx`, `tailwind-merge`, Base UI, `@phosphor-icons/react`, `sonner`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `vitest`, Testing Library, `@playwright/test`. `recharts` solo con el primer gráfico real. Sin `next-themes` ni Zustand en v1.
