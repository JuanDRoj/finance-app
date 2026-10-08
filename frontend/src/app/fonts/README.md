# Fuentes versionadas (KAN-42)

Las tres fuentes de la app viven en el repo y se cargan con `next/font/local`, así que `next build`
no necesita red. Una carpeta por familia, con su woff2 y su `OFL.txt` (la licencia exige conservar el
aviso de copyright y el texto):

- `montserrat/`: títulos y cifras. Fuente variable, subset `latin` (se declara en `layout.tsx`).
- `karla/`: texto corrido. Fuente variable, subset `latin` (se declara en `layout.tsx`).
- `bricolage/`: solo el nombre "Kanza" (`components/brand/brand-font.ts`). Ver `docs/marca-kanza.md`.

## Fuente única de verdad: `fonts.json`

`fonts.json` lista cada woff2 con su `sha256`, la URL del CSS de Google Fonts del que sale, la URL
del archivo (`source`) y su licencia. Los hashes viven solo ahí: este README, `CLAUDE.md` y los docs
nunca los copian. `fonts.test.ts` (`npm test`) falla si un woff2 no coincide con su hash, si hay un
woff2 sin registrar (o una entrada sin archivo) o si falta la `OFL.txt` junto a una fuente.

## Cómo obtener o repetir un archivo

1. Pide el CSS de la entrada (campo `css`) con el User-Agent de un navegador moderno, el mismo que
   usa `next/font/google`, para que Google responda con woff2:
   `curl -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36' '<css>'`
2. En la respuesta, toma la URL del bloque `/* latin */` y descárgala (es el campo `source`; el
   número de versión de la URL, `v31`, `v33`…, la hace estable).
3. `sha256sum` del archivo debe dar el `sha256` de `fonts.json`.

Montserrat y Karla son archivos variables: un solo woff2 sirve para todos los pesos.

## Cambiar una fuente

1. Sustituye el woff2 (y su `OFL.txt` si cambia el aviso de copyright).
2. Actualiza `sha256` (y `source`) en `fonts.json`.
3. Revisa el resultado a mano en `/login` y `/catalog` (claro y oscuro) antes de hacer el PR.

Bricolage Grotesque es la excepción: su copia de KAN-40 ya no se puede reproducir desde Google (la
misma petición devuelve hoy otro build). El archivo del repo es la referencia y no se refresca sin
revisar el logotipo.
