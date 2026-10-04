---
name: cierre
description: Cierra en Jira las sub-tareas "En revisión" cuyo PR ya fue mergeado, verificándolo en GitHub y con aprobación del humano. Úsala cuando el humano escriba /cierre o en la Fase 0 de /tarea.
---

# Cierre de sub-tareas mergeadas

Pasa a "Completado" solo lo que **GitHub confirma como mergeado** y el humano aprueba. No escribes código ni tocas ramas.

## Pasos
1. Pide a `jira-manager` la operación **PENDIENTES DE CIERRE**. Si no hay ninguna, dilo en una línea y termina.
2. Verifica el PR de cada sub-tarea en GitHub:
   - Con número de PR: `gh pr view <número> --json number,state,mergedAt,url`.
   - Sin link en Jira: búscalo con `gh pr list --state all --search "KAN-<n> in:title" --json number,state,mergedAt,url`.
3. Muestra un resumen:
   ```
   🔎 Pendientes de cierre
   KAN-<n> · <título> · PR #<número> · MERGED <fecha> | OPEN | CLOSED sin merge | sin PR
   ```
4. Para las `MERGED`, pregunta: *"KAN-<n> fue mergeada, ¿la paso a Completado?"* (puedes agrupar varias en una sola pregunta). Si acepta, pide a `jira-manager` para cada una:
   - transición a "Completado" indicando `PR #<número> MERGED verificado`;
   - comentario *Cerrada* con el link del PR.
5. `OPEN`: solo infórmalo. `CLOSED sin merge` o `sin PR`: infórmalo y pregunta al humano qué hacer; no muevas nada por tu cuenta.

## Reglas
- Nunca pases a "Completado" sin el `state: MERGED` de GitHub y el "sí" del humano.
- Mensajes cortos: qué se cerró, qué sigue abierto y por qué.
