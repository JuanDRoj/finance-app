# Aceptación del Hito 0 en staging (KAN-30, QA-02)

Checklist manual para verificar, desde el celular y desde escritorio, el criterio de terminado del Épico KAN-1:

> Desde el celular abro la URL de staging, inicio sesión y veo "Hola, {nombre}, tu espacio es Mi espacio". Un PR mergeado llega solo a staging.

Cubre HU-2 (KAN-3), HU-3 (KAN-4), HU-4 (KAN-5) y HU-5 (KAN-6). Lo ejecuta el humano; las capturas se adjuntan al ticket KAN-30 en Jira.

- URL de staging: `https://kanza-stg.vercel.app` (alias fijo de Vercel; el Production de Vercel hace de staging).
- Backend: servicio `finance-api-stg` de Cloud Run, proyecto `kanza-stg`, región `southamerica-east1`.
- Enlace a las capturas y al comentario de resultados en Jira (KAN-30): `________________________________`
- Fecha de la prueba: `____ / ____ / ________` · Quién la ejecuta: `________________`

Cada comando que toca la nube (GCP, Firebase, Vercel) se ejecuta con permiso explícito del humano, de uno en uno. Nada de esto se hace contra producción.

## 0. Antes de empezar

### 0.1 Datos de prueba

| Dato | Qué usar |
|---|---|
| Cuenta de email (registro) | Un email nuevo, que no exista en Firebase staging, con contraseña de 8 o más caracteres. Usa solo un alias propio, por ejemplo `<tu-usuario>+kanza-h0@gmail.com` para Android y `<tu-usuario>+kanza-h0-ios@gmail.com` para iPhone (cada dispositivo registra su propia cuenta; escritorio puede usar otro alias, por ejemplo `+kanza-h0-pc`). Sin una cuenta nueva no hay "primer login". |
| Cuenta de Google (primer login con Google) | Una cuenta de Google que **nunca haya entrado a staging**. No se borra nada en Firebase para repetir la prueba. Una cuenta de Google solo hace "primer login" una vez: si tienes dos cuentas de Google nuevas, usa una en Android y otra en iPhone. Si solo tienes una, úsala en el primer dispositivo; en el segundo, A9 es un login de una cuenta ya existente (sigue valiendo para el popup, y entonces se anota que no fue "primer login"). |
| Aviso: no reutilizar emails | No uses como cuenta de Google un email que ya esté registrado por email (ni al revés). Firebase tiene una cuenta por email y rechaza el registro con "Ya existe una cuenta con ese correo" (visto en KAN-11). Las cuentas de prueba de KAN-11 y la cuenta de Google propia del humano ya existen en staging: no son "primer login". |
| Celular | Dos dispositivos: Android con Chrome y iPhone con Safari. Los dos son obligatorios. Navegador sin sesión previa en staging (o ventana privada). |
| Escritorio | Chrome con la ventana a 1280 px de ancho y DevTools disponibles. |
| Diseño de referencia | El lienzo de Kanza (lo tiene el humano; no está en el repo). Artboards: "Inicio con aviso del grillo" (360 px), "Inicio en tablet (768 px)" e "Inicio en escritorio" (1440 px, claro y oscuro). Detalle en `frontend/docs/diseno.md`, decisión D17. Kit de marca en `~/kanza-marca`. |

### 0.2 Preparación (Cloud SQL y migraciones)

Cloud SQL (`finance-db-stg`) está apagada por defecto. Sin ella `POST /auth/session` falla y no hay login posible. Cada comando, con permiso del humano:

| Paso | Comando | Resultado esperado | Resultado |
|---|---|---|---|
| P1 | `bash infra/scripts/sql_power.sh start` | La instancia queda encendida (`RUNNABLE` / `ALWAYS`). Puede tardar unos minutos. | OK / FALLA |
| P2 | `gh workflow run cd-staging.yml --ref main` y luego `gh run list --workflow cd-staging.yml --limit 3` | Corrida `workflow_dispatch` en verde. | OK / FALLA |
| P3 | `gh run view <id de la corrida de P2>` y abrir el resumen del job en GitHub | El resumen muestra las migraciones **ejecutadas** (ejecución del job `finance-migrate-stg` terminada bien con la imagen del commit), **no** la anotación "Migraciones omitidas". Captura del resumen. | OK / FALLA |

Por qué P2: las corridas anteriores del CD se hicieron con Cloud SQL apagada y omitieron las migraciones. Ésta es la primera vez que se ejercita el paso `jobs execute` con el rol `run.developer` del deployer (pendiente anotado en `infra/RECURSOS.md`, fila "D3 de KAN-16", nota (b)). Si P3 falla por permisos, se anota ahí y se reporta como bug.

Al terminar toda la prueba, apagar la instancia (ver 5. Cierre).

### 0.3 Pendientes de hardware que esta prueba cierra

La parte A se hace dos veces, una en Android (Chrome) y otra en iPhone (Safari). Cada tabla de la parte A tiene una columna de resultado por dispositivo. Dos pasos son obligatorios en **los dos** dispositivos, porque son pendientes de hardware anotados en `frontend/docs/diseno.md` y `frontend/CLAUDE.md` que no se pueden probar con jsdom ni con Playwright:

- A9: que el primer toque de "Continuar con Google" abra el popup sin `auth/popup-blocked` (en iPhone Safari el SDK carga un iframe antes de abrirlo, y un toque muy temprano podría bloquearse).
- A7: que, tras "Cerrar sesión", volver atrás no deje ver datos del usuario (`BfcacheGuard`, capa 3 de "atrás"). En iPhone probar el botón atrás de Safari y el gesto de deslizar desde el borde izquierdo.

Si alguno de los dos falla en un dispositivo, es un bug (no "no probado"): se reporta con el formato de bug del proyecto.

Popup de Google: Android `OK / FALLA` · iPhone `OK / FALLA` · `BfcacheGuard` / atrás sin datos: Android `OK / FALLA` · iPhone `OK / FALLA`

## 1. Parte A: celular (360 a 430 px), en Android (Chrome) y en iPhone (Safari)

Hacer toda la tabla en cada dispositivo, con su propia cuenta de email nueva (ver 0.1), y marcar la columna de ese dispositivo. El paso A9 usa la cuenta de Google nueva. Las capturas se rotulan con el dispositivo (por ejemplo "A4-android", "A4-iphone").

| N.º | Acción | Resultado esperado | Captura | Android (Chrome) | iPhone (Safari) |
|---|---|---|---|---|---|
| A1 | Abrir `https://kanza-stg.vercel.app/` sin sesión. | Redirige a `/login`. Se ve la marca Kanza, el grillo y el formulario. | Pantalla de login. | OK / FALLA | OK / FALLA |
| A2 | Con una pestaña nueva y sin cookie, abrir otra ruta privada. Hoy la única ruta privada es `/`; si ya hay más, probarlas todas. | Cada una redirige a `/login`. | Pantalla de login tras el intento. | OK / FALLA | OK / FALLA |
| A3 | Registro con email: tocar "¿Aún no tienes cuenta?", escribir el email nuevo y la contraseña, y pulsar "Crear cuenta". | Queda con sesión iniciada y llega al inicio (`/`). | Inicio tras el registro. | OK / FALLA | OK / FALLA |
| A4 | Mirar el saludo del inicio. | Dice "Hola, {nombre}, tu espacio es Mi espacio". Para un registro por email, `{nombre}` es la parte del email antes del `@` (por ejemplo, `<tu-usuario>+kanza-h0`), porque el registro por email no pide nombre. | Saludo completo. Es la captura principal del Épico KAN-1. | OK / FALLA | OK / FALLA |
| A4b | En el mismo navegador y con sesión, abrir `https://kanza-stg.vercel.app/api/spaces` (escribirla en la barra de direcciones). La ruta pasa por el rewrite de Next al backend y la cookie viaja sola, porque es el mismo origen. | Aparece un JSON con **un solo elemento**: `name` "Mi espacio", `currency.code` "UYU" (con `currency.exponent` 2) y `timezone` igual a la zona horaria del dispositivo (por ejemplo `America/Montevideo`). Un segundo elemento, otro `name` o otra zona es FALLA. | Solo el JSON (sin la barra de otras pestañas ni otros datos). | OK / FALLA | OK / FALLA |
| A5 | Recargar la página; después cerrar el navegador por completo y volver a abrir la URL. | Sigue dentro en las dos ocasiones, sin pasar por `/login`. | Inicio tras recargar. | OK / FALLA | OK / FALLA |
| A6 | Tocar el avatar (botón "Menú de la cuenta") y elegir "Cerrar sesión". | Vuelve a `/login`. | Menú abierto y login posterior. | OK / FALLA | OK / FALLA |
| A7 | Con el botón atrás del navegador, intentar volver al inicio. | No se ven datos del usuario: se queda en login (o la página se recarga a login). **Obligatorio en Android y en iPhone** (pendiente de hardware de `BfcacheGuard`). En iPhone probar el botón atrás y el gesto de deslizar desde el borde. | Pantalla tras "atrás". | OK / FALLA | OK / FALLA |
| A8 | Entrar de nuevo con el mismo email ("Iniciar sesión"). | Mismo saludo "Hola, {nombre}, tu espacio es Mi espacio". (La pantalla solo muestra el primer espacio: que no haya un segundo se comprueba en A8b.) | Saludo tras el segundo login. | OK / FALLA | OK / FALLA |
| A8b | Repetir `https://kanza-stg.vercel.app/api/spaces` tras este segundo login. | Sigue habiendo **un solo elemento**, con el mismo `id`, `name` "Mi espacio", `currency.code` "UYU" y la misma `timezone` que en A4b. Un segundo espacio o un `id` distinto es FALLA. | Solo el JSON. Anotar el `id` de A4b y de A8b: `__________` / `__________`. | OK / FALLA | OK / FALLA |
| A9 | Cerrar sesión y pulsar "Continuar con Google" con la cuenta de Google nueva (primer login de esa cuenta). **Obligatorio en Android y en iPhone** (pendiente de hardware del popup). | El popup abre al primer toque, sin error de popup bloqueado; al terminar llega al inicio con el saludo. `{nombre}` es el nombre de la cuenta de Google; si la cuenta no tiene nombre, es la parte del email antes del `@`. | Popup abierto y saludo posterior. | OK / FALLA | OK / FALLA |
| A9b | Con la sesión de Google, abrir `https://kanza-stg.vercel.app/api/spaces`. | Un solo elemento, `name` "Mi espacio", `currency.code` "UYU" y `timezone` del dispositivo (es otro usuario, por eso es otro espacio que el de A4b). | Solo el JSON. | OK / FALLA | OK / FALLA |
| A10 | (Extra) En "Iniciar sesión", escribir una contraseña incorrecta. | Mensaje de error en español y sin sesión. | Mensaje de error. | OK / FALLA | OK / FALLA |
| A11 | Comparar el inicio con el artboard "Inicio con aviso del grillo" (360 px): encabezado plano, avatar de 44 px estilo tile, sin scroll horizontal. Hacerlo en tema claro y oscuro (cambia el tema del sistema). | Coincide con el lienzo en los dos temas, salvo lo que está fuera de alcance (ver la nota de abajo). | Una captura por tema. | OK / FALLA | OK / FALLA |

Notas de la parte A: Android: modelo y versión `________________`, Chrome `________` · iPhone: modelo y versión de iOS `________________`.

**Fuera de alcance (Hito 1): no marcar como FALLA.** Los artboards del lienzo incluyen elementos que todavía no existen en la app: la barra de navegación inferior, el botón "+", el espacio ("Mi espacio") en el encabezado, las secciones Movimientos, Pendientes y Cuentas, y Ayuda y Ajustes en la barra lateral. Hoy el encabezado trae el título "Inicio" y el avatar, y la barra lateral solo trae el logo y el ícono de Inicio (decisión D17 de `frontend/docs/diseno.md`, fila de pendientes de Hito 1). Si faltan, se anotan como "Hito 1" y no cuentan.

## 2. Parte B: escritorio a 1280 px (Chrome)

Misma URL. Se puede usar otra cuenta de email nueva para repetir el registro, o la misma para repetir el login.

| N.º | Acción | Resultado esperado | Captura | Resultado |
|---|---|---|---|---|
| B1 | Repetir los pasos A1 a A9b en escritorio (A7 "atrás" con el botón del navegador). | Mismos resultados que en el celular. | Login, saludo y recarga. | OK / FALLA |
| B2 | Con sesión iniciada en el inicio, mirar el borde izquierdo. Pasar el mouse (o llegar con Tab) al ícono de Inicio. | Barra lateral visible: tarjeta flotante oscura de 76 px con el logo y el ícono de Inicio. Aparece el globo "Inicio". | Barra con el globo. Compararla con el artboard de escritorio del lienzo, claro y oscuro (sin contar lo fuera de alcance de la nota de la parte A: botón "+", secciones, Ayuda y Ajustes). | OK / FALLA |
| B3 | Abrir el menú del avatar ("Menú de la cuenta") en el encabezado. | Se ven nombre, correo y "Cerrar sesión". El avatar es de 48 px. Al abrir el menú no hay salto de layout por la barra de scroll. | Menú abierto. | OK / FALLA |
| B4 | Elegir "Cerrar sesión" desde el menú. Después pulsar atrás en el navegador. | Vuelve a `/login`. Con "atrás" no se ven datos del usuario. | Login y pantalla tras "atrás". | OK / FALLA |
| B5 | Volver a entrar y, en DevTools, abrir Application > Cookies > `https://kanza-stg.vercel.app`. | Existe la cookie `__Host-session` con HttpOnly marcado, Secure marcado, SameSite `Lax`, Path `/`, Domain `kanza-stg.vercel.app` (cookie de host, sin punto inicial; el prefijo `__Host-` obliga a que la cookie no traiga el atributo Domain, y Chrome DevTools muestra el host) y `Expires` a unos 14 días. | Solo la fila de atributos de la cookie (no copiar su valor). | OK / FALLA |
| B6 | En DevTools > Network, mirar `POST /api/auth/session` durante el login y `DELETE /api/auth/session` al cerrar sesión. | Los dos responden 204. Tras cerrar sesión la cookie `__Host-session` desaparece de Application > Cookies. **No abrir la pestaña Payload (ni Request) de `POST /api/auth/session`: lleva el ID token.** | Solo la lista de Network con nombre y estado (204), y Cookies vacía. | OK / FALLA |
| B7 | (Extra) Revisar la consola de DevTools durante el flujo. | Sin errores en rojo. | Consola. | OK / FALLA |

## 3. Parte C: despliegue automático (HU-5)

Evidencia de "un PR mergeado llega solo a staging" y de "menos de 15 minutos". Son lecturas; las de GCP, con permiso del humano.

**Por qué `main` HEAD no coincide con lo desplegado.** El backend se despliega con el workflow `.github/workflows/cd-staging.yml`, que solo dispara con un push a `main` que cambie archivos de `paths` (`backend/**`, el propio workflow, `infra/scripts/cd_deploy.sh`, `infra/env/staging.env`, `infra/scripts/lib.sh` e `infra/scripts/lib_sql.sh`) o a mano con `workflow_dispatch`. Al escribir esta checklist, `main` HEAD era `88bf034` (#54, cambió el rol del deployer y `wif-smoke.yml`, fuera de `paths`) y el último commit que tocó esos archivos era `e056bcb` (#53, KAN-16). Por eso la revisión desplegada debe llevar el SHA de `e056bcb` y no el de `88bf034`: no es un fallo. Para elegir el commit esperado en cualquier momento:

```
git log -1 --format='%H %s' -- backend .github/workflows/cd-staging.yml infra/scripts/cd_deploy.sh infra/env/staging.env infra/scripts/lib.sh infra/scripts/lib_sql.sh
```

El frontend se despliega aparte: la integración Git de Vercel publica el Production (staging) en cada merge a `main`. No pasa por el CD de GitHub, no tiene `git-sha` en Cloud Run y se confirma en el dashboard de Vercel (el despliegue de Production corresponde al commit de `main`).

Si cambian `main` o los archivos de `paths` después de escribir esto, el commit esperado cambia: usar el comando de arriba, no el SHA citado.

| N.º | Acción | Resultado esperado | Captura | Resultado |
|---|---|---|---|---|
| C1 | `gh run view 39051916679` (o `gh run list --workflow cd-staging.yml --limit 10`). Es la corrida `push` del merge de #53 (KAN-16). | Corrida `push` en verde sobre `e056bcb9b03c2e125ef8ec267163bafb22aa94ab`, de 2m7s (17:01:11 a 17:03:18 UTC del 17/10/2026). Anotó "Migraciones omitidas" porque Cloud SQL estaba apagada. | Página de la corrida. | OK / FALLA |
| C2 | Contrastar con el SHA esperado: el comando `git log -1` de arriba. | Devuelve `e056bcb9...`, el mismo SHA que la corrida de C1. | Salida del comando. | OK / FALLA |
| C3 | Lectura de Cloud Run (con permiso): `gcloud run services describe finance-api-stg --project=kanza-stg --region=southamerica-east1 --format='value(metadata.labels.git-sha,status.traffic)'` | La etiqueta `git-sha` es el SHA del commit esperado (o el de una corrida posterior del CD que lo haya sustituido, por ejemplo la de P2, que despliega `main` HEAD de ese momento); el tráfico está al 100 % en una sola revisión. | Salida del comando (no incluye secretos). | OK / FALLA |
| C4 | Lectura del job de migraciones (con permiso): `gcloud run jobs executions list --job=finance-migrate-stg --project=kanza-stg --region=southamerica-east1 --limit=3` | Aparece la ejecución de la corrida P2 terminada bien (1 tarea completada). | Salida del comando. | OK / FALLA |
| C5 | Tiempos del CD: `gh run list --workflow cd-staging.yml --limit 10` | Del merge a la revisión nueva, menos de 15 minutos. Datos medidos al 17/10/2026: `push` de #53 en 2m7s; `workflow_dispatch` 39052170185 en 1m18s (17:04:41 a 17:05:59 UTC) y 39052732488 en 1m27s (17:12:28 a 17:13:55 UTC). El workflow además tiene `timeout-minutes: 15`. | Lista de corridas con su duración. | OK / FALLA |
| C6 | `bash infra/scripts/vercel_check.sh` (solo HTTP público). | `RESUMEN: pasan=9 avisos=0 fallos=0`. Ejecutado el 17/10/2026 al preparar este documento: pasó con esas cifras. | Resumen del script. | OK / FALLA |

## 4. Cobertura por criterio

"Automatizado" son tests que ya existen en el repo. "Manual" son pasos de esta checklist. Los criterios sin test están marcados.

| Criterio | Automatizado | Manual en staging |
|---|---|---|
| HU-2: me registro con email o con Google y quedo con sesión y llego al inicio | `backend/tests/api/test_auth_session.py::test_login_sets_the_cookie_and_creates_the_user_and_the_personal_space` · `backend/tests/emulator/test_auth_session_emulator.py::test_a_real_sign_up_gets_a_session_cookie_that_firebase_accepts` | A3, A9 (Android e iPhone), B1 |
| HU-2: con sesión, recargo o vuelvo antes de 14 días y sigo dentro | `backend/tests/api/test_auth_session.py::test_local_cookie_is_httponly_lax_not_secure_and_lasts_fourteen_days` | A5, B5 (`Expires`) |
| HU-3: primer login crea un único "Mi espacio" con UYU y la zona horaria del navegador | `backend/tests/api/test_auth_session.py::test_login_sets_the_cookie_and_creates_the_user_and_the_personal_space` · `backend/tests/services/test_spaces_service.py::test_first_call_creates_the_personal_space_with_an_owner_membership` · `backend/tests/emulator/test_auth_spaces_flow.py::test_first_login_creates_one_personal_space_visible_through_the_api` · `frontend/src/app/login/_components/login-form.test.tsx` (el login envía `id_token` y la zona horaria del dispositivo a `POST /auth/session`) | A4b, A9b: `GET /api/spaces` muestra `name` "Mi espacio", `currency.code` "UYU" y la `timezone` del dispositivo real (iPhone y Android); lo que ve el usuario en A4 y A9 es solo el saludo |
| HU-3: segundo login, o dos simultáneos, no crean otro espacio | `backend/tests/api/test_auth_session.py::test_a_second_login_is_idempotent_and_keeps_the_first_timezone` · `backend/tests/services/test_spaces_service.py::test_second_call_changes_nothing_and_keeps_the_original_timezone` · `backend/tests/api/test_auth_concurrent_login.py::test_parallel_first_logins_through_http_leave_one_space` · `backend/tests/db/test_first_login_concurrency.py::test_two_simultaneous_first_logins_leave_one_user_one_space_one_owner` · `backend/tests/emulator/test_auth_spaces_flow.py::test_a_second_real_sign_in_keeps_one_space_and_its_timezone` · `frontend/src/app/login/_components/login-form.test.tsx` (el login envía `id_token` y la zona horaria del dispositivo a `POST /auth/session`) | A8b: un solo elemento y el mismo `id` tras el segundo login |
| HU-3: en el inicio veo "Hola, {nombre}, tu espacio es Mi espacio" | `frontend/src/app/page.test.tsx` · `backend/tests/emulator/test_auth_spaces_flow.py::test_me_and_spaces_feed_the_home_greeting` | A4, A9 (Android e iPhone), B1 |
| HU-4: al cerrar sesión vuelvo al login y la cookie desaparece | `backend/tests/api/test_auth_session.py::test_logout_clears_the_cookie_with_204` · `...::test_logout_clears_the_host_prefixed_cookie_with_the_secure_flag` · `backend/tests/emulator/test_auth_spaces_flow.py::test_logout_clears_the_cookie_and_the_client_is_logged_out` · `...::test_logout_revokes_the_session_in_firebase_so_the_old_cookie_is_401_invalid_session` · `frontend/src/components/use-logout.test.tsx` · `frontend/src/components/user-menu.test.tsx` · `frontend/src/components/bfcache-guard.test.tsx` | A6, A7 (Android e iPhone, obligatorio), B4, B6. "Atrás" sin datos y `BfcacheGuard` no se pueden probar en jsdom ni Playwright: solo en hardware |
| HU-4: sin sesión, cualquier página privada redirige al login | `frontend/src/proxy.test.ts` | A1, A2 |
| HU-4: el usuario B que pide el espacio de A recibe 404 | `backend/tests/api/test_space_access.py::test_user_b_gets_404_on_the_space_of_user_a` · `backend/tests/api/test_spaces.py::test_user_b_gets_404_on_the_space_of_user_a` · `backend/tests/emulator/test_auth_spaces_flow.py::test_user_b_gets_404_on_the_space_of_user_a_with_real_sessions` · `backend/tests/api/test_routing.py::test_every_space_route_of_the_api_requires_space_membership` | No aplica (cubierto por tests) |
| Cookie `__Host-session` con HttpOnly, Secure y SameSite=Lax | `backend/tests/api/test_auth_session.py::test_cookie_is_host_prefixed_and_secure_outside_local` | B5 (DevTools en staging real) |
| El origen no permitido no abre sesión | `backend/tests/api/test_auth_session.py::test_a_disallowed_origin_is_a_403_and_does_nothing` · `...::test_the_staging_origin_is_the_only_one_allowed_there` | C6 (`vercel_check.sh`) |
| HU-5: un PR mergeado llega a staging en menos de 15 minutos, con migraciones antes | Sin test posible (es el workflow). | P2, P3, C1 a C5 |
| HU-5: si la migración falla, no se despliega la nueva versión | **Sin test ni prueba real. Deuda conocida, ver abajo.** | No hay paso manual |
| HU-5: el criterio del hito se verifica desde el celular | Es esta sub-tarea | Parte A completa |
| Épico KAN-1: "abro la URL de staging, inicio sesión y veo el saludo; un PR mergeado llega solo a staging" | Ver filas anteriores | A3, A4 y C1 a C5 |

Las pruebas del backend corren con `docker compose up -d` y `cd backend && uv run pytest`; las del frontend, con `cd frontend && npm test`.

### Deuda conocida: migración que falla no despliega

Este criterio de HU-5 se da por cubierto por la **revisión de `infra/scripts/cd_deploy.sh`**, no por una prueba. Nunca se ejecutó con una migración rota. La lectura del script (números de línea al 17/10/2026):

- Las migraciones (pasos 2 y 3, desde la línea 142) corren **antes** de la revisión nueva del servicio (paso 4, línea 189).
- Líneas 177 a 181: si la ejecución del job falla (`exec_ok == 0`) o no hay al menos una tarea completada (`succeededCount`), el script escribe la nota "Falló la migración" y llama a `die`, que corta la corrida con el mensaje "La migración falló ... No se despliega; la revisión ... sigue sirviendo". `set -euo pipefail` impide continuar.
- Línea 136: con Cloud SQL en un estado de transición también corta antes del paso 4.
- Líneas 183 a 184: si la ejecución usó otra imagen, también corta.
- El tráfico solo se mueve en el paso 6, así que la revisión anterior sigue sirviendo.

Queda registrada como deuda: probarla de verdad exigiría una imagen con una migración rota y la sesión de gcloud del humano (el WIF solo deja entrar a `main`). No es parte de esta aceptación.

## 5. Cierre

| Paso | Comando | Resultado esperado | Resultado |
|---|---|---|---|
| Z1 | `bash infra/scripts/sql_power.sh stop` (con permiso del humano) | La instancia queda apagada (`STOPPED` / `NEVER`). Si se olvida, genera costo. | OK / FALLA |
| Z2 | Pegar en Jira (KAN-30): el resultado de cada paso, el enlace a esta checklist y las capturas | Criterio de aceptación "capturas adjuntas a este ticket" cumplido. | OK / FALLA |

Al apagar la instancia, las migraciones pendientes futuras se omiten hasta que se vuelva a encender y se relance el CD (`gh workflow run cd-staging.yml --ref main`).

## 6. Riesgos y notas para quien ejecuta

- **Cuentas de prueba que quedan en staging.** Las cuentas creadas en esta prueba (email y Google) permanecen en Firebase y en la tabla `users` de staging, como pasó en KAN-11. No se borran. Anotar aquí cuáles se crearon: `________________________________`
- **Fallback del nombre en el saludo.** `{nombre}` es el `display_name` de la cuenta. El registro por email no pide nombre, así que se usa la parte del email antes del `@`. Con Google sale el nombre de la cuenta, y si el perfil no lo trae, el mismo fallback. Un saludo con la parte del email no es un fallo.
- **No capturar secretos.** En DevTools, mostrar solo los atributos de la cookie (nombre, HttpOnly, Secure, SameSite, Path, Domain, Expires), nunca su valor. No capturar tokens ni la pestaña Network con cabeceras `Cookie` o `Set-Cookie` completas. Usar solo cuentas de prueba.
- **No abrir la pestaña Payload de `POST /api/auth/session`.** Lleva el ID token de Firebase. La captura de Network debe ser solo la lista con el nombre y el estado de cada petición. Lo mismo vale para la pestaña Headers de esa petición y de `DELETE /api/auth/session`: no se capturan.
- **Capturas de `/api/spaces`.** Muestran el `id` del espacio y la zona horaria de una cuenta de prueba; no incluyen datos de terceros. Capturar solo el JSON.
- **iPhone y Android son obligatorios.** El popup de Google (A9) y volver atrás sin ver datos (A7) se prueban en los dos. Un fallo en cualquiera es un bug, no un "no probado" (ver 0.3).

## 7. Resultado global

| Parte | Resultado |
|---|---|
| Preparación (P1 a P3) | OK / FALLA |
| A: celular | OK / FALLA |
| B: escritorio a 1280 px | OK / FALLA |
| C: despliegue automático | OK / FALLA |
| Cierre (Z1, Z2) | OK / FALLA |

Fallos encontrados (formato de bug del proyecto, con pasos, esperado, obtenido y severidad): `________________________________`
