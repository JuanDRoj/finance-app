---
name: repaso
description: Explica al humano los cambios de la rama actual (o contra una base dada) en lenguaje simple, con ejemplos concretos y analogías, para que pueda revisarlos y aprobarlos a fondo. Úsala cuando el humano escriba /repaso o en la Fase 7 de /tarea.
argument-hint: "[rama-base, por defecto main]"
---

# Repaso de cambios

Tu objetivo: que Juan David (desarrollador semi senior fullstack: Python, React, bases de datos, cloud) **entienda de verdad** qué cambió, por qué y qué riesgos tiene, para aprobarlo con criterio. No es un resumen para salir del paso: es una clase corta sobre **este** cambio.

## 1. Reúne el material
- Base de comparación: `$ARGUMENTS` (si está vacío, usa `main`).
- `git diff <base>...HEAD --stat` y `git diff <base>...HEAD`. Agrega `git diff` si hay cambios sin commit.
- Lee completos los archivos cambiados cuando el diff no alcance para entenderlos.
- Si estás dentro de `/tarea`, ya tienes la clave, el plan aprobado, los criterios y el reporte del reviewer: úsalos.

## 2. Escribe el repaso con esta estructura (en español)

### 🎯 Qué hace este cambio
2–3 frases en lenguaje llano. Qué puede hacer la app (o el equipo) ahora que antes no podía.

### 🗺️ Mapa de cambios
Tabla con: archivo · nuevo/modificado · qué hace en una línea. Ordénala por el **recorrido de una petición** (ej. router → service → repository → modelo → migración → tests), no alfabéticamente.

### 🔍 Recorrido archivo por archivo
Para cada archivo importante (omite los triviales y dilo):
- Qué hace y **por qué existe** (qué problema resuelve).
- El fragmento clave del código (máximo ~15 líneas), con comentarios breves.
- Cómo se conecta con los demás archivos.

### 🧪 Ejemplo concreto
Recorre un caso real de principio a fin con datos realistas del dominio: personas (Juan, Ana), montos en centavos (`1550` = UYU 15,50), espacios ("Mi espacio"), fechas. Muestra la petición, lo que pasa adentro, lo que queda en la BD y la respuesta. Si aplica, muestra también **un caso de error** (401, 404 por IDOR, 422).

### 💡 Conceptos nuevos
Solo los que aparecen **por primera vez** en el proyecto o no son obvios (ej. `selectinload`, session cookie de Firebase, Workload Identity Federation). Para cada uno: qué es, una **analogía** cotidiana y por qué se usa aquí. No expliques lo básico de Python, React o SQL.

### ⚠️ Qué revisar con más cuidado
Las 2–5 zonas donde un error sería más caro, con `archivo:línea`: dinero, seguridad/IDOR, migraciones, manejo de sesión, permisos en la nube. Para cada una: qué mirar y qué podría salir mal.

### ▶️ Pruébalo tú mismo
Comandos o pasos concretos para verificarlo en local (tests a correr, URL a abrir, `curl` de ejemplo, usuario del emulador).

### ❓ Pregunta de comprensión
Una pregunta sobre **este** cambio que solo se responde bien si se entendió (ej. *"¿qué pasaría si mañana agregas `GET /spaces/{id}/accounts` y olvidas `require_space_member`?"*). **No des la respuesta**: espera a que el humano responda y luego coméntala.

## Reglas
- Lenguaje simple y directo; frases cortas. Términos técnicos en inglés cuando sean nombres de código, explicados la primera vez.
- Extensión: lo necesario para entender. Si el diff es grande, prioriza lo importante y agrupa lo repetitivo ("3 archivos de tests con la misma estructura").
- Sé honesto: si algo te parece frágil o dudoso, dilo aunque el reviewer lo haya aprobado.
- No modifiques archivos. Esta skill solo explica.