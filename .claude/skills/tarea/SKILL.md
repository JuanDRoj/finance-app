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

Para delegar usa la herramienta de agentes con el nombre exacto del subagente: `jira-manager`, `backend-dev`, `frontend-dev`, `infra-dev`, `qa`, `reviewer`.
Cada subagente arranca **sin memoria**: pásale siempre todo el contexto que necesita (resumen de la tarea, criterios, plan aprobado, modo).

---

## Fase 0 — Preparación
1. Verifica el repo con `git status`:
   - Si hay cambios sin commit, **detente** y pregunta al humano qué hacer con ellos.
   - Si `$clave` ya tiene una rama `kan-<n>-…` o está "En revisión" / "En progreso", salta a **Modo reanudación** (al final).
2. Ponte al día: `git switch main && git pull`.
3. Cierre pendiente: pide a `jira-manager` la operación **PENDIENTES DE CIERRE**. Para cada tarea con PR, verifica con `gh pr view <número> --json state,mergedAt`.
   - Si está `MERGED`: pregunta al humano *"KAN-x fue mergeada, ¿la paso a Completado?"*; si acepta, pide a `jira-manager` la transición a "Completado" indicando `PR #<número> MERGED verificado`, y un comentario de cierre.
   - Si no está mergeada, solo infórmalo.

## Fase 1 — Lectura de la tarea
Pide a `jira-manager` el **RESUMEN** de `$clave`.
- Si hay **Alertas** (dependencias sin completar, sin label o con varios), muéstralas y pregunta al humano si continuar.
- Elige el agente según el label (tabla del `CLAUDE.md` raíz). Varios labels o ninguno → pregunta al humano.

## Fase 2 — Plan
Pide al agente elegido el **Modo PLAN**, pasándole el resumen completo y los criterios de aceptación.
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
- Si pide cambios, vuelve a pedir el plan al agente con las correcciones y repite el control.
- **No avances sin un "sí" explícito.**

## Fase 3 — Inicio
1. Pide a `jira-manager`: transición de `$clave` a **"En progreso"** y un comentario de *Inicio* con el plan resumido.
2. Crea la rama: `git switch -c kan-<n>-<slug-corto>`.

## Fase 4 — Desarrollo
Pide al agente el **Modo IMPLEMENTACIÓN**, pasándole el resumen, los criterios y el **plan aprobado textual**.
- Si devuelve ⚠️ bloqueado o 🐞 bugs: muestra el motivo al humano y pregunta cómo seguir (corregir, ajustar el plan o pausar). No sigas por tu cuenta.
- Si devuelve dudas abiertas que afecten al diseño, pregúntalas al humano antes de seguir.

## Fase 5 — Revisión
Pide a `reviewer` la revisión, pasándole la clave, el agente que trabajó, el plan aprobado y los criterios.
- Si el veredicto es **CAMBIOS NECESARIOS**: pasa los hallazgos 🔴 y 🟠 al agente (Modo IMPLEMENTACIÓN, "corrige estos hallazgos") y vuelve a revisar. **Máximo 2 rondas** de revisión; si siguen apareciendo 🔴, detente y consulta al humano.
- Las ❓ decisiones para el humano se las preguntas a él.
- Los 🟢 no bloquean: guárdalos para el cuerpo del PR.

## Fase 6 — Verificación final
Confirma que lint, tipos y la suite completa del área afectada están en verde (comandos en el `CLAUDE.md` de la carpeta). Si algo falla, vuelve a la Fase 4 (cuenta dentro de los 3 intentos del agente).

## Fase 7 — Repaso
Ejecuta las instrucciones de la skill `/repaso` sobre los cambios de esta rama y muéstralo al humano.
Agrega al final: veredicto del reviewer, sugerencias 🟢 pendientes y migraciones que requieren revisión humana.

## ✋ CONTROL 2 — ¿Generar el PR?
Pregunta: *"¿Genero el PR? (sí / pido cambios / pausar)"*.
- **Pido cambios** → pasa los cambios al agente (Fase 4) y repite desde la Fase 5.
- **Pausar** → pide a `jira-manager` un comentario *Bloqueada* con el estado actual y termina.
- **Tarea sin código** → en lugar del PR: pide a `jira-manager` un comentario con la *Evidencia para Jira* y pregunta *"¿La paso a Completado?"*. Si acepta, transición indicando `SIN CÓDIGO aprobado por el humano`. Fin.

## Fase 8 — Entrega
1. `git add` de los archivos de la tarea (nunca `git add .` a ciegas; revisa `git status` primero).
2. Commit: `KAN-<n> <tipo>(<alcance>): <descripción>`.
3. `git push -u origin kan-<n>-<slug>`.
4. `gh pr create --base main --title "KAN-<n> [<código>] <título>" --body "<cuerpo>"`, con este cuerpo:
```
   ## Qué hace
   ## Cómo se probó
   ## Decisiones
   ## Dudas abiertas
   ## Sugerencias no aplicadas (reviewer)
   Jira: KAN-<n>
```
5. Pide a `jira-manager`: transición a **"En revisión"** y comentario *PR abierto* con el link.

## ✋ CONTROL 3 — Merge (lo hace el humano)
Cierra con este mensaje:
```
✅ $clave lista para tu revisión: <link del PR>
Cuando el CI esté en verde, mergea en GitHub.
Se cerrará en Jira al iniciar el próximo /tarea.
```

---

## Modo reanudación
Si la tarea ya estaba empezada:
1. Cambia a su rama (`git switch kan-<n>-…`) y lee el estado: `git log main..HEAD --oneline` y, si hay PR, `gh pr view --comments`.
2. Resume al humano dónde quedó y qué falta (incluidos los comentarios de revisión del PR).
3. Pregunta cómo seguir. Si hay cambios pedidos en el PR: pide a `jira-manager` volver a **"En progreso"**, sigue desde la Fase 4 y, al final, haz push a la misma rama (sin crear otro PR) y vuelve a **"En revisión"**.

## Reglas del orquestador
- Una sub-tarea a la vez. No empieces otra hasta llegar al CONTROL 3 o pausar.
- Nunca mergees, nunca hagas push a `main`, nunca muevas a "Completado" sin la verificación de la Fase 0 o la aprobación explícita de una tarea sin código.
- Si un permiso es denegado por un hook, **no busques otra forma de hacer lo mismo**: informa al humano.
- Mantén tus mensajes cortos: qué pasó, qué sigue, qué necesitas.