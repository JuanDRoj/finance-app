# Aceptación del Hito 1 en staging (KAN-86, QA-07)

Checklist manual para verificar, desde el celular y desde escritorio, el criterio de terminado de la épica KAN-44:

> Desde el celular, en staging: elijo mi moneda, creo mi cuenta de banco y mi tarjeta con su saldo actual, registro un gasto con "+" en menos de 10 s, lo veo en Movimientos, lo edito, lo borro y lo deshago, pago la tarjeta con una transferencia, y el Inicio muestra Disponible, Deuda tarjetas, Neto y el top 5 de gastos del mes correctos. Y en escritorio a 1280 y 1440 px, el mismo recorrido con la barra lateral, el panel lateral para registrar y editar, Movimientos en tabla con filtros, el detalle de cada cuenta y el Inicio con sus dos gráficos.

Cubre HU-13 (KAN-55, Inicio) y los criterios verificables a mano de HU-7 (KAN-49), HU-8 (KAN-50), HU-9 (KAN-51), HU-10 (KAN-52), HU-11 (KAN-53) y HU-12 (KAN-54); la Parte D dice qué paso cubre cada criterio y cuáles quedan para los tests automáticos. Lo ejecuta el humano. Las capturas debían adjuntarse al ticket KAN-86 en Jira, pero en esta ejecución el humano decidió no adjuntar ninguna (ver el Registro de capturas).

- URL de staging: `https://kanza-stg.vercel.app` (alias fijo de Vercel; el Production de Vercel hace de staging).
- Backend: servicio `finance-api-stg` de Cloud Run, job `finance-migrate-stg`, instancia `finance-db-stg` de Cloud SQL, proyecto `kanza-stg`, región `southamerica-east1`.
- Capturas: **ninguna**. La aceptación se aprobó sin capturas por decisión del humano (excepción al criterio de Jira "Capturas adjuntas a este ticket"). Comentario de resultados en Jira (KAN-86): lo publicará `jira-manager`.
- Fecha de la prueba: `14 / 11 / 2026` · Quién la ejecuta: `humano`
- Resultado: el humano recorrió toda la checklist (preparación, Parte A en escritorio a 1280 y 1440 px, Parte B en Android e iPhone y Parte C) y todos los pasos dieron OK. Un solo hallazgo: BUG-1 (Baja, confirmado en el iPhone). La BD quedó apagada (Z1).
- Tiempo estimado: unas 3 a 3,5 h en una sola sesión (preparación y espera de la BD ~20 min, escritorio ~60, anchos ~15, cada celular ~45, cierre ~10).

Cada comando que toca la nube (GCP, Firebase, Vercel) o el CD de GitHub lo ejecuta el humano, con permiso explícito, de uno en uno. Nada de esto se hace contra producción. Ningún agente ejecuta comandos de nube.

**Orden recomendado:** Preparación (P0 a P9) → Parte A (escritorio 1280 px) → volver a iniciar sesión (A36 y A37 cierran la sesión) → Parte C (anchos del Inicio, misma cuenta de escritorio) → Parte B en Android → Parte B en iPhone → Cierre (Z). No ejecutar el último ni el primer día del mes, ni cerca de medianoche: el mes y "hoy" salen de la zona horaria del espacio.

## 0. Antes de empezar

### 0.1 Datos de prueba

| Dato | Qué usar |
|---|---|
| Usuario de escritorio | La cuenta de email activa de las pruebas del Hito 0 (por ejemplo `<tu-usuario>+kanza-h0@gmail.com`; el correo y la contraseña los guarda el humano fuera del repo). Su espacio tiene que estar **sin cuentas y sin movimientos** (en staging no existía la tabla de cuentas antes de esta preparación, así que lo está). Si no lo estuviera, usar un alias nuevo `<tu-usuario>+kanza-h1-pc@gmail.com`. Esta cuenta tiene un espacio anterior a la migración 0004: sus categorías las sembró la migración. |
| Usuario de Android | Un alias nuevo: `<tu-usuario>+kanza-h1-android@gmail.com`, contraseña de 8 o más caracteres. Su primer login crea el espacio y siembra las categorías con el backend nuevo. |
| Usuario de iPhone | Un alias nuevo: `<tu-usuario>+kanza-h1-ios@gmail.com`. Igual que el de Android. |
| Aviso | Una cuenta de email y una de Google no pueden compartir correo (Firebase permite una cuenta por email). No reutilizar el correo de una cuenta de Google. |
| Dispositivos | Escritorio con Chrome (ventana a 1280 px de ancho y DevTools; para 1440 px, la ventana o, si el monitor no llega, DevTools en modo "Responsive" a 1440 × 900), un Android con Chrome y un iPhone con Safari. Navegador sin sesión previa en staging (o ventana privada). |
| Diseño de referencia | El lienzo de Kanza (enlace en `frontend/docs/diseno.md`, línea 5; no está en el repo). Artboards: `K-V2-*` (escritorio, 1440 px), `K-Tablet` (768 px) y `K-Inicio` (360 px) para el Inicio, y `K-H1-*` (360 px) para las pantallas del Hito 1. Detalle en `frontend/docs/diseno.md`, D17 > Escritorio v2. |
| Moneda | Escritorio y Android: UYU (se escribe `1550` y se ve `$ 1.550,00`). iPhone: **CLP**, moneda con exponente 0 (se escribe lo mismo y se ve `CLP 1.550`, sin decimales). Es a propósito: ejerce el formato de dinero de WebKit real. |

**Cuentas y movimientos del ejemplo.** Todos los montos son pesos enteros; se teclean sin puntos (`20000`) y, donde se indica, con coma decimal (`2340,50`). Las cuentas se llaman así a propósito: por orden de nombre la primera es "Banco Itaú", que es la cuenta preseleccionada del primer gasto.

| Cuenta | Tipo | Campo | Se teclea |
|---|---|---|---|
| Banco Itaú | Banco | Saldo actual | `20000` |
| Efectivo | Efectivo | Saldo actual | `3000` |
| Visa Itaú | Tarjeta | Deuda actual (en positivo); día de cierre 5; día de vencimiento 12 | `4000` |

| # | Movimiento | Cuenta | Categoría (principal > sub) | Descripción | Notas |
|---|---|---|---|---|---|
| S1 | Ingreso `1000`, con fecha del **mes anterior** (por ejemplo el día 10) | Banco Itaú | Otros ingresos (no tiene subcategorías) | Mes anterior ingreso | Solo escritorio, paso A8c. Da historial al Inicio para que se dibujen los gráficos. |
| S2 | Gasto `1000`, misma fecha del mes anterior | Banco Itaú | Otros gastos (no tiene subcategorías) | Mes anterior gasto | Solo escritorio, paso A8c. Se compensa con S1: el saldo no cambia. |
| 1 | Gasto `1550`, luego se edita a `1200` | Banco Itaú | Comida > Supermercado | (vacía) | Cronometrado en celular. Se edita, se elimina y se deshace. |
| 2 | Gasto `800` | Banco Itaú | Comida > Restaurantes | (vacía) | Cronometrado en celular. |
| 3 | Gasto `800` | Banco Itaú | Salud > Medicamentos | (vacía) | Cronometrado en celular. |
| 4 | Gasto `2340,50` (iPhone, en CLP: `2340`) | Visa Itaú | Comida > Cafés | Prueba borrar | Prueba los errores del formulario y la tarjeta. Se **elimina sin deshacer**. |
| 5 | Gasto `600` | Banco Itaú | Ocio > Salidas | Película | |
| 6 | Gasto `400` | Banco Itaú | Ropa (no tiene subcategorías) | Remera | |
| 7 | Gasto `1200` | Efectivo | Transporte > Taxi y apps | Taxi | |
| 8 | Gasto `3000` | Visa Itaú | Hogar > Servicios | Luz | |
| 9 | Ingreso `10000` | Banco Itaú | Trabajo > Sueldo | Sueldo | |
| 10 | Transferencia `4000` (pago de la tarjeta) | Desde Banco Itaú, hacia Visa Itaú | (no lleva categoría) | (vacía) | |
| 11 | Cuadrar saldo de Efectivo a `1500` | Efectivo | (no lleva categoría) | (no lleva) | Genera un ajuste de −300. |

**Puntos de control** (UYU, en pesos; la deuda se muestra en positivo). Disponible = Banco + Efectivo; Deuda = la deuda de la Visa; Neto = Disponible − Deuda.

| Punto | Después de | Banco Itaú | Efectivo | Visa Itaú (deuda) | Disponible | Deuda tarjetas | Neto |
|---|---|---|---|---|---|---|---|
| CP0 | crear las 3 cuentas | 20.000 | 3.000 | 4.000 | 23.000 | 4.000 | 19.000 |
| CP1 | gasto 1 de 1.550 | 18.450 | 3.000 | 4.000 | 21.450 | 4.000 | 17.450 |
| CP2 | editarlo a 1.200 | 18.800 | 3.000 | 4.000 | 21.800 | 4.000 | 17.800 |
| CP3 | eliminarlo | 20.000 | 3.000 | 4.000 | 23.000 | 4.000 | 19.000 |
| CP4 | deshacer | 18.800 | 3.000 | 4.000 | 21.800 | 4.000 | 17.800 |
| CP5 | gastos 2 y 3 | 17.200 | 3.000 | 4.000 | 20.200 | 4.000 | 16.200 |
| CP6 | gasto 4 (Prueba borrar, con la Visa) | 17.200 | 3.000 | 6.340,50 | 20.200 | 6.340,50 | 13.859,50 |
| CP7 | eliminar el gasto 4 (igual que CP5) | 17.200 | 3.000 | 4.000 | 20.200 | 4.000 | 16.200 |
| CP8 | gastos 5, 6, 7 y 8 | 16.200 | 1.800 | 7.000 | 18.000 | 7.000 | 11.000 |
| CP9 | ingreso 9 | 26.200 | 1.800 | 7.000 | 28.000 | 7.000 | 21.000 |
| CP10 | transferencia 10 | 22.200 | 1.800 | 3.000 | 24.000 | 3.000 | 21.000 |
| CP11 | cuadrar Efectivo (final) | 22.200 | 1.500 | 3.000 | 23.700 | 3.000 | 20.700 |

- **iPhone (CLP):** los mismos números, sin decimales y con el código en lugar del símbolo (`CLP 23.700`). La única diferencia es CP6, porque el gasto 4 es `2340`: Visa y Deuda `CLP 6.340`, Neto `CLP 13.860`.
- **CP3 en Inicio:** el aviso de "Deshacer" dura unos 6 s. Si no da tiempo de ir al Inicio, CP3 se comprueba en Movimientos (la fila sale y el resumen de Gastos vuelve a cero) y el Inicio se verifica en CP4. Eliminar el gasto 4 (que no se deshace) sí deja ver el Inicio con calma (CP7).
- **Inicio final (CP11):** Neto `$ 23.700,00 − $ 3.000,00 = $ 20.700,00`. La nota de Disponible dice "1 banco y efectivo"; la de Deuda de tarjetas, "En 1 tarjeta".
- **Gastos del mes: `$ 8.000,00`** (los 7 gastos vigentes: 1.200 + 800 + 800 + 600 + 400 + 1.200 + 3.000). El gasto 4, eliminado, no cuenta.
- **Top 5 final** (porcentaje sobre los 8.000 de todo el gasto del mes, redondeado hacia arriba en la mitad):

| Puesto | Categoría principal | Monto | % | Cómo sale |
|---|---|---|---|---|
| 1 | Hogar | $ 3.000,00 | 38 % | Luz (3.000 / 8.000 = 37,5 y sube a 38) |
| 2 | Comida | $ 2.000,00 | 25 % | Supermercado 1.200 + Restaurantes 800: suma las subcategorías |
| 3 | Transporte | $ 1.200,00 | 15 % | Taxi |
| 4 | Salud | $ 800,00 | 10 % | Medicamentos |
| 5 | Ocio | $ 600,00 | 8 % | Película (7,5 sube a 8) |

- **Fuera del top 5** (si aparecen o cambian estas cifras, es un fallo): Ropa 400 (5 %, sería la sexta; el top solo trae 5 y no hay fila "Otros"), el sueldo de 10.000 (es un ingreso), la transferencia de 4.000, el ajuste de −300 del cuadre y el gasto 4 eliminado (si contara, Comida sería 4.340,50). Las filas no suman 100 %: es lo esperado.
- **Movimientos del mes:** "{Mes} 2026 · 13 movimientos" = 7 gastos + 1 ingreso + 1 transferencia + 4 ajustes (3 saldos iniciales y 1 cuadre). Resumen: Ingresos +$ 10.000,00, Gastos −$ 8.000,00, Te quedan $ 2.000,00 (los ajustes y la transferencia no suman). **Mes anterior (solo escritorio, por la siembra S1 y S2):** "{Mes anterior} 2026 · 2 movimientos" ("Mes anterior ingreso" y "Mes anterior gasto"), Ingresos +$ 1.000,00, Gastos −$ 1.000,00, Te quedan $ 0,00. En celular no se ve el conteo "N movimientos" (el subtítulo es de escritorio): se cuentan las filas.
- **Detalle de cuentas** (escritorio): Banco Itaú, "Movimiento neto de {mes}" +$ 22.200,00 y último saldo $ 22.200,00; Visa Itaú, "Consumos de {mes}" $ 3.000,00 y deuda final $ 3.000,00; Efectivo, "Movimiento neto" +$ 1.500,00. Los dos movimientos del mes anterior suman 0 y son de otro mes: no cambian estas cifras.
- **Categorías predefinidas** (34): gastos, 10 principales y 14 subcategorías; ingresos, 5 principales y 5 subcategorías.
- **Siembra del mes anterior (S1 y S2, solo escritorio, A8c).** El ingreso y el gasto van a la **misma cuenta** (Banco Itaú) y se compensan: ningún saldo ni punto de control cambia, ni el top 5 (es solo del mes en curso), ni los 13 movimientos del mes en curso. Lo que cambia es la serie de los gráficos. Sin movimientos en un mes anterior, el Inicio de escritorio no dibuja el área del Neto (D9: con un solo mes una línea "desde 0" mentiría); con la siembra sí.
- **Gráficos de escritorio, con la siembra:**
  - Neto: seis puntos, los cinco primeros en `$ 0,00` (el mes anterior cierra en $ 0,00: +1.000 − 1.000) y el último en el Neto de hoy; el chip dice «+$ 19.000,00 este mes» en CP0 y «+$ 20.700,00 este mes» en CP11 (el Neto de hoy menos el cierre del mes anterior).
  - Ingresos y gastos: barras en dos meses; el mes anterior con ingresos $ 1.000,00 y gastos $ 1.000,00 y, en CP11, el mes en curso con ingresos $ 10.000,00 y gastos $ 8.000,00 (subtítulo «Últimos 6 meses · {mes} en curso»). En CP0 el mes en curso aún no tiene barras.
  - Nota de la tile «Gastos de {mes}»: antes del día 15 no hay nota; desde el 15 compara con el mes anterior: en CP11, «700 % más que en {mes anterior}» (8.000 contra 1.000).
  - En celular los gráficos, el chip y la nota no se dibujan ni se piden: no hace falta sembrar.

### 0.2 Preparación (Cloud SQL, migraciones y despliegue)

Cloud SQL (`finance-db-stg`) está apagada por defecto y staging está en la migración `0002`: los merges desde entonces se desplegaron con la BD apagada, sin migrar. Al encenderla y relanzar el CD correrán de una vez la `0003` a la `0008` (cuentas, categorías, transacciones y entries, índice de `space_id`, `idempotency_keys` y la extensión `unaccent`). Es la primera vez que corren en staging. Todos los comandos de nube llevan `--project` y `--region` explícitos.

| Paso | Comando o acción | Resultado esperado | Resultado |
|---|---|---|---|
| P0 | `bash infra/scripts/vercel_check.sh` (solo HTTP público, no usa la BD) | `RESUMEN: ... fallos=0` (en el Hito 0 dio `pasan=9 avisos=0 fallos=0`). Si falla, parar: no tiene sentido encender la BD. | OK: `RESUMEN: pasan=9 avisos=0 fallos=0`. |
| P0b | `git fetch origin` y `git log -1 --format='%H %s' origin/main`; luego, en el dashboard de Vercel (proyecto `kanza-stg`), abrir el último despliegue de Production | El despliegue de Production es de ese mismo commit y está en Ready. Anotar el SHA: `bf6322566bf8b7ccbea48861a88fc9343f4e8dee` (el mismo del servicio en P6) | OK |
| P1 | `bash infra/scripts/sql_power.sh start` (en una terminal propia; pide `[s/N]`: responder `s`) | La instancia queda `RUNNABLE` / `ALWAYS`. Tarda unos 13 min (853 s y 875 s en las últimas veces). Durante la espera, preparar los dispositivos (P9). También se puede lanzar con `!` desde la sesión de Claude Code: `printf 's\n' \| bash infra/scripts/sql_power.sh start` responde la confirmación (probado el 13/11/2026, `fallos=0`). Si la instancia ya está encendida, el script lo dice y no cambia nada. | OK: lanzado con `printf 's\n' \| bash infra/scripts/sql_power.sh start` desde `!`, `fallos=0`. |
| P2 | `bash infra/scripts/sql_power.sh status` | Muestra `Estado: RUNNABLE · política: ALWAYS` y "ENCENDIDA". No lanzar el CD antes: con la instancia en transición el CD falla en rojo ("Cloud SQL en transición"). | OK: `RUNNABLE` / `ALWAYS`. |
| P3 | `gh workflow run cd-staging.yml --ref main` y luego `gh run list --workflow cd-staging.yml --limit 3` | Aparece una corrida `workflow_dispatch` nueva. Anotar su id: `43542656916` | OK: corrida `workflow_dispatch` `43542656916`. |
| P4 | `gh run watch <id de P3>` y luego `gh run view <id de P3>`; abrir el resumen del job en GitHub | Corrida en verde (unos 2 a 3 min). El resumen **no** dice "Migraciones omitidas"; muestra la ejecución de `finance-migrate-stg` terminada bien con la imagen del commit, y la línea "Commit:" con el SHA de P0b. **Captura del resumen.** Si falla en la migración `0008` (`CREATE EXTENSION unaccent`): parar, copiar el error textual (el deployer no lee Cloud Logging: el detalle está en la Consola, Cloud Run > Jobs > `finance-migrate-stg`) y reportarlo como bug Bloqueante. No se aplica ningún arreglo a mano (por ejemplo crear la extensión como `postgres`) sin la decisión del humano. Una migración que falla deja la BD en `0002` y el servicio sin desplegar. | OK: corrida `43542656916` en verde (`pasan=10 avisos=0 fallos=0`); Cloud SQL `RUNNABLE` / `ALWAYS` y el resumen dice que se ejecutarán las migraciones; la ejecución `finance-migrate-stg-j88kz` terminó bien con la imagen del commit (`alembic upgrade head` llegó a la `0008`, sin fallo). |
| P5 | `gcloud run jobs executions list --job=finance-migrate-stg --project=kanza-stg --region=southamerica-east1 --limit=3` | La ejecución de P4 terminó bien (1 tarea completada). | OK: ejecución `finance-migrate-stg-j88kz`, terminada bien. |
| P6 | `gcloud run services describe finance-api-stg --project=kanza-stg --region=southamerica-east1 --format='value(metadata.labels.git-sha,status.traffic)'` | `git-sha` igual al SHA de P0b y el tráfico al 100 % en una sola revisión. | OK: `git-sha` `bf6322566bf8b7ccbea48861a88fc9343f4e8dee`. |
| P7 | (opcional) Cloud SQL Studio en la Consola (proyecto `kanza-stg`, instancia `finance-db-stg`, base `finance`): `SELECT version_num FROM alembic_version;` y `SELECT extname FROM pg_extension WHERE extname = 'unaccent';` | `0008` y una fila `unaccent`. Si se omite, los pasos A5 y A29 lo prueban de forma indirecta (cuentas y búsqueda sin acentos). | OK (indirecto: búsqueda «pelicula»). |
| P8 | `curl -s https://kanza-stg.vercel.app/api/health` | `{"status":"ok"}`. Además calienta Cloud Run (mínimo 0 instancias). | OK: `{"status":"ok"}`. |
| P9 | Tener a mano: los tres usuarios de 0.1 con sus contraseñas, el lienzo abierto, Chrome en escritorio con DevTools, el Android y el iPhone con la URL y un cronómetro (la app de reloj o una grabación de pantalla). | Listo. | OK |

Por qué P3 es obligatorio: el frontend de Vercel se despliega solo con cada merge, pero el backend solo con el CD. Hasta repetir P3 con la BD encendida, el backend de staging no tiene los endpoints nuevos y las pantallas darían 404 o 500. Al terminar toda la prueba, apagar la instancia (ver Cierre).

### 0.3 Capturas y fallos

- **Capturas.** Las marcadas "(oblig.)" son obligatorias; el resto son recomendadas. Nombre: `H1-<paso>-<dispositivo>-<claro|oscuro>.png` con dispositivo `pc1280`, `pc1440`, `android` o `iphone` (por ejemplo `H1-A25-pc1280-claro.png`). Se adjuntan al ticket **KAN-86** en Jira; no van al repo (es público). Anótalas en el Registro de capturas del final. (En la ejecución del 14/11/2026 no se adjuntaron capturas: ver ese registro.)
- **Grabación de pantalla** recomendada en los celulares para los 3 cronometrajes y para "atrás" (permite ver un destello de datos que una captura no ve). Si el archivo no cabe en Jira, poner un enlace.
- **Fallos.** Un paso que no da el resultado esperado se marca FALLA y se anota en el Registro de fallos con el formato de bug del proyecto (pasos para reproducir, esperado, obtenido con el texto del error, severidad, test que lo demuestra: "manual"). "N/P" (no probado) solo vale en los pasos marcados "(opcional)" y en el sub-paso que diga expresamente que se puede omitir (B18 c en iPhone).
- Los textos entre comillas son los de la app. Una diferencia menor (mayúsculas, un "Hoy" de más) no es FALLA salvo que cambie el significado.
- **No capturar secretos.** Nada de tokens ni del valor de la cookie `__Host-session`; en DevTools mostrar solo la lista de Network con nombre y estado, nunca la pestaña Payload ni Headers de `POST /api/auth/session`. Usar solo cuentas de prueba.

### 0.4 Diferencias conocidas con el lienzo y con Jira (no marcar FALLA)

- "Últimos movimientos" del Inicio mide 668 px de base en vez de los 560 del lienzo (desvío documentado en `frontend/CLAUDE.md`): la tabla compacta no cabe a 1280 px si no.
- A 768 px el contenido mide 608 px y el lienzo dibuja 640 px (registrado sin tarea).
- En celular y tablet (menos de 1024 px) el Inicio no dibuja los gráficos, el chip de variación del Neto ni "Últimos movimientos", y bajo el Neto solo dice «Tu disponible menos la deuda de tarjetas» (sin «· últimos 6 meses»); todo eso existe desde 1024 px.
- El enlace del top 5 dice "Ver todo" bajo 1024 px y "Ver todas" desde ahí; el título, "Gastos de {mes}" y "Gastos por categoría".
- Jira (HU-11) llama "Nuevo movimiento" a lo que la app llama "Registrar movimiento" (decisión D19 de `frontend/docs/diseno.md`).
- Sin movimientos en un mes anterior (un espacio nuevo), el Inicio de escritorio no dibuja el área del Neto: dice «Cuando termine tu primer mes, aquí verás cómo evoluciona tu neto.», sin chip de variación, y «Ingresos y gastos» dice «Todavía no hay ingresos ni gastos en estos meses. Cuando registres movimientos, los verás aquí.» Por eso A8c siembra un ingreso y un gasto de 1.000 en el mes anterior (solo en escritorio). Con historial, el Neto de los meses anteriores al primer movimiento vale 0.
- Sin conexión, la lista de Movimientos no muestra un error: la consulta queda en pausa (el modo de red por defecto de TanStack Query es «online») y se completa sola al volver la red. Es una observación, no un bug (ver A30 y B28).
- Los montos negativos llevan el signo pegado al símbolo: `−$ 1.550,00` (el signo es el menos tipográfico) y `+$ 10.000,00` los positivos con signo; en CLP, `−CLP 1.550`. Las transferencias se muestran sin signo.
- El selector de moneda lista 8 monedas: CLP y PYG salen solo con el código, sin nombre. Confirmado en el iPhone el 14/11/2026 como bug de severidad Baja: ver BUG-1 del Registro de fallos.

## 1. Parte A: escritorio (Chrome), 1280 px y 1440 px

Usuario de escritorio de 0.1. Hacer todo con la ventana a 1280 px, claro, salvo donde se indique. Se registran todos los movimientos de la tabla de 0.1; el tiempo no se mide en escritorio.

| N.º | Acción | Resultado esperado | Captura | Resultado |
|---|---|---|---|---|
| A1 | Abrir `https://kanza-stg.vercel.app/` y entrar con "Iniciar sesión". | Llega al Inicio de primer uso: el grillo, "Empieza por tus cuentas" y "Crear mi primera cuenta"; a su lado la tarjeta "Moneda de tu espacio" (Peso uruguayo · UYU) con "Cambiar". Barra lateral oscura de 240 px con "Nueva cuenta" como botón principal (no "Registrar", porque no hay cuentas). Debajo del título, la fecha de hoy. (HU-9: sin cuentas, el Inicio invita a crear la primera.) | Inicio de primer uso (oblig.). | OK |
| A2 | Ir a "Movimientos" en la barra lateral. | Estado vacío: "Aún no tienes movimientos" con el grillo y un botón de la acción principal. (HU-12: estado vacío.) | Estado vacío. | OK |
| A3 | Ir a "Categorías" (abajo en la barra lateral). Mirar las dos tarjetas, Gastos e Ingresos. | Gastos: 10 principales y 14 subcategorías; Ingresos: 5 principales y 5 subcategorías (34 en total). Cada fila con su ícono, dos niveles y nada más: una subcategoría no ofrece "Agregar subcategoría". Es un espacio existente: las sembró la migración `0004`. (HU-10.) | Categorías (oblig.). | OK |
| A4 | Volver al Inicio. Pulsar "Cambiar" (diálogo de moneda). Contar las opciones. Elegir "Dólar estadounidense" y "Usar esta moneda"; comprobar el Inicio; repetir y volver a "Peso uruguayo". | El diálogo ofrece 8 monedas: UYU, COP, USD, ARS, BRL, EUR y, solo con el código, CLP y PYG. La nota dice "Puedes cambiarla hasta que registres tu primer movimiento." El Inicio muestra "Dólar estadounidense · USD" y luego de nuevo "Peso uruguayo · UYU". Terminar en UYU. (Épica: elijo mi moneda; HU-9: elegir moneda.) | Diálogo con las 8 monedas (oblig.). | OK |
| A5 | **Antes de crear la cuenta:** abrir una segunda pestaña del Inicio, pulsar "Cambiar" y dejar el diálogo abierto sin elegir. En la primera pestaña, pulsar el botón "Nueva cuenta" de la barra lateral: se abre el panel; pulsar "Cancelar". Después pulsar "Crear mi primera cuenta" y comprobar que abre el mismo panel. Tipo Banco, Nombre `Banco Itaú`, Saldo actual `20000`, "Crear cuenta". | El panel lateral "Nueva cuenta" (440 px) abre con el foco en el nombre; los dos botones abren el mismo formulario (HU-9). Al crear, el panel se cierra y el Inicio ya muestra una cuenta. **La tarjeta "Moneda de tu espacio" desaparece:** el saldo inicial es un ajuste, o sea un movimiento, y con movimientos la moneda queda fija. La barra lateral pasa de "Nueva cuenta" a "Registrar". | Panel "Nueva cuenta" con el formulario lleno (oblig.). | OK |
| A6 | En la segunda pestaña (diálogo de moneda aún abierto), elegir "Dólar estadounidense" y "Usar esta moneda". | Alerta "Ya no puedes cambiar la moneda" con "Tu espacio ya tiene movimientos y sus montos están guardados en la moneda actual. Tus datos están a salvo." Al cerrar el diálogo, el Inicio se actualiza y la tarjeta ya no está. La moneda sigue en UYU. Cerrar la segunda pestaña. (HU-9: queda bloqueada y la app dice por qué.) | La alerta. | OK |
| A7 | Crear `Efectivo`: tipo Efectivo, Saldo actual `3000`. | Se crea. Aparece en Cuentas. | | OK |
| A8 | Crear `Visa Itaú`: tipo Tarjeta, "Deuda actual" `4000` (en positivo), "Día de cierre" 5, "Día de vencimiento" 12. | Se crea. Su etiqueta de saldo es "Deuda actual" y pide los dos días ("Con estos días Kanza calcula cuánto pagar cada mes."). La deuda se guarda negativa y se muestra positiva. | Panel de la tarjeta (los días). | OK |
| A8b | (Opcional) Con las tres cuentas creadas y **antes** de sembrar nada, ir al Inicio y mirar los dos gráficos. | Aún no hay historial: la tarjeta del Neto no dibuja el área y dice «Cuando termine tu primer mes, aquí verás cómo evoluciona tu neto.», sin chip de variación y sin «· últimos 6 meses» en la línea de abajo. «Ingresos y gastos» dice «Todavía no hay ingresos ni gastos en estos meses. Cuando registres movimientos, los verás aquí.» | Los dos textos de sin historial. | OK |
| A8c | Sembrar el mes anterior (S1 y S2 de 0.1). "Registrar" > Ingreso, cuenta Banco Itaú (viene preseleccionada), Monto `1000`, categoría "Otros ingresos", descripción `Mes anterior ingreso`, y en el campo de fecha (en el panel de escritorio ya está a la vista; en la hoja de celular se llamaría "Otra fecha") una fecha del mes anterior, por ejemplo el día 10; "Guardar ingreso". Repetir con Gasto, Monto `1000`, categoría "Otros gastos", descripción `Mes anterior gasto`, la misma fecha; "Guardar gasto". | Avisos "Registraste «Mes anterior ingreso»" y "Registraste «Mes anterior gasto»". Banco Itaú sigue en $ 20.000,00: el ingreso y el gasto se compensan en la misma cuenta y Disponible, Deuda y Neto de CP0 no cambian. El mes en curso de Movimientos sigue con 3 movimientos (los saldos iniciales): los dos nuevos están en el mes anterior. | | OK |
| A9 | Mirar el Inicio. (CP0.) | **Neto $ 19.000,00**; **Disponible $ 23.000,00** ("1 banco y efectivo"); **Deuda de tarjetas $ 4.000,00** ("En 1 tarjeta"); el top 5 dice "Aún no registras gastos en {mes}." con "Registrar un gasto"; la tarjeta "Cuentas" lista Banco Itaú, Efectivo y Visa Itaú. Con el mes anterior sembrado en A8c ya hay historial: el chip del Neto dice «+$ 19.000,00 este mes», su área se dibuja (meses anteriores en $ 0,00 y el último en $ 19.000,00) y la línea de abajo dice «Tu disponible menos la deuda de tarjetas · últimos 6 meses»; «Ingresos y gastos» dibuja el mes anterior ($ 1.000,00 de ingresos y $ 1.000,00 de gastos) y el mes en curso aún sin barras. Neto = Disponible − Deuda. | Inicio con cuentas (oblig.). | OK |
| A10 | Ir a "Cuentas". Mirar la lista y el subtítulo; tocar una fila. | Grupo "Disponible" (Banco Itaú $ 20.000,00, Efectivo $ 3.000,00; total $ 23.000,00) y grupo "Deuda" (Visa Itaú $ 4.000,00; total $ 4.000,00). El subtítulo dice "Neto $ 19.000,00 · disponible menos deuda". Al tocar una fila, a la derecha el detalle con "Cuadrar saldo" y "Editar". (HU-13: Neto, Disponible y Deuda iguales a la suma de las cuentas.) | Cuentas con el detalle. | OK |
| A11 | Ir a "Movimientos". | "{Mes} 2026 · 3 movimientos": tres filas de ajuste (los saldos iniciales); el resumen no suma nada: Ingresos $ 0,00 y Gastos $ 0,00. El saldo inicial es un ajuste, no un ingreso ni un gasto. (HU-9.) | | OK |
| A12 | Con el foco fuera de cualquier campo (clic en un espacio vacío de la página), pulsar la tecla `N`. Cerrar con `Escape`. Después, en Movimientos, hacer clic en la caja de búsqueda y escribir `n`. | `N` abre el panel "Registrar movimiento" (el botón "Registrar" de la barra lateral lleva la pista "N"); `Escape` lo cierra. Con el foco en la caja de búsqueda, la `n` se escribe y no abre nada. (HU-11.) | | OK |
| A13 | "Registrar" > Gasto 1: Cuenta Banco Itaú (debe venir preseleccionada), Fecha de hoy, Monto `1550`, Categoría Comida > Supermercado, sin descripción, "Guardar gasto". | El panel "Registrar movimiento" de 440 px con "Tipo", "Monto" grande, "Cuenta" y "Categoría". La fecha por defecto es la de hoy. Aviso "Registraste «Supermercado»". **CP1 en Inicio:** Disponible $ 21.450,00, Deuda $ 4.000,00, Neto $ 17.450,00; top 5: Comida $ 1.550,00 · 100 %. (HU-11: fecha por defecto = hoy.) | Panel de registro lleno (oblig.). | OK |
| A14 | Ir a "Movimientos" (tabla). Mirar la fila y los filtros. | "{Mes} 2026 · 4 movimientos". Tabla con Fecha, Descripción, Categoría (chip Comida), Cuenta y Monto; la fila "Supermercado" dice −$ 1.550,00 y es de hoy. Resumen Gastos −$ 1.550,00. La tarjeta de filtros tiene búsqueda, mes, "Cuenta", "Categoría" y el tipo. | Movimientos con la fila (oblig.). | OK |
| A15 | Editar: clic en «Supermercado» (la descripción de la fila es el enlace; también sirve "Editar Supermercado"). En el panel "Editar movimiento" (el tipo no se cambia), Monto `1200`, "Guardar cambios". | Aviso "Guardaste los cambios de «Supermercado»". La fila dice −$ 1.200,00 y los saldos se recalculan. **CP2 en Inicio:** Disponible $ 21.800,00, Neto $ 17.800,00. (Épica: lo edito; HU-12: editar recalcula saldos.) | Panel "Editar movimiento". | OK |
| A16 | Eliminar: el ícono de papelera de la fila ("Eliminar Supermercado"). Sin esperar, mirar el aviso y el resumen. | Aviso "Eliminaste «Supermercado»" con el botón "Deshacer". La fila sale de la tabla y el resumen de Gastos vuelve a $ 0,00. (CP3; si da tiempo, en Inicio: Disponible $ 23.000,00, Neto $ 19.000,00 y el top 5 vacío "Aún no registras gastos en {mes}".) | El aviso con "Deshacer" (oblig.). | OK |
| A17 | Pulsar "Deshacer" dentro de los 6 s (o `Alt+T` y `Enter`). Ir al Inicio. | La fila vuelve igual: mismo monto $ 1.200,00, misma fecha, cuenta y categoría. **CP4 en Inicio:** Disponible $ 21.800,00, Neto $ 17.800,00, top 5 Comida $ 1.200,00. Si se pasó el tiempo, el movimiento queda eliminado: registrarlo otra vez como gasto 1 con `1200` y anotar "Deshacer" como FALLA solo si el botón no funcionó dentro del plazo. (Épica: lo borro y lo deshago; HU-12.) | Fila restaurada. | OK |
| A18 | Registrar los gastos 2 (`800`, Comida > Restaurantes) y 3 (`800`, Salud > Medicamentos) en Banco Itaú, sin descripción. | Cada uno con su aviso "Registraste «…»" (el título sin descripción es la categoría). **CP5 en Inicio:** Banco Itaú $ 17.200,00, Disponible $ 20.200,00, Deuda $ 4.000,00, Neto $ 16.200,00. | | OK |
| A19 | "Registrar" > Gasto con la cuenta Visa Itaú. Antes de guardar, probar en este orden: (a) "Guardar gasto" sin monto ni categoría; (b) Monto `0`; (c) Monto `-5`; (d) Monto `10,555`. Después Monto `2340,50`, Categoría Comida > Cafés, Descripción `Prueba borrar`, "Guardar gasto". | Los errores salen en español **junto a su campo** y el panel no se cierra: (a) "Escribe un monto." y "Elige una categoría."; (b) "El monto debe ser mayor que 0."; (c) "Escribe el monto sin signo."; (d) "Usa como máximo 2 decimales." Al guardar: aviso "Registraste «Prueba borrar»". **CP6:** la deuda sube exactamente $ 2.340,50: Visa Itaú $ 6.340,50, Disponible $ 20.200,00 (una tarjeta no lo cambia), Deuda $ 6.340,50, Neto $ 13.859,50. (HU-11: decimales de más, cero, negativo, sin categoría; gasto con la Visa sube la deuda.) | Los errores del formulario (oblig.). | OK |
| A20 | Eliminar el gasto 4 ("Eliminar Prueba borrar") y **no** pulsar "Deshacer"; esperar a que el aviso se vaya. Mirar Inicio y Cuentas. | **CP7** (= CP5): Visa Itaú $ 4.000,00, Deuda $ 4.000,00, Neto $ 16.200,00. El gasto eliminado no aparece en Movimientos ni cuenta en el top 5. | | OK |
| A21 | Registrar los gastos 5 (Película), 6 (Remera), 7 (Taxi, cuenta Efectivo) y 8 (Luz, cuenta Visa Itaú) con los datos de 0.1. Al abrir "Registrar" después de usar una cuenta, mirar cuál viene preseleccionada. | La cuenta preseleccionada es la última usada. **CP8 en Inicio:** Banco Itaú $ 16.200,00, Efectivo $ 1.800,00, Visa Itaú $ 7.000,00, Disponible $ 18.000,00, Deuda $ 7.000,00, Neto $ 11.000,00. | | OK |
| A22 | Registrar el ingreso 9: "Registrar" > Ingreso, Banco Itaú, Trabajo > Sueldo, `10000`, descripción `Sueldo`, "Guardar ingreso". | **CP9:** Banco Itaú $ 26.200,00, Disponible $ 28.000,00, Neto $ 21.000,00. El ingreso no aparece en el top 5. | | OK |
| A23 | Registrar la transferencia 10: "Registrar" > Transferencia, "Desde" Banco Itaú, "Hacia" Visa Itaú, `4000`, "Guardar transferencia". | No hay campo de categoría. Aviso "Registraste «Banco Itaú → Visa Itaú»". **CP10:** Banco Itaú $ 22.200,00, Visa Itaú $ 3.000,00, Disponible $ 24.000,00, Deuda $ 3.000,00, **Neto sigue en $ 21.000,00** (suma cero) y los Gastos del mes no cambian. (Épica: pago la tarjeta con una transferencia; HU-11.) | La transferencia en Movimientos (oblig.). | OK |
| A24 | Cuentas > Efectivo > "Cuadrar saldo". En el panel se ve "Saldo en Kanza" $ 1.800,00; escribir `1500` en "Efectivo que tienes"; "Cuadrar saldo". | La vista previa dice «Se registrará un ajuste de −$ 300,00. No cuenta como ingreso ni gasto.» Al cuadrar, Efectivo queda en $ 1.500,00 y en Movimientos aparece una fila de **ajuste** de −$ 300,00 que no suma a Gastos. **CP11:** Disponible $ 23.700,00, Deuda $ 3.000,00, Neto $ 20.700,00. (HU-9: cuadrar registra un ajuste por la diferencia.) | Panel "Cuadrar saldo". | OK |
| A25 | Inicio final. | **Neto $ 20.700,00**, **Disponible $ 23.700,00**, **Deuda de tarjetas $ 3.000,00**, tile "Gastos de {mes}" $ 8.000,00. Son iguales a los totales de "Cuentas" (A10: grupos $ 23.700,00 y $ 3.000,00; subtítulo "Neto $ 20.700,00 · disponible menos deuda"). La tarjeta "Cuentas" muestra las tres con sus saldos. El chip del Neto dice «+$ 20.700,00 este mes» (el mes anterior cierra en $ 0,00); desde el día 15, la tile «Gastos de {mes}» agrega «700 % más que en {mes anterior}» (antes del 15 no hay nota). (HU-13.) | Inicio final, claro (oblig.). | OK |
| A26 | Mirar "Gastos por categoría" (el top 5). | Exactamente 5 filas con nombre, porcentaje y monto en texto, en este orden: Hogar $ 3.000,00 · 38 %; Comida $ 2.000,00 · 25 %; Transporte $ 1.200,00 · 15 %; Salud $ 800,00 · 10 %; Ocio $ 600,00 · 8 %. Cada fila con una barra proporcional a la mayor. **No** aparecen Ropa, Sueldo, la transferencia, el ajuste ni el gasto eliminado, y no hay fila "Otros". Comida suma Supermercado y Restaurantes. (HU-13: ajustes, transferencias y borrados no cuentan en el top 5.) | El top 5 (oblig.). | OK |
| A27 | Tocar la fila "Hogar". Volver al Inicio y pulsar "Ver todas". | La fila lleva a Movimientos con el tipo Gastos y la categoría Hogar: 1 movimiento ("Luz", −$ 3.000,00). "Ver todas" lleva a Movimientos con el tipo Gastos: 7 movimientos, Gastos −$ 8.000,00. (HU-13: "Ver todo" lleva a Movimientos.) | | OK |
| A28 | Mirar las dos tarjetas de gráficos del Inicio: pasar el mouse sobre el último mes y sobre el mes anterior, y recorrerlas con Tab y las flechas. | **Neto:** chip «+$ 20.700,00 este mes»; área de 6 meses con los cinco primeros puntos en $ 0,00 (el mes anterior cierra en $ 0,00: +1.000 y −1.000) y el último en $ 20.700,00; el globo dice el mes y el neto; la línea de abajo, «Tu disponible menos la deuda de tarjetas · últimos 6 meses». **Ingresos y gastos:** subtítulo «Últimos 6 meses · {mes} en curso»; barras en dos meses: el mes anterior con ingresos $ 1.000,00 y gastos $ 1.000,00, y el mes en curso con ingresos $ 10.000,00 y gastos $ 8.000,00; su leyenda. Los dos con el foco visible con el teclado. | Los dos gráficos (oblig.). | OK |
| A29 | En Movimientos, en este orden, pulsando "Quitar filtros" (o "Todos" en el tipo y la opción vacía en los selects) entre un sub-paso y el siguiente, porque los filtros se acumulan en la dirección: (1) tipo "Gastos", luego "Ingresos", luego "Transferencias" y por último "Todos"; (2) "Cuenta" Visa Itaú; (3) quitar eso y "Categoría" Comida; (4) quitar eso y buscar `pelicula`, después `PELÍCULA`; (5) buscar `zzz`; (6) "Quitar filtros" (quita también la búsqueda); (7) cambiar al mes anterior; (8) cambiar a un mes de hace dos meses; (9) volver al mes en curso. | (1) 7, 1 y 1 movimientos, y 13 con "Todos"; (2) 3 (el saldo inicial, "Luz" y el pago); (3) 2 (Supermercado y Restaurantes); (4) 1 fila, "Película", con y sin mayúsculas y acentos (la búsqueda ignora acentos gracias a `unaccent`, migración `0008`); (5) "No hay movimientos con estos filtros" con "Quitar filtros"; (6) vuelven los 13 (el mes se queda); (7) "{Mes anterior} 2026 · 2 movimientos": "Mes anterior ingreso" +$ 1.000,00 y "Mes anterior gasto" −$ 1.000,00, con Ingresos +$ 1.000,00, Gastos −$ 1.000,00 y Te quedan $ 0,00; (8) un mes sin movimientos en un espacio que sí los tiene: "No hay movimientos con estos filtros"; (9) vuelve el listado de 13. El mes y los filtros quedan en la dirección. (HU-12: cambiar de mes y filtrar por tipo; estado sin resultados.) | Resultados de la búsqueda sin acentos. | OK |
| A30 | DevTools > Network. (1) Con "Slow 4G", cambiar a un mes que no se haya abierto. (2) Con "No throttling", abrir "Network request blocking" (menú de tres puntos de DevTools > More tools), activarlo y agregar el patrón `*/api/spaces/*/transactions*`; cambiar a otro mes no abierto y esperar unos segundos (la app reintenta 3 veces antes de rendirse). (3) Quitar el patrón y pulsar "Reintentar". (4) Observación: poner "Offline", cambiar a otro mes no abierto y mirar; volver a "No throttling". | (1) Las filas del mes anterior se quedan en pantalla, atenuadas (la lista queda con `aria-busy`), hasta que llegan las nuevas; no salta a un esqueleto: el esqueleto solo se ve cuando el mes de antes no tenía filas. (2) Con la petición bloqueada sale "No se pudieron cargar tus movimientos" con "Reintentar" (nunca "vacío"). Si en cambio se queda la lista anterior con "No se pudo actualizar la lista" y "Reintentar", anotarlo en Obtenido: no es FALLA si el botón funciona. (3) Al quitar el bloqueo, "Reintentar" carga la lista. (4) **Observación, no bug:** sin red la consulta queda en pausa (el modo de red por defecto de TanStack Query es "online"): no aparece "No se pudieron cargar tus movimientos" ni "Reintentar", la pantalla se queda como en (1) y se completa sola al volver la red. Anotar lo que se vio. (HU-12: estados de carga y error.) | El estado de error. | OK |
| A31 | Cuentas > cada cuenta (Banco Itaú, Visa Itaú, Efectivo): leer la cifra del mes y la tabla de movimientos. | **Banco Itaú:** saldo $ 22.200,00; "Movimiento neto de {mes}" +$ 22.200,00; la tabla con Fecha, Descripción, Categoría, Monto y Saldo después de cada movimiento; la fila más nueva termina en $ 22.200,00. **Visa Itaú:** "Consumos de {mes}" $ 3.000,00 y la columna de deuda termina en $ 3.000,00. **Efectivo:** +$ 1.500,00. "Filtrar" abre la fila de tipos. | Detalle de Banco Itaú (oblig.). | OK |
| A32 | (HU-9) Cuentas > Efectivo > "Editar" > "Archivar cuenta". Pulsar "Entendido". Después crear `Cuenta de prueba` (tipo Efectivo, sin saldo) y, desde su detalle, "Editar" > "Archivar cuenta". Mirar la lista de Cuentas, "Archivadas (1)" y el selector "Cuenta" de "Registrar" (cancelar sin guardar). Luego, en "Archivadas (1)", "Desarchivar Cuenta de prueba" y mirar otra vez la lista y el Inicio; por último, volver a archivar `Cuenta de prueba`. | Efectivo (saldo $ 1.500,00): diálogo "Todavía no puedes archivar Efectivo", que dice "Hoy tiene $ 1.500,00." y cómo seguir (pasar el dinero o cuadrar el saldo en $ 0,00), con "Entendido" y "Cuadrar saldo"; la cuenta sigue activa. `Cuenta de prueba` (saldo 0) se archiva: sale de la lista de Cuentas y del selector de "Registrar" y aparece en "Archivadas (1)" con "Desarchivar". Al desarchivarla vuelve a la lista y al selector (y la tarjeta "Cuentas" del Inicio mostrará 4 filas). **Al terminar queda archivada:** Cuentas muestra 3 activas y "Archivadas (1)". Disponible y Neto no cambian en ningún momento ($ 23.700,00 y $ 20.700,00). | El diálogo "Todavía no puedes archivar" (oblig.). | OK |
| A33 | (HU-10) Categorías: "Agregar subcategoría a Mascotas" > nombre `Veterinario`, elegir un ícono, crear. Abrir "Registrar" y mirar las categorías de gasto (cancelar). Editar `Veterinario`: renombrar a `Veterinaria` y cambiar el ícono. "Archivar Ropa". Abrir "Registrar" y mirar las categorías; mirar la fila "Remera" en Movimientos y el Inicio. "Archivadas (1)" > "Desarchivar" Ropa. | La nueva subcategoría aparece bajo Mascotas y en "Registrar"; el renombre y el ícono nuevo se ven en Categorías y en el registro. Con Ropa archivada: ya no se ofrece en "Registrar", pero "Remera" sigue mostrando su categoría Ropa y los Gastos del Inicio siguen en $ 8.000,00; al desarchivarla vuelve a ofrecerse. Una subcategoría no tiene "Agregar subcategoría" (no hay tercer nivel). | Categorías con la nueva subcategoría. | OK |
| A34 | Cambiar el tema del sistema (o DevTools > Rendering > "Emulate CSS media feature prefers-color-scheme") a oscuro y repasar Inicio, Movimientos, Cuentas (detalle) y el panel "Registrar". Volver a claro. | Mismas pantallas, legibles, sin fondos claros fuera de lugar, comparables con los artboards `K-V2-*` oscuros. | Inicio y Movimientos en oscuro (oblig.). | OK |
| A35 | Ensanchar la ventana a 1440 px (o DevTools "Responsive" 1440 × 900) y repasar Inicio, Movimientos, Cuentas (detalle), Categorías y el panel "Registrar". Con el panel "Registrar" abierto, mirar la tarjeta de filtros de Movimientos. | Como los artboards `K-V2-*` de 1440 px: barra lateral de 240 px, grupo centrado, sin scroll horizontal, tabla sin desplazarse hacia los lados y "Monto" a la vista, panel de 440 px. (Diferencias conocidas de 0.4.) | Movimientos y Cuentas a 1440 px (oblig.). | OK |
| A36 | (HU-7: sesión vencida) Con Movimientos abierto en la pestaña 1, abrir la pestaña 2, entrar a la barra lateral > cuenta del usuario > "Cerrar sesión". Volver a la pestaña 1 y elegir en "Mes" un mes que no se haya abierto antes. | La pestaña 1, que pide datos desde el navegador sin sesión (401), termina en `/login` sin mostrar un error ni datos. Volver a entrar con "Iniciar sesión". | | OK |
| A37 | "Atrás" tras cerrar sesión, con varias pantallas privadas: navegar por Inicio > Movimientos > Cuentas > Categorías > Inicio > Movimientos (6 entradas en el historial). Cuenta del usuario > "Cerrar sesión". Pulsar "atrás" del navegador 7 veces seguidas y luego "adelante" una vez. | Vuelve a `/login`. En ninguna de las pantallas por las que pasa "atrás" se ven datos del usuario (ni montos, ni nombres de cuentas, ni el saludo con su nombre), ni siquiera un instante: o se queda en `/login` o cada pantalla recarga a `/login`. Con "adelante" tampoco. Al terminar, volver a iniciar sesión: la Parte C la necesita. | La pantalla tras "atrás" (oblig.). | OK |
| A38 | (Extra) Revisar la consola y la lista de Network durante todo el recorrido. | Sin errores en rojo en la consola; ninguna petición con estado 5xx. Mostrar solo nombre y estado en Network. | Consola. | OK |

## 2. Parte B: celular (360 a 430 px), en Android (Chrome) y en iPhone (Safari)

Hacer toda la tabla en cada dispositivo, con su propio usuario de 0.1 (alias nuevo) y la moneda de cada uno (Android: UYU; iPhone: CLP). Tiempos: tener la app "caliente" antes de cronometrar (abrir Inicio, Cuentas y Movimientos y esperar a que carguen: Cloud Run con mínimo 0 instancias y Cloud SQL f1-micro tienen arranque en frío). Los montos son los de 0.1 y los puntos de control CP0 a CP11 también (en CLP, sin decimales; ver las notas de 0.1). Las capturas se rotulan con el dispositivo (por ejemplo "B12-android", "B12-iphone").

| N.º | Acción | Resultado esperado | Captura | Android (Chrome) | iPhone (Safari) |
|---|---|---|---|---|---|
| B1 | Abrir la URL sin sesión. En "¿Aún no tienes cuenta?", escribir el alias nuevo y una contraseña de **7** caracteres y pulsar "Crear cuenta". Después una de 8 o más y "Crear cuenta". | Con 7 caracteres, el mensaje en español "Usa al menos 8 caracteres." junto al campo, sin crear nada (el mínimo coincide con la política de Firebase). Con 8 o más queda con sesión y llega al Inicio de primer uso: "Hola, {nombre}" (la parte del email antes del `@`), el grillo, "Empieza por tus cuentas" y "Crear mi primera cuenta", la tarjeta "Moneda de tu espacio" debajo y la barra inferior con Inicio, Movimientos, "+", Cuentas y Más. La barra flotante queda **por encima** de la barra de gestos o del indicador de inicio, sin tapar contenido (safe area). (HU-7: contraseña en español; HU-9: sin cuentas el Inicio invita.) | Inicio de primer uso (oblig.). | OK | OK |
| B2 | Pestaña "Movimientos". Después tocar el "+" de la barra y, tras volver, "Crear mi primera cuenta". | "Aún no tienes movimientos" con el grillo. El "+" abre la página "Nueva cuenta" (sin barra inferior) y "Crear mi primera cuenta" abre el mismo formulario; "Volver" regresa. (HU-9: el "+" lleva al mismo formulario; HU-12: estado vacío.) | | OK | OK |
| B3 | Más > Categorías. Alternar Gastos e Ingresos. | Gastos: 10 principales y 14 subcategorías; Ingresos: 5 y 5; con su ícono, solo dos niveles. Es un espacio nuevo: las sembró el primer login con el backend nuevo. "Volver" lleva a Más. (HU-10.) | Categorías en celular (oblig.). | OK | OK |
| B4 | Inicio > "Cambiar" (hoja inferior). Contar las opciones. **Android:** elegir "Peso uruguayo" y "Usar esta moneda". **iPhone:** elegir `CLP` y "Usar esta moneda". | Hoja con 8 monedas; CLP y PYG solo con el código (ver BUG-1). El Inicio muestra la moneda elegida ("Peso uruguayo · UYU" o "CLP"). La nota dice que se puede cambiar hasta el primer movimiento. (Épica: elijo mi moneda; HU-9.) | La hoja de monedas (oblig.). | OK | OK |
| B5 | Crear `Banco Itaú`: "+" o "Crear mi primera cuenta" > página "Nueva cuenta": Tipo Banco, Nombre, Saldo actual `20000`. Mirar el formulario con el teclado abierto en "Saldo actual". "Crear cuenta". | La página no tiene barra inferior; con el teclado numérico, la barra fija con "Crear cuenta" queda **sobre el teclado** y sobre la safe area, el último campo no queda tapado y la página no hace zoom al enfocar. Al crear, vuelve al Inicio y la tarjeta "Moneda de tu espacio" ya no está (el saldo inicial es un movimiento). | El formulario con el teclado abierto (oblig.). | OK | OK |
| B6 | Crear `Efectivo` (Efectivo, `3000`). | Se crea. | | OK | OK |
| B7 | Crear `Visa Itaú`: Tarjeta, "Deuda actual" `4000`, "Día de cierre" 5, "Día de vencimiento" 12 (selectores del sistema). | Se crea; la etiqueta es "Deuda actual" y los días se eligen con el selector nativo. | | OK | OK |
| B8 | Mirar el Inicio. (CP0.) | Neto 19.000; Disponible 23.000 ("1 banco y efectivo"); Deuda de tarjetas 4.000 ("En 1 tarjeta"); el bloque "Gastos de {mes}" dice "Aún no registras gastos en {mes}." No hay gráficos ni "Últimos movimientos" (solo desde 1024 px) ni chip de variación del Neto: bajo la cifra solo dice «Tu disponible menos la deuda de tarjetas» (el «· últimos 6 meses» es de escritorio). Sin tiles de Pendientes ni Cuotas futuras. En iPhone, con el formato `CLP 19.000`. | Inicio con cuentas (oblig.). | OK | OK |
| B9 | Cuentas: mirar los grupos y tocar "Efectivo"; "Volver". | Grupo "Disponible" ($ 23.000) y grupo "Deuda" ($ 4.000) con sus totales. Tocar una cuenta abre su página (`/cuentas/<id>`) con "Editar" y "Cuadrar saldo"; "Volver" regresa a la lista. | | OK | OK |
| B10 | Tocar el "+" (no guardar nada). Mirar la hoja y la barra inferior; cerrar con "Cerrar". | Se abre la hoja inferior alta ("Registrar movimiento", con asa, título y "Cerrar"), con la pantalla detrás. El botón "Guardar gasto" queda fijo abajo **sobre la safe area**, sin quedar bajo la barra de gestos ni el indicador de inicio. El "+" estaba centrado y sin cortar. | La hoja abierta, con la barra de gestos visible (oblig.). | OK | OK |
| B11 | Abrir el "+" y tocar "Monto"; después "Descripción". Cerrar con "Cerrar". | Con el teclado numérico: "Guardar gasto" visible **sobre el teclado**, el monto y la categoría siguen a la vista, la página no hace zoom al enfocar. Con el teclado de texto: el campo de descripción se ve sobre el teclado. (En iOS la hoja sube con `visualViewport`; en Android el contenido se redimensiona.) | La hoja con el teclado abierto (oblig.). | OK | OK |
| B12 | **Gasto 1, cronometrado.** Cronómetro: empieza al tocar "+" y para cuando aparece el aviso. "+" > Monto `1550` > Comida > Supermercado > "Guardar gasto". La cuenta ya viene en Banco Itaú; no escribir descripción. | Aviso "Registraste «Supermercado»". **Tiempo: no informado; el humano confirmó que fue menor que 10 s.** La fecha por defecto es la de hoy. El aviso queda por encima de la barra inferior y de la safe area. (Épica: gasto con "+" en menos de 10 s.) **CP1 en Inicio** (Disponible 21.450, Neto 17.450). | El aviso sobre la barra inferior (oblig.). | OK (< 10 s) | OK (< 10 s) |
| B13 | Movimientos. | Lista agrupada por día ("Hoy"), con la fila "Supermercado" −$ 1.550,00 (iPhone: −CLP 1.550) en Banco Itaú; el resumen con Ingresos, Gastos y "Te quedan"; el mes con sus flechas; los chips de tipo. El conteo "N movimientos" no se ve en celular (el subtítulo es de escritorio): contar las filas, 4 (los 3 ajustes y el gasto). (Épica: lo veo en Movimientos; HU-12.) | Movimientos en celular (oblig.). | OK | OK |
| B14 | Tocar la fila "Supermercado". En la hoja "Editar movimiento", Monto `1200`. Mirar los botones con el teclado abierto. "Guardar cambios". | Los botones "Eliminar" y "Guardar cambios" caben juntos en una línea a 360 y 375 px y "Guardar cambios" queda **sobre el teclado**. Aviso "Guardaste los cambios de «Supermercado»". **CP2:** Disponible 21.800, Neto 17.800. (Épica: lo edito.) | La hoja de edición con el teclado. | OK | OK |
| B15 | Tocar la fila otra vez > "Eliminar". Sin esperar, mirar el aviso. | Aviso "Eliminaste «Supermercado»" con "Deshacer", sobre la barra inferior (no tapado por ella). La fila sale y el resumen de Gastos vuelve a cero. (CP3.) | El aviso con "Deshacer" (oblig.). | OK | OK |
| B16 | Tocar "Deshacer" dentro de los 6 s. Ir al Inicio. | La fila vuelve igual (1.200, hoy, Banco Itaú, Comida). **CP4:** Disponible 21.800, Neto 17.800, top 5 Comida 1.200 · 100 %. Si se pasó el tiempo, registrarlo otra vez (`1200`) y anotar el hecho. (Épica: lo deshago.) | | OK | OK |
| B17 | **Gastos 2 y 3, cronometrados.** Mismo procedimiento: `800` Comida > Restaurantes; `800` Salud > Medicamentos. | Avisos "Registraste «Restaurantes»" y «Medicamentos». La cuenta viene preseleccionada (la última usada). **Tiempos: no informados; el humano confirmó que fueron menores que 10 s.** **CP5:** Banco Itaú 17.200, Disponible 20.200, Neto 16.200. | | OK (< 10 s) | OK (< 10 s) |
| B18 | "+" > Gasto con la cuenta Visa Itaú. Antes de guardar: (a) "Guardar gasto" sin nada; (b) Monto `0`; (c) Monto `-5` (en iPhone el teclado decimal no tiene el «-»: pegar `-5`, escrito antes en Notas y copiado, o dejar solo este sub-paso como N/P); (d) Android: `10,555`; iPhone (CLP): `2340,50`. Después Android: `2340,50`; iPhone: `2340`; Comida > Cafés; descripción `Prueba borrar`; "Guardar gasto". | Errores en español junto al campo, sin cerrar la hoja: (a) "Escribe un monto." y "Elige una categoría."; (b) "El monto debe ser mayor que 0."; (c) "Escribe el monto sin signo."; (d) Android "Usa como máximo 2 decimales.", iPhone "Esta moneda no usa decimales." Al guardar, **CP6:** la deuda de la Visa sube (Android: $ 6.340,50 y Neto $ 13.859,50; iPhone: CLP 6.340 y Neto CLP 13.860); Disponible no cambia. Tiempo informativo del paso: no informado. (HU-11.) | Los errores del formulario (oblig.). | OK | OK |
| B19 | Eliminar "Prueba borrar" y **no** pulsar "Deshacer". Ver el Inicio. | **CP7** (= CP5): deuda 4.000, Neto 16.200. La fila no aparece en Movimientos ni cuenta en el top 5. | | OK | OK |
| B20 | Registrar los gastos 5, 6, 7 y 8 de 0.1. | **CP8:** Banco Itaú 16.200, Efectivo 1.800, Visa Itaú 7.000, Disponible 18.000, Deuda 7.000, Neto 11.000. Al abrir "+" tras usar una cuenta, esa cuenta es la preseleccionada. | | OK | OK |
| B21 | Registrar el ingreso 9 (Sueldo, `10000`, Trabajo > Sueldo). | **CP9:** Disponible 28.000, Neto 21.000. | | OK | OK |
| B22 | Registrar la transferencia 10: Transferencia, "Desde" Banco Itaú, "Hacia" Visa Itaú, `4000`. | No hay campo de categoría. Aviso "Registraste «Banco Itaú → Visa Itaú»". **CP10:** Disponible 24.000, Deuda 3.000, Neto sigue en 21.000. (Épica: pago la tarjeta con una transferencia.) | La transferencia en Movimientos (oblig.). | OK | OK |
| B23 | Cuentas > Efectivo > "Cuadrar saldo" (hoja inferior): "Efectivo que tienes" `1500`, con el teclado abierto. "Cuadrar saldo". | Se ve "Saldo en Kanza" 1.800 y la vista previa «Se registrará un ajuste de −$ 300,00. No cuenta como ingreso ni gasto.» (iPhone: −CLP 300); el botón queda sobre el teclado. Efectivo queda en 1.500 y en Movimientos aparece el ajuste de −$ 300,00 (iPhone: −CLP 300). **CP11:** Disponible 23.700, Deuda 3.000, Neto 20.700. | La hoja "Cuadrar saldo" con el teclado. | OK | OK |
| B24 | Inicio final. Mirar "Gastos de {mes}" (el top 5), tocar "Hogar", volver al Inicio y tocar "Ver todo". | **Neto 20.700, Disponible 23.700, Deuda de tarjetas 3.000** (iguales a los totales de Cuentas). Top 5, con porcentaje y monto en texto: Hogar 3.000 · 38 %; Comida 2.000 · 25 %; Transporte 1.200 · 15 %; Salud 800 · 10 %; Ocio 600 · 8 %; sin Ropa, sueldo, transferencia, ajuste ni el gasto eliminado. "Hogar" abre Movimientos con Gastos y esa categoría: 1 fila ("Luz"); "Ver todo" abre Gastos con 7 filas. En iPhone, `CLP 23.700`, etc. Comparar con el artboard `K-Inicio` (claro y oscuro). Sin tiles de Pendientes ni Cuotas futuras. (Épica: el Inicio correcto; HU-13.) | Inicio final y el top 5 (oblig.). | OK | OK |
| B25 | Cuentas > Efectivo > "Editar" > "Archivar cuenta". | Hoja "Todavía no puedes archivar Efectivo", con "Hoy tiene 1.500." y cómo seguir (pasar el dinero o cuadrar el saldo en 0), "Entendido" y "Cuadrar saldo"; la cuenta sigue activa. (HU-9: saldo distinto de cero no deja archivar y dice por qué.) | La hoja de "No se puede archivar". | OK | OK |
| B26 | Movimientos > la lupa ("Buscar"). Escribir `pelicula`. Después "Cerrar la búsqueda". | La lupa abre el teclado **en el primer toque** (en iOS puede no abrirlo: si falla, es un fallo a anotar). Sin zoom al enfocar. Mientras el campo tiene el foco, la barra inferior **desaparece** y vuelve al salir, sin saltos de la lista. Con "pelicula" sale la fila "Película" (sin acentos). La tecla "Buscar" confirma y baja el teclado. "Cerrar la búsqueda" quita el filtro. | La búsqueda sin la barra inferior (oblig.). | OK | OK |
| B27 | Movimientos > "Filtrar": elegir Cuenta Visa Itaú y "Ver movimientos"; después "Filtrar" > "Quitar filtros". | La hoja con la lista del sistema para cuenta y categoría, sobre la safe area. Con la Visa salen 3 filas (el saldo inicial, "Luz" y el pago). "Quitar filtros" los quita y deja el mes. | | OK | OK |
| B28 | (Opcional, observación) Con Movimientos abierto, activar el modo avión y cambiar a un mes que no se haya abierto; esperar unos segundos; reactivar la red. | **Observación, no bug:** sin red la consulta queda en pausa: las filas del mes anterior siguen a la vista, atenuadas (o el esqueleto, si ese mes estaba vacío); no aparece "No se pudieron cargar tus movimientos" ni "Reintentar"; al volver la red la lista se completa sola. El estado de error no se puede provocar en el celular sin DevTools: lo cubre A30 en escritorio y los tests `frontend/src/app/movimientos/_components/movements-screen.test.tsx` ("says the same without connection") y `frontend/src/components/movements/movements-states.test.tsx`. (HU-12.) | Lo observado. | Obs.: sin observaciones del humano | Obs.: sin observaciones del humano |
| B29 | Cambiar el tema del sistema a oscuro y repasar Inicio, Movimientos, la hoja "Registrar" y "Cuentas". Volver a claro. | Sin fondos claros fuera de lugar, legible, comparable con los artboards `K-H1-*` y `K-Inicio` oscuros. (HU-8.) | Inicio y hoja en oscuro (oblig.). | OK | OK |
| B30 | Con el "+" abierto, usar "atrás" del sistema: Android, el gesto o el botón; iPhone, el gesto de deslizar desde el borde o el botón de Safari. | La regla de la app es que "atrás" **sale de la pantalla** (no cierra la hoja). Anotar la observación: ¿molesta? `sí / no` y por qué. No se marca FALLA por esto. | | Obs.: sin observaciones del humano | Obs.: sin observaciones del humano |
| B31 | "Atrás" tras cerrar sesión, con varias pantallas privadas: Inicio > Movimientos > Cuentas > una cuenta > Más > Categorías (6 entradas). Avatar > "Cerrar sesión". Pulsar "atrás" 7 veces y "adelante" una vez. En iPhone, probar el botón de Safari **y** el gesto desde el borde izquierdo. (Obligatorio en los dos.) | Vuelve a `/login`. Ninguna pantalla por la que pasa "atrás" muestra datos del usuario (montos, cuentas, saludo con su nombre), ni un instante; o se queda en `/login` o recarga a `/login`. Con "adelante" tampoco. | La pantalla tras "atrás" (oblig.). | OK | OK |
| B32 | (Opcional) iPhone, con el Inicio abierto, girar el teléfono a apaisado. | La barra inferior y el contenido no quedan bajo el notch ni bajo las esquinas redondeadas (safe areas laterales). | Apaisado. | N/P (solo iPhone) | OK |

Notas de la parte B: Android: modelo, versión y Chrome, no informados por el humano · iPhone: modelo y versión de iOS, no informados por el humano.

Tiempos del registro (B12 y B17): el humano informó que los tres gastos cronometrados fueron menores que 10 s en Android y en iPhone; no dio los valores medidos. Criterio: los tres menores que 10 s. Si uno falla, repetir tres más con otros gastos de prueba (que se eliminan sin deshacer) y, si se repite, anotar un bug de severidad Media con los tiempos y si el primer intento fue en frío.

## 3. Parte C: el Inicio a 1440, 1280, 768 y 360 px, claro y oscuro (HU-13)

Con la sesión de escritorio de la Parte A, **volviendo a iniciar sesión primero** (A36 y A37 la cerraron), con los datos finales (CP11 y la siembra de A8c), en Chrome. Para 768 y 360 px usar DevTools en modo "Responsive" (ancho exacto); si el monitor no llega a 1440 px, también. Tema oscuro con el tema del sistema o DevTools > Rendering > "Emulate CSS media feature prefers-color-scheme". Comparar con el lienzo: `K-V2-Escritorio` (1440 y 1280 px), `K-Tablet` (768 px) y `K-Inicio` (360 px).

En todas las celdas debe cumplirse: las cifras son las de CP11 (Neto 20.700, Disponible 23.700, Deuda 3.000, top 5 de A26); desde 1024 px el chip del Neto dice «+$ 20.700,00 este mes» y las dos tarjetas de gráficos están dibujadas como en A28, y bajo 1024 px no hay gráficos, chip ni nota; sin scroll horizontal; sin tiles de **Pendientes** ni de **Cuotas futuras**; legible en los dos temas; y las diferencias conocidas de 0.4 no son fallo.

| Ancho | Qué se ve (como el lienzo) | Claro | Oscuro | Captura |
|---|---|---|---|---|
| 1440 px | Barra lateral de 240 px, el Neto con su chip y su área (cinco meses en $ 0,00 y el último en $ 20.700,00), las tres tiles en columna, "Ingresos y gastos" (barras en el mes anterior y el actual), "Gastos por categoría", "Últimos movimientos" y "Cuentas". | OK | OK | `H1-C1-pc1440-claro.png` y `-oscuro.png` (oblig.) |
| 1280 px | El mismo, con "Últimos movimientos" y "Cuentas" que no se pisan y sin desplazar la columna "Monto". | OK | OK | `H1-C2-pc1280-claro.png` y `-oscuro.png` (oblig.) |
| 768 px | Contenido de columna única centrada de unos 608 px con la barra inferior; el Neto con su cifra de 42 px (sin chip), Disponible, Deuda y el top 5 "Gastos de {mes}" con "Ver todo"; sin gráficos. | OK | OK | `H1-C3-768-claro.png` y `-oscuro.png` (oblig.) |
| 360 px | Dos columnas: el Neto y sus tiles; "Gastos de {mes}" con "Ver todo"; sin gráficos; la barra inferior flotante. | OK | OK | `H1-C4-360-claro.png` y `-oscuro.png` (oblig.) |

## 4. Parte D: cobertura por criterio

"Automatizado" son tests que ya existen en el repo. "Manual" son pasos de esta checklist. Los criterios que no se pueden verificar a mano en staging sin alargar el recorrido o sin datos de otro tamaño llevan el motivo.

### Épica KAN-44 y HU-13 (KAN-55)

| Criterio | Automatizado | Manual en staging |
|---|---|---|
| Elijo mi moneda (sin movimientos) | `backend/tests/api/test_spaces.py`, `backend/tests/api/test_currencies.py`, `backend/tests/db/test_space_currency_concurrency.py`, `frontend/src/components/currency/currency-card.test.tsx` | A4, B4 |
| Creo mi cuenta de banco y mi tarjeta con su saldo actual | `backend/tests/api/test_accounts.py`, `backend/tests/api/test_account_balance_flows.py`, `frontend/src/lib/core/schemas/account.test.ts` | A5, A7, A8, B5, B6, B7 |
| Registro un gasto con "+" en menos de 10 s | `frontend/src/components/movements/movement-form.test.tsx` (la función; el tiempo no se automatiza) | B12, B17 (celular, cronometrado) |
| Lo veo en Movimientos | `backend/tests/api/test_movement_listing_flows.py`, `frontend/src/app/movimientos/_components/movements-screen.test.tsx` | A14, B13 |
| Lo edito, lo borro y lo deshago | `backend/tests/api/test_transactions_mutation.py`, `backend/tests/api/test_movement_edit_flows.py`, `frontend/src/components/movements/use-delete-movement.test.tsx` | A15 a A17, B14 a B16 |
| Pago la tarjeta con una transferencia | `backend/tests/api/test_movement_flows.py`, `backend/tests/api/test_account_balance_flows.py` | A23, B22 |
| El Inicio muestra Disponible, Deuda tarjetas, Neto y el top 5 correctos | `backend/tests/api/test_dashboard.py`, `backend/tests/api/test_home_dashboard_flows.py`, `backend/tests/unit/test_dashboard_top_expenses.py`, `frontend/src/app/_components/dashboard/dashboard-screen.test.tsx` | CP0 a CP11, A9, A25, A26, B8, B24 |
| Neto, Disponible y Deuda iguales a la suma de las cuentas (HU-13) | `backend/tests/api/test_balance_summary.py`, `backend/tests/api/test_dashboard.py` | A10, A25, B24 |
| Top 5 por categoría principal, monto y porcentaje en texto; "Ver todo" lleva a Movimientos (HU-13) | `backend/tests/unit/test_dashboard_top_expenses.py`, `frontend/src/lib/core/dashboard.test.ts` | A26, A27, B24 |
| Ajustes, transferencias y borrados no cuentan en el top 5 (HU-13) | `backend/tests/services/test_transactions_expense_by_category_service.py`, `backend/tests/api/test_home_dashboard_flows.py` | A20, A23, A24, A26, B19, B24 |
| Se ve como el lienzo a 1440, 1280, 768 y 360 px, claro y oscuro, sin tiles de Pendientes ni Cuotas futuras (HU-13) | (no se automatiza: se compara a ojo) | Parte C, A34, A35, B29 |
| Escritorio a 1280 y 1440 px: barra lateral, panel lateral, Movimientos en tabla con filtros, detalle de cuenta, Inicio con dos gráficos | `frontend/src/components/app-shell.test.tsx`, `frontend/src/app/cuentas/_components/accounts-screen.test.tsx` | A1 a A35 (los gráficos: A8b, A8c, A9, A28) |
| El criterio del Hito 1 verificado desde el celular en staging | (es esta sub-tarea) | Parte B completa en Android y en iPhone |

### Lo pedido en la descripción de KAN-86

| Criterio | Automatizado | Manual en staging |
|---|---|---|
| "Atrás" tras cerrar sesión con varias pantallas privadas en el historial (pendiente de `diseno.md`) | `frontend/src/components/bfcache-guard.test.tsx` (jsdom no cubre el navegador real) | A37, B31 (obligatorio en los dos celulares) |
| Safe areas de la barra inferior, el "+" y la hoja | (solo hardware real) | B1, B10, B12, B15 |
| Teclado sobre la hoja | `frontend/src/components/use-keyboard-inset.test.tsx` (la lógica; no el teclado real) | B5, B11, B14, B23, B26 |
| Tiempo del registro (menos de 10 s) | (no se automatiza) | B12, B17 |
| Preparación (Cloud SQL encendida y CD con las migraciones ejecutadas) y cierre (apagar la instancia) | `backend/tests/db/test_migrations.py` y `backend/tests/db/test_unaccent_migration.py` (en BD local) | P0 a P9 y Z1 a Z3 |
| Capturas adjuntas a este ticket; fallos en el formato de bug del proyecto | n/a | 0.3, Registro de capturas y Registro de fallos |

### HU-7 (KAN-49, deuda del Hito 0)

| Criterio | Automatizado | Manual en staging |
|---|---|---|
| Clon limpio y README sin CRLF | `.gitattributes` y el CI (KAN-56) | Fuera de esta tarea: no se verifica en staging, sino en un clon; ya está cerrado en su sub-tarea. |
| El CD no despliega si una migración falla | Probado de verdad en KAN-60 (ver `docs/qa/hito-0-aceptacion-staging.md`, "Prueba real: migración que falla no despliega") | P4 ejerce hoy el camino feliz con 6 migraciones; el camino que falla ya se probó y no se repite en staging. |
| El motivo de contraseña rechazada sale en español y el mínimo coincide con la política de Firebase | `frontend/src/lib/core/schemas/auth.test.ts`, `frontend/src/lib/core/firebase-errors.test.ts` | B1 |
| Una sesión vencida (401) en una pantalla que pide datos desde el navegador lleva a `/login` | `frontend/src/components/providers.test.tsx` | A36 |
| RECURSOS.md refleja staging | n/a | Fuera de esta tarea: infra anota el estado de staging al terminar (migraciones 0003 a 0008 aplicadas y tiempos), ver Riesgos y notas. |
| Pendientes visuales de `diseno.md` verificados o marcados | n/a | Se verifican los que están en el camino (A37 y B31 "atrás", B10 y B12 safe areas, B11 teclado, B26 búsqueda, A12 y B30 "atrás" con hoja); el resto queda marcado como fuera de alcance (Riesgos y notas). `frontend-dev` actualiza las filas de `diseno.md` con lo verificado. |

### HU-8 (KAN-50, lienzo)

| Criterio | Automatizado | Manual en staging |
|---|---|---|
| Las pantallas del Hito 1 están en el lienzo a 1440 y 360 px, claro y oscuro | n/a | Se comparan contra el lienzo: Parte C (Inicio), A34, A35, B24, B29. |
| Las decisiones de `diseno.md` no tienen conflictos abiertos | n/a | Fuera de esta tarea: es una revisión de documentos, no de staging. |

### HU-9 (KAN-51, cuentas)

| Criterio | Automatizado | Manual en staging |
|---|---|---|
| Sin cuentas, el Inicio invita a crear la primera y el "+" lleva al mismo formulario | `frontend/src/app/page.test.tsx` | A1, A5, B1, B2 |
| Elegir moneda (8) con el espacio sin movimientos; después queda bloqueada y la app dice por qué | `backend/tests/api/test_spaces.py`, `backend/tests/db/test_space_currency_concurrency.py` | A4, A5, A6, B4 |
| Banco con saldo y tarjeta con deuda y días; el saldo inicial es un ajuste (no ingreso ni gasto) | `backend/tests/api/test_accounts.py`, `backend/tests/api/test_account_balance_flows.py` | A5, A7, A8, A11, B5 a B7 |
| Cuadrar registra un ajuste por la diferencia | `backend/tests/api/test_account_balance_flows.py`, `backend/tests/db/test_account_reconcile_concurrency.py` | A24, B23 |
| Archivar con saldo 0 la saca de la lista y de los selectores; con saldo distinto de 0 no deja y dice por qué | `backend/tests/api/test_accounts.py`, `backend/tests/db/test_account_archive_concurrency.py` | A32, B25 |
| El usuario B no ve las cuentas de A (404) | `backend/tests/api/test_new_routes_idor.py`, `backend/tests/api/test_routing.py` | Fuera de esta tarea: son pruebas de API (KAN-85). |
| Disponible, Deuda y Neto correctos | `backend/tests/api/test_balance_summary.py` | CP0 a CP11, A10, A25 |

### HU-10 (KAN-52, categorías; ya Completado)

| Criterio | Automatizado | Manual en staging |
|---|---|---|
| Categorías predefinidas de gasto e ingreso, en dos niveles y con ícono, en un espacio nuevo o existente | `backend/tests/api/test_categories.py`, `backend/tests/api/test_default_categories_concurrent_logins.py`, `backend/tests/db/test_categories_migration.py` | A3 (existente), B3 (nuevo) |
| Crear, renombrar, cambiar el ícono o archivar se ve en el registro; una archivada no se ofrece pero los movimientos viejos la conservan | `backend/tests/api/test_categories.py`, `frontend/src/app/categorias/_components/categories-screen.test.tsx` | A33 |
| Sin tercer nivel | `backend/tests/api/test_categories.py` | A33 |
| El usuario B no ve las categorías de A (404) | `backend/tests/api/test_new_routes_idor.py`, `backend/tests/api/test_routing.py` | Fuera de esta tarea: pruebas de API (KAN-85). |

### HU-11 (KAN-53, registrar)

| Criterio | Automatizado | Manual en staging |
|---|---|---|
| El "+" abre el registro: hoja en celular, panel lateral en escritorio | `frontend/src/components/movements/movement-panel.test.tsx` | A13, B10 |
| Un gasto de $ 2.340,50 en Comida con la Visa sube la deuda; toma menos de 10 s | `backend/tests/api/test_movement_flows.py`, `frontend/src/components/movements/movement-form.test.tsx` | A19, B18 (el tiempo del criterio: B12 y B17) |
| La transferencia banco a Visa suma cero, no lleva categoría y no es un gasto | `backend/tests/api/test_movement_flows.py` | A23, B22 |
| Más decimales que la moneda, cero, negativo o gasto sin categoría dan un error en español junto al campo | `frontend/src/lib/core/schemas/movement.test.ts`, `frontend/src/components/movements/movement-form.test.tsx` | A19, B18 |
| La fecha por defecto es hoy en la zona del espacio | `frontend/src/components/movements/movement-form.test.tsx`, `frontend/src/lib/core/dates.test.ts` | A13, B12 (campo "Fecha") |
| En escritorio, `N` fuera de un campo abre "Registrar movimiento" | `frontend/src/components/app-shell.test.tsx`, `frontend/src/components/movements/movement-panel.test.tsx` | A12 |

### HU-12 (KAN-54, ver y editar)

| Criterio | Automatizado | Manual en staging |
|---|---|---|
| Movimientos con el mes actual agrupado por día, Gastado e Ingresado, cambio de mes y filtro por tipo | `backend/tests/api/test_transactions_list.py`, `frontend/src/app/movimientos/_components/movements-screen.test.tsx` | A14, A29, B13 |
| El scroll carga más con cursor | `backend/tests/unit/test_movement_cursor.py`, `backend/tests/api/test_movement_listing_flows.py`, `frontend/src/app/movimientos/_components/load-more.test.tsx` | Fuera de esta tarea: el tamaño de página es 50 (`TRANSACTIONS_PAGE_SIZE`) y el recorrido deja 13 movimientos; probarlo a mano exigiría registrar más de 50. |
| Editar recalcula los saldos | `backend/tests/api/test_transactions_mutation.py` | A15, B14 |
| Borrar muestra "Eliminaste «…»" con "Deshacer" y deshacer lo deja igual | `backend/tests/api/test_movement_edit_flows.py`, `frontend/src/components/movements/use-delete-movement.test.tsx` | A16, A17, B15, B16 |
| Estados vacío, de carga y de error como el lienzo | `frontend/src/components/movements/movements-states.test.tsx`, `frontend/src/app/movimientos/_components/movements-screen.test.tsx` | A2, A29, A30 (el error, con el bloqueo de peticiones de DevTools), B2; B28 es solo una observación: sin red no hay error, la consulta queda en pausa |
| El usuario B no ve los movimientos de A (404) | `backend/tests/api/test_new_routes_idor.py`, `backend/tests/api/test_transactions_mutation.py` | Fuera de esta tarea: pruebas de API (KAN-85). |

## 5. Cierre

| Paso | Comando o acción | Resultado esperado | Resultado |
|---|---|---|---|
| Z1 | `bash infra/scripts/sql_power.sh stop` (con permiso del humano; pide `[s/N]`) | La instancia se apaga (en el Hito 0 tardó menos de un minuto). Si se olvida, genera costo (unos USD 10 a 15 al mes encendida). | OK: `sql_power.sh stop` dijo "Instancia apagada", tardó 40 s, `fallos=0`; política `NEVER`. |
| Z2 | `bash infra/scripts/sql_power.sh status` | Muestra `Estado: STOPPED · política: NEVER` y "APAGADA". | OK (stop con política NEVER, `fallos=0`; el humano no corrió `status` por separado). |
| Z3 | Adjuntar las capturas y el comentario de resultados (con el enlace a esta checklist y el Registro de fallos) al ticket KAN-86 en Jira. | Criterio de aceptación "capturas adjuntas a este ticket" cumplido. | OK con excepción: sin capturas por decisión del humano (excepción al criterio de Jira "Capturas adjuntas a este ticket"); el comentario de resultados en KAN-86 lo publicará `jira-manager`. |

Al apagar la instancia, las migraciones futuras se omiten hasta volver a encenderla y relanzar el CD (`gh workflow run cd-staging.yml --ref main`).

## 6. Riesgos y notas para quien ejecuta

- **Primera vez de las migraciones 0003 a 0008 en staging.** Una sola transacción de Alembic: si la `0008` falla (por ejemplo, el permiso de `CREATE EXTENSION`), la BD sigue en `0002`, el CD queda en rojo y no se despliega nada; el recorrido no se puede hacer (bug Bloqueante). `finance_app` es miembro de `cloudsqlsuperuser` y `unaccent` es una extensión de confianza de PostgreSQL 16, así que se espera que funcione. Cualquier arreglo manual requiere la decisión del humano.
- **Backend y frontend se despliegan por separado.** Vercel publica cada merge; el backend solo con el CD. P0b y P4 los alinean.
- **Arranque en frío.** Cloud Run (mínimo 0 instancias) y la conexión a Cloud SQL f1-micro hacen lento el primer pedido. Calentar (P8 y navegar antes de cronometrar) y anotar si un tiempo largo fue en frío.
- **El aviso "Deshacer" dura unos 6 s.** Si se pierde, el movimiento queda eliminado y no hay papelera: registrarlo otra vez y repetir el "Deshacer" con otro movimiento de prueba.
- **Borde de mes y zona horaria.** El mes y "hoy" salen de la zona horaria del espacio (la del dispositivo en el primer login). No ejecutar cerca de un cambio de mes ni de medianoche.
- **Costo de la BD.** Encendida unas 4 a 5 h cuesta menos de USD 0,10; olvidarla encendida, unos USD 10 a 15 al mes (hay alerta de presupuesto a USD 20).
- **Staging queda con datos de prueba** (usuario de escritorio y dos alias nuevos con cuentas y movimientos). No se borran; los datos de staging son desechables, como en el Hito 0. Usuarios usados: no informados por el humano.
- **Fuera de alcance de esta checklist** (sin dispositivo o con su propio ticket): VoiceOver y TalkBack, iPad y tablet táctil, vidrio ("glass") en Safari 16.4 a 17 y Android de gama baja, `prefers-reduced-transparency`, y comparar 375, 393 y 430 px contra el lienzo.
- **Seguimientos al terminar** (otro agente o PR, no esta tarea): `frontend-dev` actualiza las filas de `frontend/docs/diseno.md` (Atrás tras cerrar sesión, Registrar movimiento, Editar y borrar, Búsqueda y filtros, safe areas) con lo verificado; infra anota en `infra/RECURSOS.md` el estado de staging tras esta prueba (migraciones 0003 a 0008 aplicadas, tiempos de encendido y de ejecución del job).
- **No capturar secretos** (ver 0.3).

## 7. Resultado global

Ejecutada el 14/11/2026 por el humano. Todos los pasos dieron OK; el único hallazgo es BUG-1 (Baja, confirmado en el iPhone). No se adjuntaron capturas, por decisión del humano (excepción al criterio de Jira "Capturas adjuntas a este ticket").

| Parte | Resultado |
|---|---|
| Preparación (P0 a P9) | OK |
| A: escritorio 1280 y 1440 px | OK |
| B: Android (Chrome) | OK |
| B: iPhone (Safari) | OK |
| C: anchos del Inicio | OK |
| Cronometraje (3 de 3 menores que 10 s) | Android `OK (< 10 s)` · iPhone `OK (< 10 s)` |
| "Atrás" tras cerrar sesión (A37, B31) | Escritorio `OK` · Android `OK` · iPhone `OK` |
| Observaciones (B28 sin red, B30 "atrás" con la hoja abierta) | Sin observaciones del humano |
| Capturas adjuntas a KAN-86 | No se adjuntaron (decisión del humano) |
| Cierre (Z1 y Z2, apagado de la BD) | OK: `sql_power.sh stop` con "Instancia apagada" en 40 s y `fallos=0`; política `NEVER` (el humano no corrió `status` por separado) |
| Cierre (Z3, comentario en Jira) | Sin capturas por decisión del humano; el comentario de resultados lo publicará `jira-manager` |

## 8. Registro de capturas

| Paso | Qué muestra | Archivo | Dispositivo y tema |
|---|---|---|---|
| (todos) | No se adjuntaron capturas: la aceptación se aprobó sin ellas por decisión del humano (14/11/2026). Es una excepción al criterio de Jira "Capturas adjuntas a este ticket". | n/a | n/a |

## 9. Registro de fallos

Formato de bug del proyecto (un bloque por fallo):

```
BUG: <título corto>
Dónde: <endpoint / pantalla / archivo:línea si lo sabes>
Pasos para reproducir: 1. … 2. … 3. …
Esperado: <según el criterio de aceptación>
Obtenido: <lo que pasa realmente, con el error textual>
Severidad: Bloqueante | Alta | Media | Baja
Test que lo demuestra: <nombre del test o "manual">
```

**BUG-1 (CONFIRMADO en el iPhone, paso B4, el 14/11/2026; surgió de la lectura de código):**

```
BUG: El selector de moneda ofrece CLP y PYG sin nombre
Dónde: pantalla Inicio > tarjeta "Moneda de tu espacio" > "Cambiar" (frontend/src/components/currency/currency-picker.tsx; nombres en frontend/src/lib/core/i18n.ts CURRENCY_NAMES; formato en frontend/src/lib/core/locale.ts CURRENCY_LOCALES). La migración 0001 siembra 8 monedas: UYU, COP, USD, ARS, BRL, EUR, CLP y PYG.
Pasos para reproducir: 1. Entrar con un espacio sin movimientos. 2. En el Inicio, pulsar "Cambiar" en "Moneda de tu espacio". 3. Mirar la lista de monedas. 4. Elegir CLP y ver un monto formateado.
Esperado: las 8 monedas con su nombre (como "Peso uruguayo · UYU") y montos con un formato propio de cada una (HU-9: elegir moneda).
Obtenido: confirmado en el iPhone: el selector de moneda muestra CLP y PYG solo con el código, sin nombre. Según el código, el frontend solo conoce 6 nombres y 6 formatos (los montos de CLP salen con el código ISO, "CLP 1.550", en el formato de es-UY).
Severidad: Baja
Test que lo demuestra: manual (B4, iPhone; confirmado)
```

**Fallos encontrados en esta prueba:** solo BUG-1 (Baja, confirmado en el iPhone). Ningún otro fallo.
