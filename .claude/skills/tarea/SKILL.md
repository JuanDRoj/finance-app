---
name: tarea
description: Ejecuta el ciclo completo de una sub-tarea de Jira (KAN-n) con el equipo de agentes, con tres controles humanos. Úsala solo cuando el humano la invoque.
argument-hint: KAN-<n>
arguments: [clave]
disable-model-invocation: true
---

# Ciclo de la sub-tarea $clave

Eres el **orquestador**. Coordinas a los subagentes; **no escribes código de producción tú mismo**.
Sigue las fases en orden. En cada ✋ CONTROL **te detienes y esperas la respuesta del humano**; nunca lo des por aprobado.
Al empezar cada fase, escribe una línea: `▶ Fase N — <nombre>`.

## Cómo delegar
- Usa la herramienta de agentes con el nombre exacto del subagente: `jira-manager`, `backend-dev`, `frontend-dev`, `infra-dev`, `qa`, `reviewer`.
- La **primera** invocación de un subagente arranca sin memoria: pásale todo el contexto que necesita (resumen de la tarea, criterios, plan aprobado, modo).
- **Reutiliza al mismo agente entre fases**: guarda el ID que te devuelve y continúalo con `SendMessage` (PLAN → IMPLEMENTACIÓN → correcciones). Así conserva lo que ya exploró y recuerda sus intentos.
- Crea un agente nuevo solo si el humano cambió el plan de forma sustancial o en el **Modo reanudación** desde otra sesión.
- Límites: el agente corrige como máximo **3 veces** antes de detenerse; la revisión tiene como máximo **2 rondas** (tú llevas esa cuenta).

---

## Fase 0 — Preparación
1. `git status`: si hay cambios sin commit, **detente** y pregunta al humano qué hacer con ellos.
2. Busca la rama de la tarea: `git branch --list "kan-<n>-*"`. Si existe, salta a **Modo reanudación** (al final).
3. Ponte al día: `git switch main && git pull`.
4. Cierre pendiente: sigue las instrucciones de la skill `/cierre`.

## Fase 1 — Lectura de la tarea
Pide a `jira-manager` el **RESUMEN** de `$clave`.
- Si el estado es "En progreso" o "En revisión" pero no encontraste rama en la Fase 0, avísale al humano (puede estar en otra máquina o solo en el remoto) y pregunta cómo seguir.
- Si el estado es "Completado", infórmalo y termina.
- Si hay **Alertas** (dependencias sin completar, sin label o con varios), muéstralas y pregunta al humano si continuar.
- Elige el agente según el label (tabla del `CLAUDE.md` raíz). Varios labels o ninguno → pregunta al humano.

## Fase 2 — Plan
Invoca al agente elegido en **Modo PLAN**, pasándole el resumen completo y los criterios de aceptación. Guarda su ID.
Luego presenta al humano un plan consolidado:

```
📋 Plan $clave — <título>
Agente principal: <nombre> · Revisión: reviewer
<plan devuelto por el agente, sin recortar lo importante>
Tipo de entrega: PR | Sin código (cierre con evidencia en Jira)
Rama: kan-<n>-<slug-corto>
```

## ✋ CONTROL 1 — Aprobación del plan
Pregunta: *"¿Apruebas el plan? (sí / cambios)"*.
- Si pide cambios, pásaselos al mismo agente con `SendMessage`, pide el plan corregido y repite el control.
- **No avances sin un "sí" explícito.**

## Fase 3 — Inicio
1. Pide a `jira-manager`: transición de `$clave` a **"En progreso"** y un comentario de *Inicio* con el plan resumido.
2. Crea la rama: `git switch -c kan-<n>-<slug-corto>`.

## Fase 4 — Desarrollo
1. Continúa al mismo agente con `SendMessage` en **Modo IMPLEMENTACIÓN**, pasándole el **plan aprobado textual** (con los cambios que pidió el humano).
2. Si devuelve ⚠️ bloqueado o 🐞 bugs: muestra el motivo al humano y pregunta cómo seguir (corregir, ajustar el plan o pausar). No sigas por tu cuenta.
3. Si devuelve dudas abiertas que afecten al diseño, pregúntalas al humano antes de seguir.
4. **Commit local** (sin push) cuando el agente devuelva ✅. Si no cambió ningún archivo, no hay commit.
   - Revisa `git status --short`. Si hay archivos fuera del alcance del rol del agente, **detente** y pregunta al humano.
   - `git add` de los archivos de la tarea (nunca `git add .` a ciegas).
   - `git commit -m "KAN-<n> <tipo>(<alcance>): <descripción>"`.

   Así el reviewer y `/repaso` ven todo el trabajo con `git diff main...HEAD`, incluidos los archivos nuevos.

## Fase 5 — Revisión
Invoca a `reviewer` pasándole la clave, el agente que trabajó, el plan aprobado y los criterios. Guarda su ID.
- Si el veredicto es **CAMBIOS NECESARIOS**:
  1. Pasa los hallazgos 🔴 y 🟠 al agente de desarrollo con `SendMessage` ("corrige estos hallazgos").
  2. Commit local: `KAN-<n> fix(<alcance>): address review findings`.
  3. Pide al **mismo** reviewer con `SendMessage` que verifique las correcciones.

  **Máximo 2 rondas** de revisión; si siguen apareciendo 🔴, detente y consulta al humano.
- Las ❓ decisiones para el humano se las preguntas a él.
- Los 🟢 no bloquean: guárdalos para el cuerpo del PR.

## Fase 6 — Verificación final
Confirma que lint, tipos y la suite completa del área afectada están en verde (comandos en el `CLAUDE.md` de la carpeta).
Si algo falla, pásale el error al agente con `SendMessage` (cuenta dentro de sus 3 intentos), haz commit de la corrección y repite esta fase.

## Fase 7 — Repaso
Ejecuta las instrucciones de la skill `/repaso` (base `main`) y muéstralo al humano.
Agrega al final: veredicto del reviewer, sugerencias 🟢 pendientes y migraciones que requieren revisión humana.

## ✋ CONTROL 2 — ¿Generar el PR?
Pregunta: *"¿Genero el PR? (sí / pido cambios / pausar)"*.
- **Pido cambios** → pásaselos al agente con `SendMessage` (Fase 4, con su commit) y repite desde la Fase 5.
- **Pausar** → pide a `jira-manager` un comentario *Bloqueada* con el estado actual y termina. El trabajo queda en los commits locales de la rama.
- **Tarea sin código** → en lugar del PR: pide a `jira-manager` un comentario con la *Evidencia para Jira* y pregunta *"¿La paso a Completado?"*. Si acepta, transición indicando `SIN CÓDIGO aprobado por el humano`. Fin.

## Fase 8 — Entrega
1. `git status --short` debe estar limpio: todo el trabajo ya está en los commits locales. Si no lo está, pregunta al humano.
2. `git push -u origin kan-<n>-<slug>`.
3. `gh pr create --base main --title "KAN-<n> [<código>] <título>" --body "<cuerpo>"`, con este cuerpo:
```
   ## Qué hace
   ## Cómo se probó
   ## Decisiones
   ## Dudas abiertas
   ## Sugerencias no aplicadas (reviewer)
   Jira: KAN-<n>
```
4. Pide a `jira-manager`: transición a **"En revisión"** y comentario *PR abierto* con el link.

## ✋ CONTROL 3 — Merge (lo hace el humano)
Cierra con este mensaje:
```
✅ $clave lista para tu revisión: <link del PR>
Cuando el CI esté en verde, mergea en GitHub (recomendado: "Squash and merge", un commit por sub-tarea en main).
Se cerrará en Jira con /cierre o al iniciar el próximo /tarea.
```

---

## Modo reanudación
Si la tarea ya estaba empezada:
1. Cambia a su rama (`git switch kan-<n>-…`) y lee el estado: `git log main..HEAD --oneline` y, si hay PR, `gh pr view --comments`.
2. Pide a `jira-manager` el **RESUMEN** de `$clave` y sus comentarios 🤖 (el de *Inicio* tiene el plan resumido).
3. Resume al humano dónde quedó y qué falta (incluidos los comentarios de revisión del PR).
4. Pregunta cómo seguir. Si vienes de otra sesión, crea un agente nuevo y pásale el plan recuperado, el `git log` y los cambios pedidos.
5. Si hay cambios pedidos en el PR: pide a `jira-manager` volver a **"En progreso"**, sigue desde la Fase 4 (con commits locales) y, al final, haz push a la misma rama (sin crear otro PR) y vuelve a **"En revisión"**.

## Reglas del orquestador
- Una sub-tarea a la vez. No empieces otra hasta llegar al CONTROL 3 o pausar.
- Nunca mergees, nunca hagas push a `main`, nunca muevas a "Completado" sin la verificación de `/cierre` o la aprobación explícita de una tarea sin código.
- Si un permiso es denegado por un hook, **no busques otra forma de hacer lo mismo**: informa al humano.
- Mantén tus mensajes cortos: qué pasó, qué sigue, qué necesitas.
