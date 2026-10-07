# Kanza: guía de uso de la marca

Estado: **aprobado el 2026-10-06** · Tarea KAN-40 [FE-09] · Kit v2 (carpeta local `~/kanza-marca/`, fuera del repo). Esta guía es la del kit adaptada a las rutas del repo; las decisiones de diseño están en [`diseno.md`](diseno.md) (D6 y D16).

## 1. La marca

- **Nombre:** Kanza (de "¿me al-kanza?"). **Lema:** "Haz que alcance".
- **Idea:** el grillo verde menta se asoma por encima de una moneda gigante y la sujeta con las patitas: es el guardián de tu plata.
- **Pieza principal:** el ícono ("B2 · Detrás de la moneda"): el grillo y la moneda sobre una baldosa verde bosque `#146e4d`. Funciona igual en claro y en oscuro porque trae su propia baldosa.
- **Mascota:** el grillo. El de cuerpo entero quedó archivado y ya no se usa en la app.

## 2. Archivos en el repo

| Archivo | Uso |
|---|---|
| `public/brand/kanza-icon.svg` | Ícono de app y marca principal, con esquinas redondeadas. Lo usa la cabecera del login |
| `public/favicon.svg` | **Maestro del favicon**: versión simplificada para menos de 32 px (cabeza más grande, antenas gruesas, moneda lisa). Es idéntico byte a byte a `kanza-favicon.svg` del kit, por eso no se duplica |
| `public/brand/kanza-peek.svg` | Solo la cabeza asomándose, para el login (sobre la tarjeta del formulario) y, más adelante, los avisos |
| `public/brand/kanza-lockup-horizontal.svg` / `-dark.svg` | Ícono + "Kanza" en fila, sobre fondo claro u oscuro (`#08110d`). Para material fuera de la app |
| `public/brand/kanza-lockup-vertical.svg` | Ícono arriba y "Kanza" abajo (pantalla de carga, espacios cuadrados) |
| `public/favicon.ico`, `favicon-16/32/48.png` | Favicon para navegadores que no usan el SVG |
| `public/apple-touch-icon.png` | Ícono de iOS (180 px) |
| `public/icon-192.png`, `icon-512.png`, `maskable-512.png` | Íconos del manifest (el `maskable` es para Android) |
| `public/site.webmanifest` | Manifest: nombre "Kanza", `theme_color` `#146e4d` (igual que `--primary` claro), `background_color` `#e9f4ee` |
| `src/app/fonts/bricolage-grotesque-800-opsz96.woff2` | Tipografía del nombre (ver 5) |
| `src/app/fonts/OFL.txt` | Aviso de copyright y texto de la licencia SIL OFL 1.1 de esa tipografía |

Del kit **no** se copiaron: `kanza-wordmark.svg` (el login usa texto vivo con color de token), `kanza-symbol*.svg` y los mono (estados vacíos y sellos: se copian cuando una tarea los use), `kanza-icon-square.svg` (origen de los PNG de iOS y maskable, ya exportados), `fuentes/src-*.svg` (dibujos de trabajo), `kanza-kit-resumen.png` y `head-snippet.html` (su contenido está en `metadata` de `src/app/layout.tsx`). Nada de la librería de logos de terceros de la skill `logo-design` entra al repo; `src/app/brand-assets.test.ts` vigila que `public/brand/` solo tenga los SVG de arriba.

## 3. Cómo se registra en la app

- `src/app/layout.tsx` (`metadata`): título "Kanza" (con plantilla `%s · Kanza`: el login queda "Entrar · Kanza"), `icons` (ico 48 px, svg, apple-touch-icon) y `manifest`.
- `theme-color`: **no** se usa el `<meta theme-color>` único del kit. `viewport.themeColor` sigue por esquema (`#E9F4EE` claro, `#08110D` oscuro, D12); `#146e4d` solo vive en el manifest (app instalada).
- Login: `KanzaBrand` (`src/components/brand/kanza-brand.tsx`, ícono de 40 px + nombre) encima del formulario, y el peek sobre la tarjeta (`src/app/login/_components/login-form.tsx`).

## 4. Espacio libre, tamaño mínimo y color

- **Espacio libre:** alrededor del logo, la altura de la K de "Kanza", o un cuarto del ancho del ícono si va solo.
- **Tamaño mínimo:** logotipo horizontal 120 px de ancho; ícono completo 32 px; por debajo de 32 px, siempre el favicon.

| Nombre | HEX | Token / uso |
|---|---|---|
| Verde bosque (baldosa y nombre sobre claro) | `#146e4d` | = `--primary` claro |
| Menta (grillo; nombre sobre oscuro) | `#6eddaa` | = `--primary` oscuro |
| Verde moneda (aro y raya) | `#3cbf86` | solo dentro de los SVG |
| Menta claro (moneda) | `#cbebdc` | solo dentro de los SVG |
| Tinta (ojos) | `#0e1a14` | solo dentro de los SVG |

En la interfaz el nombre se pinta con el token `text-primary`: no escribas hex sueltos.

## 5. Tipografía

- **Logotipo y nombre escrito en pantallas** (cabecera del login; después, la pantalla de carga): Bricolage Grotesque ExtraBold (800), tamaño óptico 96, `letter-spacing: -0.03em`. En código: clase `font-brand` (`--font-brand`), `font-extrabold`, `tracking-brand` (`--tracking-brand: -0.03em`) y `text-brand` (`--text-brand: 1.4375rem`, los 23 px del login). Úsala solo para la marca, nunca para texto de la interfaz (Montserrat y Karla).
- **Cómo se carga:** `next/font/local` en `src/components/brand/brand-font.ts`, con el woff2 que Google Fonts sirve para `family=Bricolage+Grotesque:opsz,wght@96,800` (subset latin, 21,7 kB). Se eligió local porque `next/font/google` no permite fijar el tamaño óptico junto con un solo peso (con `weight` fijo no admite `axes`; con `weight: "variable"` baja el rango completo, unos 77 kB). La fuente se declara en el componente del nombre, no en el layout, así solo las rutas que lo muestran la precargan.
- **Licencia:** Bricolage Grotesque es SIL Open Font License 1.1, "Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)". La OFL permite usarla y redistribuirla en el repo y en logotipos, a condición de conservar el aviso de copyright y el texto de la licencia: están en `src/app/fonts/OFL.txt`, junto al woff2 (copia del `OFL.txt` oficial de `google/fonts`, `ofl/bricolagegrotesque/`). Montserrat y Karla también son OFL.
- Los logotipos del kit ya traen el nombre convertido a trazos: no hace falta la fuente para usarlos.

## 6. Qué no hacer

- No estirar, rotar ni cambiar colores fuera de la paleta.
- No quitar la moneda del ícono ni sacar al grillo de la baldosa en el ícono de app.
- No agregar sombras, contornos ni degradados al logo (en la pantalla de carga sí se permite la sombra suave del ícono).
- No usar el ícono completo por debajo de 32 px: usa el favicon.
- No volver a escribir "Kanza" con otra fuente en un logotipo: usa los archivos.
- Accesibilidad: el ícono y el peek junto a texto visible son decorativos (`alt=""`); si alguna vez un ícono va solo, `alt="Kanza"`.

## 7. Origen

Ícono "B2 · Detrás de la moneda" y tipografía del nombre, elegidos el 2026-10-06 en el lienzo de marca https://claude.ai/artifact/QhYwACgCTYJHpApRSWLgRa. Los dibujos de partida están en `fuentes/src-*.svg` del kit local.
