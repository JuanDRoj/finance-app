# Revisión visual pendiente del Hito 0 (KAN-62, QA-03)

Checklist manual para cerrar los pendientes **de ojo y de hardware** de `frontend/docs/diseno.md` §4 que la prueba de aceptación del Hito 0 (KAN-30, `docs/qa/hito-0-aceptacion-staging.md`) no cubrió. Pertenece a la historia KAN-49 (HU-7, deuda del Hito 0). Lo ejecuta el humano; los resultados se anotan en este mismo archivo (sin correos, contraseñas ni tokens) y las capturas se adjuntan al ticket KAN-62 en Jira.

- Staging: `https://kanza-stg.vercel.app` (alias fijo del Production de Vercel; ver `infra/RECURSOS.md`).
- Catálogo de componentes: `http://localhost:3000/catalog`. **Solo existe con `npm run dev`**: no está en el build ni en staging (`frontend/docs/diseno.md` D4).
- Lienzo de diseño de Kanza (no está en el repo): `https://claude.ai/artifact/QhYwACgCTYJHpApRSWLgRa` (el enlace está en `frontend/docs/diseno.md`, línea 5). Artboards que se usan aquí: "Inicio con aviso del grillo" (360 px), "Inicio en tablet (768 px)" (**solo claro**: no hay artboard oscuro de tablet), "Inicio en escritorio (claro)" e "Inicio en escritorio (oscuro)" (1440 px). **No hay artboard de 1024 px.** Si el lienzo y Jira se contradicen, manda el lienzo.
- Fecha de la prueba: no consta · Quién la ejecuta: Juan David (humano)
- Enlace a las capturas y al comentario de resultados en Jira (KAN-62): no consta (la Parte 2 se revisó a ojo, sin capturas registradas)

Cada comando que toca la nube (GCP, Firebase, Vercel) se ejecuta con permiso explícito del humano, de uno en uno. Nada de esto se hace contra producción.

## 0. Cómo usar esta checklist

### 0.1 Resultados posibles (obligatorio usar uno por paso)

| Resultado | Cuándo | Qué hay que anotar |
|---|---|---|
| `OK` | Se hizo el paso y se cumple lo esperado. | En la columna Nota: dispositivo o navegador y, si hubo una medición, su valor. |
| `OK (a ojo)` | El humano revisó el paso visualmente contra el artboard del lienzo y lo dio por bueno, **sin medir** (sin snippets de consola ni lecturas del panel). Los valores de la columna "OK es" quedan como referencia para revisiones futuras. | Nada más; si hubo una diferencia conocida, se anota en la columna Nota. |
| `FALLA` | Se hizo el paso y no se cumple. | Un bug en el formato del proyecto (sección 0.3). Una FALLA no bloquea el PR de KAN-62: queda registrada en `diseno.md` §4 con la referencia al bug. |
| `NO VERIFICABLE` | No se pudo hacer el paso. | **El motivo es obligatorio** (por ejemplo: "sin un dispositivo con iOS 16.4-17", "el navegador no implementa la media query", "el catálogo no cargó desde el celular"). Un paso NO VERIFICABLE deja su fila de §4 abierta. |

### 0.2 Orden recomendado y tiempos

Total estimado: 2,5 a 3,5 horas con todo el hardware; menos si faltan dispositivos.

1. Parte 1, preparación (15 a 30 min).
2. **Parte 2 (escritorio, sin hardware, 70 a 90 min)**: hazla primero, no necesita dispositivos. Solo el paso A13 (Inicio a 360 px) necesita Cloud SQL encendida; déjalo para el final de la parte para encenderla una sola vez.
3. Parte 3 (hardware, 45 a 90 min según los dispositivos que tengas). Con el inventario confirmado (1.1) queda registrada como `NO VERIFICABLE`.
4. Parte 4 (los motivos con †, 15 min). Ya respondida.
5. Al final, apagar Cloud SQL si la encendiste (sección 1.5).

### 0.3 Formato de bug del proyecto

Cada FALLA se redacta así (la redacta qa a partir de lo que reportes; tú solo necesitas dar el paso, el valor medido y el dispositivo):

```
BUG: <título corto>
Dónde: <ruta o pantalla, paso Xn de docs/qa/hito-0-revision-visual.md, dispositivo + versión + navegador + ancho + tema>
Pasos para reproducir: 1. … 2. … 3. …
Esperado: <la columna "OK es" del paso o el artboard del lienzo>
Obtenido: <lo observado, con el número medido o el texto de la consola>
Severidad: Bloqueante | Alta | Media | Baja
Test que lo demuestra: manual: paso Xn
```

Rúbrica de severidad para esta checklist (visual):

| Severidad | Criterio |
|---|---|
| Bloqueante | Impide usar la app en un dispositivo del piso de navegadores (Safari 16.4+, Chrome 111+, 360 px). |
| Alta | Algo principal queda ilegible o roto en ese piso (por ejemplo, el texto de una tarjeta no se lee sobre el vidrio). |
| Media | Diferencia visible contra el lienzo, o el fallback de vidrio falla pero todo se lee. |
| Baja | Detalle cosmético, diferencia de pocos píxeles contra el lienzo, o decisión de diseño (por ejemplo, Karla sin cifras tabulares). |

### 0.4 Cómo me devuelves los resultados

Pásale al agente principal una lista corta, un renglón por paso, con el id del paso: `A1 OK`, `A2 FALLA: 1111 mide 10,2 y 8888 mide 11,4`, `B1 NO VERIFICABLE: el iPhone tiene iOS 26`. qa los transcribe a las tablas de este archivo, redacta los bugs y rellena la sección 7.

### 0.5 No capturar secretos

Las capturas de Network o DevTools muestran solo la lista de nombres y estados, nunca cabeceras `Cookie` o `Set-Cookie` ni el payload de `POST /api/auth/session`. No escribas en este archivo correos ni contraseñas de las cuentas de prueba (el repo es público).

## 1. Preparación

### 1.1 Inventario de dispositivos

Rellénalo antes de empezar. Cada paso de la Parte 3 dice qué dispositivo usa; si no lo tienes, el paso es `NO VERIFICABLE` con ese motivo (no se usan servicios de dispositivos remotos).

| Id | Para qué | Requisito | Modelo y versión (rellenar) | ¿Lo tengo? |
|---|---|---|---|---|
| D1 | B1 (vidrio en Safari 16.4-17) | iPhone o iPad con **iOS 16.4 a 17.x** (Ajustes, General, Información, "Versión de iOS"). Con iOS 18 o más no sirve: ya trae `backdrop-filter` sin prefijo y no ejercita el caso `-webkit-`. | Ninguno: el iPhone 17 Pro trae un iOS muy posterior. | No |
| D2 | B4 (Android de gama baja) | Android con 3 GB de RAM o menos, o Android Go; el más lento que tengas. Anotar modelo, versión de Android, RAM y versión de Chrome. | Ninguno: el Pixel 10 no es de gama baja. | No |
| D3 | B5 (iPad horizontal) | iPad con Safari y ancho de 1024 px o más en horizontal (todos los iPad de 10,2" o más). | Ninguno. | No |
| D4 | A1 a A13, E1 a E3 | Computador con Chrome (DevTools). Firefox y Safari de macOS son opcionales (solo favicon). | Chrome de escritorio (versión no registrada). | Sí |
| D5 | B3 (opcional) | Cualquier celular o iPad con el ajuste del sistema "Reducir transparencia". | Pixel 10 (Chrome) e iPhone 17 Pro (Safari); versiones no registradas. | Sí, pero B3 no se ejecutó |

Inventario confirmado por el humano: solo tiene un Android Pixel 10 (Chrome), un iPhone 17 Pro (Safari) y el Chrome de escritorio. Sin iPad, sin un dispositivo con iOS 16.4-17 y sin un Android de gama baja. Las versiones de Android, iOS y Chrome no están registradas. Por eso B1, B4, B5a y B5b son `NO VERIFICABLE` (sección 3).

### 1.2 Herramientas comunes

- **Fijar un ancho exacto:** DevTools de Chrome, Ctrl+Shift+M (barra de dispositivos), modo "Responsive", escribe el ancho. Tipo de dispositivo "Desktop" para 1024 px o más (hover real, necesario para los globos) y "Mobile" para el resto. Evita redimensionar la ventana: la barra de scroll clásica (unos 15 px) cambia los números.
- **Cambiar claro y oscuro:** DevTools, menú de tres puntos, More tools, Rendering, "Emulate CSS media feature prefers-color-scheme" (light / dark). En hardware, el ajuste de apariencia del sistema.
- **Consola de DevTools:** los fragmentos de la sección 1.6 se pegan ahí. Son de solo lectura.
- **Indicador de Next:** en `next dev` aparece un círculo de Next.js en una esquina; es del modo desarrollo, ignóralo.
- **Fuera de alcance de Hito 1 (no es FALLA):** la barra de navegación inferior, el botón "+", el espacio ("Mi espacio") en el encabezado, el buscador, las secciones Movimientos, Pendientes y Cuentas, y Ayuda y Ajustes en la barra lateral aún no existen. Tampoco el contenido de Inicio del lienzo (tarjeta Neto, etc.): se compara solo el **marco** (encabezado, barra lateral, avatar, anchos y márgenes).

### 1.3 Catálogo local (P2)

Desde `/frontend`:

| Paso | Comando o acción | Resultado esperado | Resultado |
|---|---|---|---|
| P2 | `npm run dev` (si falta `.env.local`: `cp .env.example .env.local`; si faltan dependencias: `npm ci`). Abrir `http://localhost:3000/catalog`. | Carga la página "Catálogo" con la barra lateral a partir de 1024 px. No hace falta backend. | Implícito: los pasos del catálogo (Parte 2) se revisaron, así que el catálogo cargó. No se registró por separado. |

### 1.4 Abrir el catálogo desde el celular o el iPad (P3, opcional: máximo 15 minutos)

Sirve para ver el catálogo en hardware (en especial el toast con texto desenfocado detrás). Si no funciona en 15 minutos, **abandónalo**: B1, B4 y B5 se hacen en staging (sección 1.5) y los pasos que solo existen en el catálogo quedan `NO VERIFICABLE` con el motivo "el catálogo no cargó desde el dispositivo".

- **Android, con USB y depuración USB activada:** `adb reverse tcp:3000 tcp:3000` y abrir `http://localhost:3000/catalog` en Chrome del celular. `localhost` es un origen permitido por Next en desarrollo.
- **iPhone o iPad:** `npm run dev -- -H 0.0.0.0` y abrir `http://<IP-de-tu-PC-en-la-red>:3000/catalog`. Según el código de Next 16.3.8 (`block-cross-site-dev.js`), solo bloquea las peticiones de otros sitios y los WebSockets de otros orígenes: la página debería cargar y a lo sumo fallar la recarga en caliente (se ignora). No se probó desde un celular real; por eso el límite de 15 minutos.
- **Si el servidor corre en WSL2** (tu caso), la IP que imprime Next es la virtual de WSL, no la de tu red: hace falta reenviar el puerto desde Windows (`netsh interface portproxy` más una regla de firewall) o usar `networkingMode=mirrored` en `.wslconfig`.
- **Comprobación:** en el celular, pulsa "Medir esta página" (sección "Auditoría de esta página"); si el panel responde, el catálogo está hidratado y sirve.

| Paso | Resultado | Nota |
|---|---|---|
| P3 | no consta | No se registró si se intentó abrir el catálogo desde un celular. Con el inventario de 1.1 no hacía falta: B1, B4 y B5 quedaron NO VERIFICABLE por falta de dispositivos. |

### 1.5 Staging con sesión (P4, solo si vas a hacer A13, B1, B4 o B5)

Cloud SQL (`finance-db-stg`) está apagada por defecto y sin ella no hay login. **Solo la enciendes si vas a hacer A13 o tienes el hardware a mano** (con el inventario actual, B1, B4 y B5 no se pueden hacer; A13 sí, en Chrome de escritorio). Cada comando, con tu permiso:

| Paso | Comando | Resultado esperado | Resultado |
|---|---|---|---|
| P4a | `bash infra/scripts/sql_power.sh start` | Instancia `RUNNABLE`. Puede tardar unos minutos. | no consta |
| P4b | Abrir `https://kanza-stg.vercel.app/` en el dispositivo e iniciar sesión con **una cuenta de email de staging que ya tengas** (la de regresión de KAN-61; sus datos los guardas tú fuera del repo). No crear cuentas nuevas. | Llegas al Inicio ("Hola, {nombre}, tu espacio es Mi espacio"). | no consta |
| P4z | Al terminar todas las pruebas: `bash infra/scripts/sql_power.sh stop` | Instancia apagada (`STOPPED` / `NEVER`). Si se olvida, genera costo. | no consta. Si Cloud SQL se encendió para esta revisión, confirmar que quedó apagada. |

**Truco para ver un toast en staging sin catálogo:** con la sesión iniciada y el Inicio cargado, activa el modo avión, abre el avatar ("Menú de la cuenta") y elige "Cerrar sesión": aparece el toast "No pudimos cerrar tu sesión". Desactiva el modo avión después. Si olvidaste el modo avión y el cierre funcionó, vuelves a `/login`: inicia sesión otra vez.

### 1.6 Fragmentos de consola (solo lectura)

**S1. Ancho de "1111" y "8888"** (pegar en `/catalog`):

```js
const ancho = (p, s) => { const t = p.firstChild; const i = t.textContent.indexOf(s); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + s.length); return r.getBoundingClientRect().width; };
document.querySelectorAll("p").forEach((p) => { if (p.textContent.includes("1111 / 8888")) console.log(p.textContent, "| 1111 =", ancho(p, "1111"), "| 8888 =", ancho(p, "8888")); });
```

**S2. Distancia de la coma decimal al borde derecho en la lista de montos** (pegar en `/catalog`):

```js
document.querySelectorAll("ul.tabular-nums li").forEach((li) => { const t = li.firstChild; const i = t.textContent.lastIndexOf(","); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1); console.log(li.textContent, "| coma a", (li.getBoundingClientRect().right - r.getBoundingClientRect().left).toFixed(2), "px del borde derecho"); });
```

**S3. Superficies de vidrio y su fallback** (pegar en `/catalog` o en el Inicio de staging):

```js
console.table([...document.querySelectorAll(".card-surface")].map((e) => ({ empieza: e.textContent.trim().slice(0, 18), fondo: getComputedStyle(e).backgroundColor, blur: getComputedStyle(e).backdropFilter })));
```

**S4. Medidas del marco `AppShell`** (pegar en `/catalog`; x e y son relativas a la ventana):

```js
const caja = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), ancho: Math.round(b.width), alto: Math.round(b.height) }; };
const barra = document.querySelector('nav[aria-label="Principal"]')?.parentElement;
console.table({ barra: caja(barra), contenido: caja(document.querySelector("main")), titulo: caja(document.querySelector("h1")), avatar: caja(document.querySelector('[aria-label="Menú de la cuenta"]')) });
console.log("tamaño del h1:", getComputedStyle(document.querySelector("h1")).fontSize, "| fondo de la barra:", barra && getComputedStyle(barra).backgroundColor, "| fondo de la página:", getComputedStyle(document.body).backgroundColor);
```

**S5. Posición del toast** (con un toast visible):

```js
const t = document.querySelector("[data-sonner-toaster]"); console.log(t.dataset.xPosition, t.dataset.yPosition);
```

## 2. Parte 2: escritorio, sin hardware (Chrome + DevTools, catálogo local)

**Decisión del humano sobre esta parte:** no quiere medir valores exactos ("como está en el artboard está bien"; si más adelante ve algo que no le guste, lo reportará). Eligió "Ya la miré a ojo: OK" para la Parte 2. Por eso A1 a A13 y E1 a E3 se registran como **`OK (a ojo)`**: revisión visual del humano contra el artboard, sin snippets de consola ni mediciones. Los snippets (1.6), los valores de la columna "OK es" y las tablas de esperados quedan como **referencia para revisiones futuras**, no como lecturas hechas. No se capturó ningún valor medido.

Todo en `http://localhost:3000/catalog`, salvo A10, A11 y A12, que usan `https://kanza-stg.vercel.app/login` (la página de login es pública y no necesita Cloud SQL), y A13, que usa el Inicio de `https://kanza-stg.vercel.app/` con sesión (necesita Cloud SQL encendida, sección 1.5).

### 2.1 Cifras tabulares (tnum) de Montserrat y Karla

Referencia: `diseno.md` D6 y fila "`tnum` de Montserrat y Karla". Ir a la sección **"Cifras (tnum)"** del catálogo. Hacerlo a 360 px, tema claro.

| N.º | Acción | OK es | Captura | Resultado | Nota |
|---|---|---|---|---|---|
| A1 | **Montserrat.** (1) En Elements, selecciona el párrafo "1111 / 8888 (Montserrat)"; en Computed, al final, mira **Rendered Fonts**. (2) Pega S1 y S2 en la consola. | (1) Rendered Fonts lista una fuente con nombre `montserrat` (con o sin prefijo) y origen **Network resource**. Si lista **Arial / Local file** o "montserrat Fallback", la fuente no cargó: el paso no vale (Arial también tiene cifras tabulares y daría un OK falso). (2) S1: el ancho de "1111" y el de "8888" son iguales (±0,01 px). S2: la distancia de la coma al borde es la misma en las 5 filas de montos (`$ 1.550,50`, `$ 12.345,67`, `$ 0,09`, `$ 1.000.000,00`, `$ 8.888,88`). **Diagnóstico si los anchos difieren:** en Computed, `font-variant-numeric` debe ser `tabular-nums`; si lo es y aun así difieren, el woff2 servido perdió la característica `tnum`: FALLA. | Párrafo y salida de la consola. | OK (a ojo) | Sin snippets ni mediciones. |
| A2 | **Karla.** Igual con el párrafo "1111 / 8888 (Karla)". | Igual que A1 para la línea de Karla (S1; Rendered Fonts con `karla`). Si Karla no trae `tnum`, se reporta como bug **Baja** y se marca "decisión de diseño" (D6: cifras en texto corrido), no como error de código. | Salida de la consola. | OK (a ojo) | Sin snippets ni mediciones. |

### 2.2 Panel "Auditoría" en los 8 anchos

Referencia: `diseno.md` D4 (Catálogo) y fila "Panel Auditoría del catálogo en 768 / 1024 / 1280 / 1440 px". Para cada ancho: fija el ancho en DevTools (modo Responsive, ver 1.2), baja hasta la sección **"Auditoría de esta página"**, pulsa **"Medir esta página"** y lee el resultado. Claro en los 8 anchos; **oscuro solo en 360 y 1440** (la geometría no depende del tema).

Esperados de "Contenido" (la columna de contenido, `main`). Del lienzo: celular, gutters de 16 px; tablet (K-Tablet), `max-width: 640px; margin: 0 auto` y **sin padding lateral**, o sea 640 px de contenido con 64 px de aire a cada lado a 768 px; escritorio (K-Escritorio-rail), grupo de hasta 1440 px con padding 16 px arriba y a la izquierda y 24 px a la derecha y abajo, barra de 76 px y 24 px de separación, o sea ancho menos 140 px.

| N.º | Ancho | Barra lateral | Contenido esperado | Claro | Oscuro |
|---|---|---|---|---|---|
| A3-1 | 360 | oculta | 328 px | OK (a ojo) | OK (a ojo) |
| A3-2 | 375 | oculta | 343 px | OK (a ojo) | no se pide |
| A3-3 | 393 | oculta | 361 px | OK (a ojo) | no se pide |
| A3-4 | 430 | oculta | 398 px | OK (a ojo) | no se pide |
| A3-5 | 768 | oculta | **640 px (lienzo)** | OK (a ojo). Diferencia conocida por código (608 px vs 640 px del lienzo), no medida; registrada sin tarea por decisión del humano. | no se pide |
| A3-6 | 1024 | visible | 884 px | OK (a ojo) | no se pide |
| A3-7 | 1280 | visible | 1140 px | OK (a ojo) | no se pide |
| A3-8 | 1440 | visible | 1300 px | OK (a ojo) | OK (a ojo) |

En cada fila además: **Scroll horizontal "no"**, y las tres listas ("Controles menores de 44 px", "Elementos que se salen de la pantalla", "Botones y enlaces con el texto recortado") en **0**. Si aparece algo, anota la línea textual del panel: un control real menor de 44 px, un desborde o un texto recortado es FALLA.

**Diferencia conocida en A3-5 y A4 (768 px):** qa calculó del código que `main` mide **608 px**, no 640: `AppShell` fija `max-w-160` (640 px) en el mismo elemento que lleva el padding de 16 px por lado, y con `box-sizing: border-box` el contenido queda en 608 px. El lienzo dice 640 px de contenido. Se había previsto como FALLA de severidad Baja si el panel leía 608; el humano decidió **anotarla en `diseno.md` §4, sin tarea**. Es una diferencia conocida por código, **no medida**, y **no es un bug abierto**. Lo mismo vale para cualquier ancho entre 672 y 1023 px (el contenido llega a 608 px; el lienzo solo tiene artboard de 768 px). Los demás esperados salen del código y coinciden con el lienzo (360 px: gutters de 16 px; escritorio: ancho menos 140 px).

Lecturas del panel: no se midieron ni se registraron (decisión del humano). La tabla de lecturas se omite a propósito.

### 2.3 `AppShell` contra el lienzo a 768, 1024 y 1440 px, y el grupo centrado a 1920 px

Referencia: `diseno.md` D17 y fila "`AppShell` responsive (KAN-41) a ojo y en hardware". Abre el artboard correspondiente del lienzo al lado y compara **solo el marco** (ver 1.2). Para cada ancho, hazlo en claro y en oscuro. Para tener números, pega S4. En el catálogo el título es "Catálogo" y el avatar muestra las iniciales "AM" (en el lienzo "JD"): es lo esperado.

Valores que el humano debe encontrar (todos del lienzo, confirmados contra `diseno.md` D17):

- Claro: fondo de la página `#E9F4EE` (rgb 233, 244, 238), barra `#0E1A14` (rgb 14, 26, 20). Oscuro: fondo `#08110D` (rgb 8, 17, 13), barra `#13241B` (rgb 19, 36, 27).
- La barra: tarjeta de **76 px** de ancho, radio **28 px**, a **16 px** del borde izquierdo y del superior, logo de 44 px, ícono de Inicio de 48 px; solo trae Inicio en Hito 0 (el lienzo muestra más secciones, el "+" y Ayuda y Ajustes: son de Hito 1). Alto de la barra: ventana menos 40 px.
- El globo "Inicio" aparece a **12 px** a la derecha del ícono con el mouse o con Tab, **invertido** respecto a la página (oscuro `#0E1A14` sobre página clara; claro `#EAF5EF` sobre página oscura), texto de 13 px en negrita.
- El avatar: 48 px, círculo `secondary` desde 768 px (`#CBEBDC` claro / `#173B2C` oscuro), iniciales de 15 px; 44 px estilo tile bajo 768 px.

| N.º | Ancho | Qué comparar | OK es | Captura | Claro | Oscuro | Nota |
|---|---|---|---|---|---|---|---|
| A4 | 768 (artboard "Inicio en tablet (768 px)", solo claro) | Sin barra lateral. Columna de contenido **640 px** centrada (64 px de aire por lado). `h1` de **26 px** (Montserrat 700, -0,02em). Avatar de 48 px verde suave. Aire arriba del encabezado: **24 px**; del encabezado al contenido: **18 px**. Sin scroll horizontal. | Coincide con el artboard. Si el contenido mide 608 px y no 640: diferencia conocida (ver A3-5), registrada sin tarea. Oscuro: no hay artboard; compara la estructura con el claro y los colores con la tabla de arriba, y anótalo "sin artboard de referencia". | Pantalla completa a 768 px. | OK (a ojo) | OK (a ojo) | Diferencia conocida por código (608 px vs 640 px del lienzo), no medida; registrada sin tarea por decisión del humano. El oscuro no tiene artboard de referencia. |
| A5 | 1024 (el lienzo **no** tiene artboard de 1024 px) | Barra lateral flotante (x=16, y=16, 76 px, radio 28). Contenido en x=116 con **884 px**. `h1` de **30 px**. Avatar de 48 px. **24 px** entre la barra y el contenido. | La estructura es la del artboard de 1440 (mismas medidas de barra y encabezado, solo más estrecho). Sin scroll horizontal. | Pantalla completa a 1024 px. | OK (a ojo) | OK (a ojo) | Sin artboard de 1024 px: revisado contra la estructura del de 1440. |
| A6 | 1440 (artboards "Inicio en escritorio" claro y oscuro) | Barra en x=16; contenido en x=116 con **1300 px**, que termina a 24 px del borde derecho. `h1` de 30 px. Colores de barra y globo de la lista de arriba. | Coincide con los artboards. Nota del artboard: el encabezado del lienzo tiene 4 px de padding lateral y un margen extra de 40 px sobre el primer bloque (por el grillo asomado de Inicio, que es de Hito 1); si ves 4 px de diferencia en el borde del título o del avatar, anótala como observación, no como FALLA. | Pantalla completa a 1440 px, con el globo "Inicio" abierto. | OK (a ojo) | OK (a ojo) | |
| A7 | **1920** | Con 1920 px de ancho (DevTools "Desktop"), el grupo barra + contenido mide como máximo 1440 px y queda **centrado**: barra en x=256, contenido en x=356 con 1300 px, que termina en x=1656. | Unos 240 px de aire a cada lado; nada estirado hasta los bordes; la barra no queda pegada al borde izquierdo. Con el panel Auditoría: Contenido 1300 px. | Pantalla completa a 1920 px. | OK (a ojo) | opcional, no consta | |

### 2.4 `Toaster` abajo a la derecha a 1280 px

Referencia: `diseno.md` D8 y D17. Ancho 1280 px, tipo "Desktop". Sección **"Avisos con Deshacer"** del catálogo.

| N.º | Acción | OK es | Captura | Claro | Oscuro | Nota |
|---|---|---|---|---|---|---|
| A8 | (1) Pulsa "Eliminar «Café»". (2) Pega S5. (3) Pulsa "Deshacer" en el toast. (4) Pulsa "Toast de error". (5) Cambia el ancho a 1023 px y pulsa "Eliminar «Café»" otra vez. | (1) Un toast "Eliminaste «Café»" con el botón "Deshacer" (44 px de alto), **abajo a la derecha**, a unos 24 px del borde derecho y del inferior, sin tocar la barra lateral (que está a la izquierda); desaparece solo a los 6 s. (2) S5 imprime `right bottom`. (3) Aparece "Restauraste «Café»". (4) El toast de error se apila junto al anterior. (5) A 1023 px el toast sale **abajo y centrado**, con 16 px de margen lateral. | Un toast abierto a 1280 px. | OK (a ojo) | OK (a ojo) | |

### 2.5 `prefers-reduced-transparency: reduce` (emulado en Chrome)

Referencia: `diseno.md` D13 > Glass. Ancho 360 px (el avatar de menos de 768 px es una superficie de vidrio), en `/catalog`. La media query es de soporte desigual en los navegadores; **primero se comprueba que el navegador la entiende**.

| N.º | Acción | OK es | Captura | Claro | Oscuro | Nota |
|---|---|---|---|---|---|---|
| A9 | (1) DevTools, Rendering, "Emulate CSS media feature prefers-reduced-transparency" = `reduce` (si tu versión de Chrome no lo ofrece, usa el ajuste del sistema: Windows, Accesibilidad, Efectos visuales, Efectos de transparencia desactivados; macOS, Accesibilidad, Pantalla, Reducir transparencia). (2) En la consola: `matchMedia("(prefers-reduced-transparency: reduce)").matches`. (3) Pega S3. (4) Pulsa "Eliminar «Café»" y mira el toast. (5) Quita la emulación y vuelve a pegar S3. | (2) Debe dar `true`; si da `false`, el navegador no lo implementa o no se activó: el paso es **NO VERIFICABLE** con ese motivo. (3) Con `reduce`: las filas "Neto del mes" y "Una categoría…" tienen fondo **sólido** (`rgb(247, 251, 249)` en claro; `rgb(20, 32, 25)` en oscuro) y `blur` = `none`; el avatar a 360 px también. (4) El toast es sólido y legible, sin ver nada a través. (5) Sin la emulación vuelven `blur(20px)` y el fondo translúcido (`rgba(255, 255, 255, 0.62)` en claro; `rgba(28, 44, 36, 0.55)` en oscuro). | Tabla de S3 con `reduce` y sin él. | OK (a ojo) | OK (a ojo) | No consta que se haya comprobado por consola que el navegador entendiera la media query (`matchMedia`); se registra como lo dio el humano. |

### 2.6 Favicon a 16 px y carga de Bricolage

Referencia: `diseno.md` D16 y fila "Identidad Kanza (KAN-40) a ojo y en hardware" (solo favicon y Bricolage; el resto de esa fila no se cubre aquí, ver sección 7.3). Usa `https://kanza-stg.vercel.app/login`.

| N.º | Acción | OK es | Captura | Resultado | Nota |
|---|---|---|---|---|---|
| A10 | **Favicon, pestaña clara.** Chrome con tema/modo claro y zoom del navegador y escala de pantalla al 100 % (con 125 % o 150 %, anótalo: Chrome usa otro tamaño). Mira el ícono de la pestaña. Si ves uno viejo o en blanco: Ctrl+Shift+R, o abre `/favicon.svg` en otra pestaña. | A 16 px se reconoce el grillo con la moneda (cabeza verde menta con ojos oscuros y antenas sobre baldosa verde bosque); no es una mancha; la baldosa se distingue del fondo de la pestaña. Firefox y Safari de macOS: "si lo tienes"; si no, `NO VERIFICABLE: sin ese navegador`. | Recorte de la pestaña, ampliado. | OK (a ojo) | Navegadores: no consta más que Chrome de escritorio (inventario 1.1). |
| A11 | **Favicon, pestaña oscura.** Igual, con el navegador o el sistema en oscuro. | Igual que A10: se reconoce y se distingue del fondo oscuro de la pestaña. | Recorte de la pestaña, ampliado. | OK (a ojo) | |
| A12 | **Bricolage sin salto.** DevTools, Network: "Disable cache" y throttling "Slow 4G"; Rendering: "Layout Shift Regions" activado. Recarga `/login` varias veces mirando la palabra "Kanza" junto al ícono. | Al cargar la fuente la palabra "Kanza" cambia de forma pero **no hay un destello azul de desplazamiento de diseño** sobre el ícono, el formulario ni el grillo; el texto nunca desaparece (se ve con la fuente de reserva y luego cambia). En Network el woff2 de Bricolage (~21,7 kB) aparece entre las primeras peticiones. | Pantalla durante la carga, con Network visible. | OK (a ojo) | Sin "Layout Shift Regions" ni lectura de Network registradas. |

### 2.7 Inicio a 360 px exactos contra el lienzo (criterio 2 de KAN-62)

Referencia: `diseno.md` D15 (360 px es el mínimo que se garantiza) y D17. KAN-30 comparó el Inicio con el lienzo en un Pixel 10 y un iPhone 17 Pro, que miden unos 400 px de ancho CSS (a confirmar), no 360. Este paso cubre el **360 px exacto** con DevTools, para poder escribir en §4 "Inicio contra el lienzo a 360 px" al pie de la letra. Necesita Cloud SQL encendida y una sesión en staging (P4a y P4b, desde Chrome de escritorio; al terminar, P4z). Si no la enciendes, A13 es `NO VERIFICABLE: sin sesión en staging`.

Abre `https://kanza-stg.vercel.app/` con sesión, DevTools (Ctrl+Shift+M), modo "Responsive", tipo "Mobile", **360 × 780** (el alto del artboard "Inicio con aviso del grillo"). Compara con ese artboard **solo el marco** (ver 1.2): el título "Inicio" ocupa el lugar de "Mi espacio" y no hay barra inferior, "+", "Neto" ni Pendientes (Hito 1: no son FALLA). Pega S4 para tener números (no hay barra lateral: `barra` sale `null`).

| N.º | Acción | OK es | Captura | Claro | Oscuro | Nota |
|---|---|---|---|---|---|---|
| A13 | Con 360 px de ancho, mira el Inicio completo en tema claro y luego en oscuro (Rendering, "Emulate prefers-color-scheme"). Pega S4. | Coincide con el artboard "Inicio con aviso del grillo" en el marco: **gutters de 16 px** (contenido en x=16 con **328 px**); encabezado con **18 px** de aire arriba y 12 px debajo; avatar de **44 × 44 px** estilo tile de vidrio, con las iniciales de tu usuario de 14 px, pegado al gutter derecho (borde a 16 px de la ventana, x=300); tarjeta del saludo de vidrio con radio de **28 px** a 16 px de cada borde; los dos círculos difusos de fondo (arriba a la derecha y a la izquierda, más abajo); **sin scroll horizontal**. Colores: fondo `#E9F4EE` (claro) y `#08110D` (oscuro). | Una captura por tema, a 360 px. | OK (a ojo) | OK (a ojo) | Sin medir (no se registró S4). |

### 2.8 Extras de escritorio (E1 a E3)

No están en la descripción de Jira; se incluyeron a propósito porque cuestan ~10 minutos y se hacen en la misma sesión. Cierran partes de las filas "`AppShell` responsive … a ojo y en hardware" y "Contraste AA … Falta verlo en pantalla" de §4. Ancho 1280, tipo "Desktop", en `/catalog`.

| N.º | Acción | OK es | Captura | Claro | Oscuro | Nota |
|---|---|---|---|---|---|---|
| E1 | **Tab por la barra lateral.** Pulsa Tab una vez desde el inicio de la página. | El foco cae en el ícono de Inicio de la barra: anillo de foco menta visible y el globo "Inicio" aparece (invertido respecto a la página); Escape lo cierra. | Barra con foco y globo. | OK (a ojo) | OK (a ojo) | |
| E2 | **Menú del avatar con teclado.** Con Tab llega al botón "Menú de la cuenta"; Enter abre; flechas arriba y abajo mueven; Escape cierra. **No pulses "Cerrar sesión"** en el catálogo. | El menú abre con nombre y correo (largos: se parten en varias líneas sin salir de la pantalla) y "Cerrar sesión"; las flechas mueven el resaltado con anillo de foco; Escape cierra y devuelve el foco al avatar. No hay salto de diseño al abrir. | Menú abierto. | OK (a ojo) | OK (a ojo) | |
| E3 | **Contraste a ojo.** Recorre el catálogo entero. | Todo el texto se lee sin esfuerzo: texto secundario sobre tarjetas de vidrio, placeholders, mensajes de error de los campos, el monto de deuda (ámbar), bordes de los campos y anillos de foco, en ambos temas. | Dos capturas: una por tema. | OK (a ojo) | OK (a ojo) | |

## 3. Parte 3: hardware

**Antes de cada paso, revisa el inventario (1.1):** sin el dispositivo, el paso es `NO VERIFICABLE` con ese motivo. Todos los pasos de esta parte con sesión usan staging (sección 1.5, Cloud SQL encendida). El catálogo por red (1.4) solo se usa si P3 salió bien.

### 3.1 Vidrio en Safari 16.4-17 y Android de gama baja

Referencia: `diseno.md` D13 > Glass y la fila "Glass: … Pendiente de hardware". La regla `@supports not (...)` de `globals.css` existe para que en Safari 16.4-17 (que solo conoce `-webkit-backdrop-filter`) **se vea el vidrio**; el fallback sólido solo debe activarse sin soporte de ninguna de las dos formas o con `prefers-reduced-transparency: reduce`.

Qué mirar en el Inicio de staging (celular, menos de 768 px): la **tarjeta del saludo** ("Hola, {nombre}, tu espacio es …") y el **avatar** de 44 px, ambos de vidrio, sobre el círculo verde difuso (blob) de arriba a la derecha.

| N.º | Dispositivo | Acción | OK es | Captura | Claro | Oscuro | Nota |
|---|---|---|---|---|---|---|---|
| B1 | D1 (iOS 16.4 a 17.x, Safari) | (1) Confirma la versión de iOS. (2) En el Inicio de staging, mira la tarjeta del saludo y el avatar. (3) Haz scroll y abre el menú del avatar. (4) Si el catálogo cargó (P3), mira también las tarjetas "Tarjetas" y un toast sobre texto. | La tarjeta es **translúcida**: el verde del blob se transparenta, el tono cambia de un lado a otro de la tarjeta (más verde cerca del círculo de arriba a la derecha), con un borde claro fino. Una tarjeta de un solo tono liso `#F7FBF9` (claro) o `#142019` (oscuro) significa que el fallback sólido se activó: **FALLA**. El texto se lee nítido, sin parpadeos ni cuadros al hacer scroll. En el catálogo, el texto detrás del toast se ve desenfocado. **Decisión que se pide aquí (cierra la fila "Blur de `card-surface`"):** ¿el desenfoque de 20 px te convence? (El lienzo usa `blur(18px) saturate(150%)`; el código `blur(20px)` sin saturación.) Respuesta: sin respuesta (el paso no se pudo hacer) | Tarjeta del saludo y avatar, en cada tema. | **NO VERIFICABLE** | **NO VERIFICABLE** | Sin un dispositivo con iOS 16.4-17: el iPhone 17 Pro trae un iOS muy posterior (con iOS 18 o más Safari ya tiene `backdrop-filter` sin prefijo y no ejercita el caso `-webkit-`). Fila de §4 abierta; la decisión del blur de 20 px queda pendiente. |
| B2 | D1 o cualquier celular (extra) | Con el truco del modo avión (1.5), provoca el toast "No pudimos cerrar tu sesión". | El toast es de vidrio (translúcido, con borde) y legible, y queda **por encima** del indicador de inicio (home indicator) del iPhone, sin tocarlo. | Toast abierto. | no ejecutado | no ejecutado | No ejecutado (extra opcional). |
| B3 | D5 (opcional) | Activa "Reducir transparencia" en el sistema (iOS: Ajustes, Accesibilidad, Pantalla y tamaño del texto, Reducir transparencia) y recarga el Inicio de staging. | La tarjeta del saludo y el avatar pasan a sólidos. **Si no cambia nada, es `NO VERIFICABLE` con el motivo "el navegador no expone la media query"**: el CSS ya se probó en A9; no es un fallo del proyecto. | Antes y después. | no ejecutado | no ejecutado | No ejecutado (extra opcional). |
| B4 | D2 (Android de gama baja, Chrome) | En el Inicio de staging y, si P3 funcionó, en el catálogo: haz scroll rápido, abre el menú del avatar, provoca un toast (truco del modo avión o botón del catálogo). Opcional: Opciones de desarrollador, "Perfil de representación de GPU" (según el fabricante), "En pantalla como barras". | Scroll sin tirones perceptibles con el vidrio activo; el menú y el toast aparecen sin retraso notable; el texto sobre vidrio se lee; sin cuadros negros ni parpadeos. Con el perfil de GPU, las barras quedan casi siempre bajo la línea verde de 16 ms. Sin el dispositivo: `NO VERIFICABLE`. La emulación de CPU 6x de DevTools sirve solo como indicio y **no cuenta como OK**. | Pantalla con el vidrio; foto de las barras del perfil si las usas. | **NO VERIFICABLE** | **NO VERIFICABLE** | Sin un Android de gama baja: el Pixel 10 no lo es. Fila de §4 abierta. |

Modelo, Android, RAM y Chrome del dispositivo usado en B4: ninguno (sin dispositivo de gama baja).

### 3.2 Safe areas en un iPad horizontal

Referencia: `diseno.md` D15 y D17 ("Las safe areas siguen aplicando en todos los anchos"). Dispositivo D3, iPad en **horizontal** (ancho de 1024 px o más: aparece la barra lateral), Inicio de staging. En Safari normal las safe areas casi no se ven; por eso hay una segunda parte instalada en la pantalla de inicio, que es la que ejerce los insets reales.

| N.º | Acción | OK es | Captura | Resultado | Nota |
|---|---|---|---|---|---|
| B5a | **Safari, horizontal.** Abre el Inicio de staging con sesión. | La barra lateral es una tarjeta oscura completa (no cortada abajo), con unos 16 px de aire arriba y a la izquierda; el encabezado y el contenido comparten el borde derecho; la página, que es corta, **no hace scroll vertical**. Tocar el ícono de Inicio no abre globo (en táctil no se abre, está aceptado en D17). | Pantalla completa en horizontal. | **NO VERIFICABLE** | Sin iPad. |
| B5b | **Instalada en la pantalla de inicio.** Compartir, "Añadir a pantalla de inicio"; abrirla desde el ícono, en horizontal (hay que iniciar sesión otra vez: la app instalada tiene su propio almacenamiento). | Nada queda bajo la barra de estado ni bajo el indicador de inicio: el título y el avatar no se solapan con la hora o la batería, la tarjeta de la barra termina por encima del indicador de abajo, el contenido no se corta en los bordes. Sin la parte B5b el resultado de este punto es **parcial**: anótalo. | Pantalla completa instalada, en horizontal. | **NO VERIFICABLE** | Sin iPad. Los insets reales (barra de estado e indicador de inicio) no se ejercieron. |

Modelo e iPadOS usados en B5: ninguno (sin iPad).

## 4. Parte 4: revisión de los motivos con † (`frontend/docs/diseno.md`)

El † marca un motivo que se redactó en FE-06 sin que la sesión de diseño lo dictara. Para cada uno, lee el motivo textual y responde **De acuerdo** o **Cambiar a: …** (con el motivo correcto). La columna "Evidencia en el repo" solo recoge lo que ya está comprobable en el código y no opina; "razonamiento" significa que no hay nada que verificar y decides tú. Resultado de cada fila: `De acuerdo` o `Cambiar a: …`.

| N.º | Línea | Decisión (opción descartada) | Motivo textual | Evidencia en el repo | Veredicto |
|---|---|---|---|---|---|
| C1 | 93 | D1: todo en `components/` y `lib/` sin frontera con Next | "la futura app nativa tendría que reescribir formatos, esquemas y llamadas a la API" | La frontera existe: `lib/core` con regla ESLint `no-restricted-imports` (KAN-33). El motivo es razonamiento. | De acuerdo |
| C2 | 116 | D2: SWR | "el proyecto estandariza una sola librería de datos y TanStack Query trae el patrón oficial de hidratación del App Router, `useInfiniteQuery` y `useMutation`" | TanStack Query en uso: `components/providers.tsx` (KAN-59), `useMutation` en el login. | De acuerdo |
| C3 | 117 | D2: `fetch` + `useEffect` / `useState` a mano | "obliga a reimplementar caché, refetch y estados de carga y error" | Convención vigente: `browserApi` solo dentro de `queryFn` / `mutationFn`. Razonamiento. | De acuerdo |
| C4 | 118 | D2: Server Actions + `revalidatePath` solos | "sin caché en el cliente, y no existen en la app nativa" | No hay ninguna Server Action (`"use server"`) en `src`. Razonamiento sobre el nativo. | De acuerdo |
| C5 | 141 | D3: CSS Modules | "los tokens como clases de Tailwind compartidas con shadcn evitan mantener un segundo sistema de estilos" | No hay ningún `*.module.css`; Tailwind v4 con tokens en `globals.css`. | De acuerdo |
| C6 | 160 | D4: shadcn con primitivas Radix | "Base UI es el default de shadcn (a verificar en KAN-33)" | **Ya verificado en KAN-33** (`diseno.md` línea 203: `shadcn init` ofrece Base UI como recomendada; `components.json` usa `base-nova`). | **Cambiar a:** "Base UI es el default de shadcn (verificado en KAN-33)" |
| C7 | 161 | D4: Radix o Base UI solos, sin shadcn | "habría que escribir y mantener a mano el estilo y los estados de cada componente" | Componentes de `components/ui` generados con la CLI de shadcn y ajustados a Menta (KAN-34, KAN-41). Razonamiento. | De acuerdo |
| C8 | 162 | D4: componentes propios desde cero | "reimplementar accesibilidad (foco, teclado, ARIA) en cada componente" | `DropdownMenu` y `Tooltip` de Base UI con sus tests de teclado (`user-menu.test.tsx`, `sidebar-nav.test.tsx`). | De acuerdo |
| C9 | 212 | D5: lucide-react | "un solo estilo de trazo, sin fill ni duotone que la dirección visual usa" | Phosphor en uso con `fill` (ícono activo de `sidebar-nav.tsx`) y `duotone` (`Empty` del catálogo); `lucide-react` no está en `package.json`. | De acuerdo |
| C10 | 232 | D6: fuente del sistema | "sin identidad propia y los numerales cambian entre iOS y Android" | Sin evidencia que verificar (nunca se comparó con las fuentes del sistema). | De acuerdo |
| C11 | 233 | D6: una sola familia para todo | "la dirección visual separa números y títulos del texto corrido" | Montserrat (números y títulos) y Karla (texto) en uso (`layout.tsx`). | De acuerdo |
| C12 | 253 | D7: `useActionState` nativo (Server Actions) | "las Server Actions no existen en la app nativa y los esquemas zod de core no se reutilizarían" | Los esquemas viven en `lib/core/schemas/` y el login usa `useMutation`. Razonamiento sobre el nativo. | De acuerdo |
| C13 | 276 | D8: toast de Base UI | "Sonner es el que integra shadcn y trae la acción y el gesto de cerrar listos" | Sonner en uso (`components/ui/sonner.tsx`, KAN-34) con la acción "Deshacer". | De acuerdo |
| C14 | 277 | D8: toast propio | "reimplementar cola, apilado y accesibilidad" | Razonamiento. | De acuerdo |
| C15 | 313 | D10: Jest | "más configuración para TypeScript y módulos ESM, sin ventaja para este proyecto" | vitest en uso (`vitest.config.mts`, `npm test`). | De acuerdo |
| C16 | 370 | D12: clase `.dark` activada por JavaScript | "depende de un script y puede parpadear al cargar" | Sin clase `.dark`: `globals.css` usa `@media (prefers-color-scheme: dark)`. | De acuerdo |
| C17 | 454 | D14: solo la paleta por defecto de Tailwind | "sin tokens semánticos no hay tema claro y oscuro ni mapeo a nativo" | Tokens semánticos en `globals.css` y `tokens.test.ts`. | De acuerdo |
| C18 | 455 | D14: herramienta de tokens externa (Style Dictionary) | "complejidad innecesaria con un solo cliente hoy" | `style-dictionary` no está en `package.json`. Razonamiento. | De acuerdo |
| C19 | 555 | D15: diseñar a 390 px y encoger | "360 px es el mínimo que garantizamos y los Android pequeños se romperían" | El panel Auditoría y las pantallas parten de 360 px. Razonamiento. | De acuerdo |

## 5. Cobertura

### 5.1 Puntos de la descripción de KAN-62 y sus pasos

| Punto de la descripción | Pasos |
|---|---|
| Glass en Safari 16.4-17 real | B1 (con B2) |
| `prefers-reduced-transparency: reduce` | A9 (con B3) |
| Un Android de gama baja | B4 |
| Cifras tabulares de Montserrat y de Karla (sección "Cifras") | A1, A2 |
| Favicon a 16 px en pestaña clara y oscura | A10, A11 |
| Carga de Bricolage sin salto visible | A12 |
| `AppShell` a 768, 1024 y 1440 px contra el lienzo, claro y oscuro | A4, A5, A6 |
| Inicio contra el lienzo a 360 px exactos, claro y oscuro (criterio 2) | A13 |
| Grupo centrado a 1920 px | A7 |
| Panel "Auditoría" en los 8 anchos | A3-1 a A3-8 |
| Safe areas en un iPad apaisado | B5a, B5b |
| `Toaster` abajo a la derecha a 1280 px | A8 |
| Motivos marcados con † | C1 a C19 |
| Extras (no están en Jira) | E1, E2, E3, B2, B3 (B2 y B3 no se ejecutaron) |

### 5.2 Criterios de aceptación

1. Cada punto queda OK, FALLA (con bug) o NO VERIFICABLE con motivo: las tablas de las partes 2 a 4 y la sección 0.1.
2. `frontend/docs/diseno.md` §4 actualizado con estos resultados y con lo verificado por KAN-30 (popup de Google y "atrás" en Android e iPhone, cookie en un navegador real, menú del avatar sin salto, Inicio contra el lienzo a 360 px): la sección 7 es la entrada para frontend-dev (que edita `diseno.md`); el "Inicio a 360 px" exacto lo cubre A13 en DevTools, porque los teléfonos de KAN-30 miden unos 400 px (7.1). qa revisa después, de solo lectura, que §4 refleje cada resultado.

## 6. Resultado global y bugs

| Parte | Resultado |
|---|---|
| Preparación | P2: implícita (el catálogo cargó). P3, P4a, P4b y P4z: no consta |
| Parte 2: escritorio (A1 a A13, E1 a E3) | **`OK (a ojo)`** en todos los pasos: revisión visual del humano contra el artboard, sin medir (ver el aviso al inicio de la sección 2) |
| Parte 3: hardware (B1 a B5) | **NO VERIFICABLE** en B1, B4, B5a y B5b (sin iOS 16.4-17, sin Android de gama baja, sin iPad); B2 y B3 no ejecutados (extras opcionales) |
| Parte 4: motivos † (C1 a C19) | **Hecha**: 18 "De acuerdo" y C6 "Cambiar a" |
| P4z: Cloud SQL apagada | no consta |

Bugs encontrados: **ninguno**. No hay ninguna FALLA. La diferencia de 608 px contra 640 px a 768 px (A3-5, A4) es una diferencia conocida por código, no medida: el humano decidió anotarla en `diseno.md` §4, sin tarea; no es un bug abierto.

Decisión pendiente: el blur de 20 px de `card-surface` (B1) no tiene respuesta del humano; queda abierta en §4.

## 7. Entrada para frontend-dev (actualizar `frontend/docs/diseno.md` §4)

Esta sección la rellena qa al registrar los resultados y es lo que lee frontend-dev. Las filas de §4 se identifican por el comienzo de su texto (los números de línea cambian con las ediciones).

### 7.1 Lo que KAN-30 ya verificó (comentario 10144 de Jira, 17/10/2026)

Ejecutado por el humano en: **Pixel 10 (Android, Chrome)**, **iPhone 17 Pro (Safari)** y **Chrome de escritorio a 1280 px**. La versión exacta de Android, iOS y Chrome no quedó registrada en el comentario. Capturas: no se adjuntaron (dispensado por el humano). Parte A del celular (A1 a A11) y parte B de escritorio (B1 a B7), todas `OK` en los dispositivos indicados.

| Pendiente de §4 que cierra | Paso de KAN-30 | Qué se verificó | Dónde |
|---|---|---|---|
| Login en hardware: popup de Google en Safari iOS y en Android real (solo el popup; el resto de esa fila sigue abierto, ver 7.3) y la frase "pendiente de hardware" de `frontend/CLAUDE.md` > Sesión > "Popup y Safari/iOS" | A9 (celular) | El popup de Google abrió **al primer toque**, sin `auth/popup-blocked`, y llegó al Inicio con el saludo. | Pixel 10 e iPhone 17 Pro |
| "Atrás" tras cerrar sesión (parte de celular; `BfcacheGuard` y `data-session-ended`) y la frase "pendiente de hardware" de `frontend/CLAUDE.md` > Sesión > "'Atrás' tras el logout, en capas" | A7 (celular) y B4 (escritorio) | Tras "Cerrar sesión" desde el menú del avatar, volver atrás no mostró datos del usuario; en iPhone se probó también el gesto de Safari. | Pixel 10, iPhone 17 Pro y Chrome de escritorio |
| Cookie de sesión en un navegador real | A3, A4b, A9, B5 y B6 | `__Host-session` con HttpOnly, Secure, SameSite Lax, Path `/` y unos 14 días; `POST` y `DELETE /api/auth/session` responden 204; `GET /api/spaces` desde la barra del navegador viaja con la cookie. **Matiz:** no se ejecutó "Probar GET /me" del catálogo (no existe en staging), así que `browserApi` leyendo con la cookie en el cliente no se probó como tal; el equivalente es `GET /api/spaces` por el mismo rewrite. | Chrome de escritorio (y celulares en A4b) |
| Menú de la cuenta y modo `modal` de Base UI: sin salto de layout por la barra de scroll en escritorio | B3 (escritorio) | Al abrir el menú del avatar no hubo salto de layout. | Chrome de escritorio a 1280 px |
| Parte de "`AppShell` responsive … a ojo y en hardware": el menú del avatar con el dedo en un iPhone y un Android, y "Cerrar sesión" desde el menú | A6 (celular) y B4 (escritorio) | Se tocó el avatar ("Menú de la cuenta"), se eligió "Cerrar sesión" y se volvió a `/login`. | Pixel 10, iPhone 17 Pro y Chrome de escritorio |
| Parte de celular de "`AppShell` responsive … contra el lienzo": Inicio frente al lienzo en claro y oscuro | A11 (celular) | El Inicio coincidió con el artboard "Inicio con aviso del grillo", en claro y oscuro. **Matiz:** los dos teléfonos miden unos 400 px de ancho CSS (a confirmar), no 360 px exactos: escribir "en Pixel 10 e iPhone 17 Pro", no "a 360 px". El 360 px exacto se verifica en A13 (DevTools). | Pixel 10 e iPhone 17 Pro |

### 7.2 Filas de §4 que esta checklist actualiza

Cada fila se identifica por el comienzo de su texto. **"Verificado a ojo"** quiere decir que el humano lo miró contra el artboard sin medir; **"medido"** quiere decir que hubo una lectura numérica. En esta revisión **no hay nada medido**: todo lo de la Parte 2 es a ojo. El texto propuesto es un borrador en el estilo de `diseno.md`; frontend-dev lo ajusta, pero sin convertir un "a ojo" en "medido".

| Fila de §4 (comienzo del texto) | Pasos | Estado | Texto propuesto para §4 |
|---|---|---|---|
| "Glass: CSS generado con ambas declaraciones y fallback" | B1, B4, A9, B3 | **Parcial.** A9 `OK (a ojo)`. B1 y B4 **NO VERIFICABLE** (sin dispositivos). B3 no ejecutado. | "Hecho sobre el CSS del build (KAN-33). `prefers-reduced-transparency: reduce` verificado a ojo en Chrome de escritorio (KAN-62), sin comprobarlo por consola ni medir. **Pendiente de hardware:** Safari 16.4-17 real y Android de gama baja (sin esos dispositivos en KAN-62; el iPhone 17 Pro y el Pixel 10 no sirven)." |
| "Blur de `card-surface` (20 px …)" | B1 (decisión) | **Abierta.** B1 NO VERIFICABLE; el humano no respondió la decisión. | "Se mantiene en 20 px; sin confirmar en un dispositivo real (KAN-62: B1 NO VERIFICABLE, decisión sin respuesta). El lienzo usa `blur(18px) saturate(150%)`." |
| "`tnum` de Montserrat y Karla con el archivo que sirve `next/font`" | A1, A2 | **Verificado a ojo**, sin medir. | "Hecho a ojo (KAN-62): las cifras de Montserrat y de Karla en el catálogo (sección «Cifras») se dieron por buenas visualmente. No se midió el ancho de «1111» y «8888» ni se comprobó la fuente servida; si más adelante se ve una desalineación, reabrir." |
| "Revisar los motivos marcados con †" | C1 a C19 | **Hecha.** 18 de 19 "De acuerdo"; C6 (línea 160) "Cambiar a: Base UI es el default de shadcn (verificado en KAN-33)". | "Hecho (KAN-62): revisados los 19 motivos; 18 quedan como estaban y pierden la †; el de la línea 160 (D4, Radix) se reescribe como «Base UI es el default de shadcn (verificado en KAN-33)»." |
| "Identidad Kanza (KAN-40) a ojo y en hardware" (solo favicon y Bricolage) | A10, A11, A12 | **Verificado a ojo** (parcial: el resto de la fila sigue abierto). | "Favicon legible a 16 px en pestaña clara y oscura y carga de Bricolage sin salto visible: verificado a ojo (KAN-62), sin medir; no consta que se probaran Firefox ni Safari. **Sigue pendiente:** el login a 360 / 375 / 393 / 430 px en claro y oscuro, el grillo sobre la tarjeta sin tapar el título y el contraste del nombre cerca del blob." |
| "Panel \"Auditoría\" del catálogo en 768 / 1024 / 1280 / 1440 px" | A3-1 a A3-8 | **Verificado a ojo**; las lecturas del panel no se registraron. | "Hecho a ojo (KAN-62): los ocho anchos (360 a 1440 px) revisados en claro y, en 360 y 1440 px, en oscuro; sin lecturas registradas del panel. Diferencia conocida por código, no medida: a 768 px el contenido mide 608 px y el lienzo 640 px (anotada sin tarea por decisión del humano)." |
| "`AppShell` responsive (KAN-41) a ojo y en hardware, contra el lienzo" | A4 a A8, A13, E1, E2, B5 y lo de 7.1 | **Parcial.** Verificado a ojo en escritorio; B5 NO VERIFICABLE (sin iPad). | "Verificado a ojo contra el lienzo (KAN-62), sin medir: 768, 1024 y 1440 px en claro y oscuro; grupo centrado a 1920 px; `Toaster` abajo a la derecha a 1280 px; Tab por la barra y menú del avatar con teclado; Inicio a 360 px en DevTools y en un Pixel 10 y un iPhone 17 Pro (KAN-30), incluido el menú con el dedo y «Cerrar sesión». Diferencia conocida: a 768 px el contenido mide 608 px por código y el lienzo 640 px (sin tarea). **Sigue pendiente:** safe areas en un iPad horizontal (sin iPad), 375 / 393 / 430 px a ojo en un celular real y safe areas del título y el contenido en un celular apaisado." |
| "Contraste AA en claro y oscuro …" (la parte "falta verlo en pantalla") | E3 | **Verificado a ojo** (E3 `OK (a ojo)`). | "Visto en pantalla a ojo (KAN-62): el catálogo en claro y oscuro se lee bien; sin medir. Los pares calculados siguen en `tokens.test.ts`." |
| "Safe areas: `AppShell` y `Toaster` ya aplican …" | B5a, B5b, B2 | **NO VERIFICABLE** (sin iPad). B2 no ejecutado. | "Pendiente de hardware: iPad horizontal (en Safari y con la app instalada en la pantalla de inicio); sin iPad disponible en KAN-62. Un iPhone con notch y con home indicator tampoco se probó." |
| "Panel \"Auditoría\" …" y "`AppShell` …" (nota común) | A3-5, A4 | **Diferencia conocida, sin tarea.** | Añadir a §4, en las dos filas anteriores: "A 768 px el contenido mide 608 px (el `max-w-160` de 640 px incluye el padding de 16 px por lado) y el lienzo 640 px. Diferencia conocida por código, no medida (KAN-62); registrada sin tarea por decisión del humano." |
| "Login (KAN-26) en hardware …" | KAN-30 A9 | **Parcial.** El popup lo cerró KAN-30. | "Popup de Google verificado al primer toque, sin `auth/popup-blocked`, en un Pixel 10 (Chrome) y un iPhone 17 Pro (Safari) (KAN-30, 17/10/2026). **Sigue pendiente:** 360 / 375 / 393 / 430 px en claro y oscuro y el teclado abierto en el formulario." |
| "\"Atrás\" tras cerrar sesión …" | KAN-30 A7 y B4 | **Parcial.** El celular y el escritorio los cerró KAN-30. | "Verificado en un Pixel 10, un iPhone 17 Pro (también el gesto de Safari) y Chrome de escritorio: tras «Cerrar sesión», «atrás» no muestra datos (KAN-30, 17/10/2026). **Sigue pendiente:** con varias pantallas privadas en el historial (QA-06, KAN-85) y el E2E de Playwright «login → logout → atrás»." |
| "Cookie de sesión en un navegador real …" | KAN-30 A3, A4b, A9, B5, B6 | **Cerrada** (con un matiz). | "Verificada en un navegador real (KAN-30, 17/10/2026): `__Host-session` HttpOnly, Secure, SameSite Lax, Path `/`, unos 14 días; `POST` y `DELETE /api/auth/session` responden 204; `GET /api/spaces` desde la barra viaja con la cookie por el rewrite. «Probar GET /me» del catálogo no se ejecutó (no existe en staging)." |
| "Menú de la cuenta y modo `modal` de Base UI …" | KAN-30 B3 | **Cerrada.** | "Verificado en Chrome de escritorio a 1280 px (KAN-30, 17/10/2026): sin salto de layout al abrir el menú." |

### 7.3 Lo que queda abierto (frontend-dev no debe marcarlo como hecho)

| Fila de §4 | Qué sigue abierto | Por qué |
|---|---|---|
| "Glass: CSS generado …" (hardware) | Safari 16.4-17 real y Android de gama baja | B1 y B4 NO VERIFICABLE: no hay dispositivos con iOS 16.4-17 ni Android de gama baja. B3 (reducir transparencia en el sistema) no se ejecutó. |
| "Blur de `card-surface` …" | Confirmar el desenfoque de 20 px en un dispositivo real | El humano no respondió la decisión. No depende de la versión de iOS: se puede responder viendo el Inicio de staging en el iPhone 17 Pro o el Pixel 10. |
| "Safe areas: …" | iPad horizontal (B5a, B5b) y iPhone con notch y con home indicator | NO VERIFICABLE: no hay iPad. El iPhone no estaba en la descripción (B2, que tocaba el home indicator con un toast, no se ejecutó). |
| "Panel Auditoría …" y "`AppShell` …" | Diferencia conocida de 608 px contra 640 px a 768 px (y entre 672 y 1023 px) | Calculada del código, no medida. El humano decidió anotarla en §4 **sin tarea**: no es un bug abierto. Si algún día se quiere corregir, es un cambio de `AppShell` (el padding va en el mismo elemento que `max-w-160`). |
| "Panel Auditoría …", "`tnum` …", "`AppShell` …", "Identidad Kanza …", "Contraste AA …" | Nada de la Parte 2 se midió | Todo quedó como "verificado a ojo". Los valores de esta checklist quedan como referencia: si más adelante el humano ve algo que no le guste, lo reporta y se reabre. Tampoco consta la comprobación por consola de que el navegador entendiera `prefers-reduced-transparency` (A9). |
| "Export `viewport` …" | `viewportFit`, `interactiveWidget` y `themeColor` por esquema en dispositivo real | No estaba en la descripción de KAN-62. |
| "Revisión humana del catálogo …" | Dirección visual, 375 / 393 / 430 px a ojo, foco con Tab, en iPhone y Android reales | Solo se cubrió lo de A3 y E1 a E3 en escritorio (B1 y B4 NO VERIFICABLE). |
| "Identidad Kanza (KAN-40) …" | El login a 360 / 375 / 393 / 430 px en claro y oscuro, el grillo sobre la tarjeta sin tapar el título, el contraste del nombre cerca del blob; el favicon en Firefox y Safari | No estaba en la descripción; el favicon solo consta en Chrome de escritorio. |
| "Login (KAN-26) en hardware …" | Login a 360 / 375 / 393 / 430 px en claro y oscuro y el teclado abierto en el formulario | KAN-30 solo cubrió el popup. |
| "`AppShell` responsive … a ojo y en hardware" | Safe areas del título y el contenido (que compartan el borde derecho con inset) en un celular apaisado, y 375 / 393 / 430 px a ojo contra el lienzo en un celular real | No estaba en la descripción. El menú del avatar con el dedo ya lo cubrió KAN-30 (ver 7.1). |
| "\"Atrás\" tras cerrar sesión …" | Con varias pantallas privadas en el historial | Depende de pantallas que aún no existen (QA-06, KAN-85). |
| Playwright y comparación de `Intl` entre Node, WebKit y Chromium | Todo | Es del futuro E2E. |

### 7.4 Otros archivos que frontend-dev debe tocar

- `frontend/CLAUDE.md`, Sesión, "'Atrás' tras el logout, en capas": quitar "_pendiente de hardware_" de la capa 3 y citar KAN-30 (A7, Pixel 10 e iPhone 17 Pro; la capa 3 con varias pantallas privadas sigue pendiente de QA-06).
- `frontend/CLAUDE.md`, Sesión, "Popup y Safari/iOS": quitar "_(pendiente de hardware)_" y citar KAN-30 (A9, Pixel 10 e iPhone 17 Pro).
- `frontend/docs/diseno.md`, línea 12 y los 19 †: los motivos con veredicto "De acuerdo" (C1 a C5 y C7 a C19) pierden la marca; el único "Cambiar a: …" es C6 (línea 160): el motivo pasa a "Base UI es el default de shadcn (verificado en KAN-33)", también sin †. Al no quedar ningún †, la nota de la línea 12 se ajusta (o se elimina) y la fila "Revisar los motivos marcados con †" pasa a "Hecho (KAN-62)".
- `frontend/docs/diseno.md` §4: en cada fila, distinguir "verificado a ojo" de "medido" (aquí no hay nada medido) y añadir la nota de la diferencia 608 px contra 640 px (7.2, fila "nota común"), sin crear tarea.
- `frontend/docs/diseno.md`, fila "`AppShell` responsive … Pendiente de Hito 1" y demás texto de Hito 1: sin cambios.

## 8. Hoja de respuestas

Todo está registrado: el inventario (1.1), la Parte 2 como `OK (a ojo)`, la Parte 3 como NO VERIFICABLE o no ejecutada, y los 19 veredictos de la Parte 4. Solo queda abierta, y es opcional, la decisión del blur de 20 px (B1 y 7.2):

```
Decisión del blur de 20 px: 
```
