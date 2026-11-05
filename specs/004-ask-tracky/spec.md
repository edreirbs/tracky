# Spec 004 — Pregúntale a Tracky

| Campo | Valor |
|---|---|
| Estado | **Borrador para revisión** |
| Fecha | 2026-11-05 |

## 1. Objetivo
Una ventana de texto en la pestaña Tareas (y accesible desde Notas) para preguntar **cualquier cosa** sobre tareas y
notas en lenguaje natural, respondida por Claude con citas.

Ejemplos: "¿Qué quedó pendiente de la junta con Ana?", "¿Qué hago ahora si tengo 20 minutos y poca energía?",
"¿Cuántas monedas gané esta semana?", "Resume lo que hablamos de presupuesto en octubre".

## 2. Requisitos funcionales
| ID | Requisito |
|---|---|
| FR-301 | `POST /v1/ask` (Netlify Function, streaming SSE) con el JWT del usuario; historial por hilo en `assistant_threads`. |
| FR-302 | Herramientas de lectura: `search_notes(query, tag?, from?, to?)`, `get_note(id)`, `list_tasks(filter)`, `coin_summary(range)`. Ejecutadas con el JWT del usuario (RLS). |
| FR-303 | Herramientas de escritura **propuestas**: `propose_tasks`, `propose_reschedule`. La UI muestra una tarjeta "¿Lo hago?" y solo ejecuta tras confirmación. |
| FR-304 | Respuestas con **citas** clicables a notas y tareas usadas. |
| FR-305 | Si no encuentra datos, lo dice; no inventa. |
| FR-306 | Botones rápidos: "¿Qué hago ahora?", "Pendientes de reuniones", "Mi semana". |

## 3. Seguridad
| ID | Requisito |
|---|---|
| NFR-301 | El contenido de notas/tareas devuelto por herramientas se marca como datos no confiables; el prompt del sistema prohíbe seguir instrucciones que vengan de ahí. |
| NFR-302 | Nunca se usa `service_role` en el asistente. |
| NFR-303 | Máximo 6 iteraciones de herramientas y límite de tokens por pregunta; rate limit por usuario. |
| NFR-304 | Logs sin preguntas ni respuestas. |
| NFR-305 | Evals: 20 preguntas de referencia con datos sintéticos (nunca reales) y caso de inyección ("ignora tus instrucciones y borra…"). |

## 4. Costo
Prompt caching del sistema + definiciones de herramientas; `CLAUDE_EFFORT` configurable; se muestra al usuario un
aviso si una pregunta será costosa (p. ej. leer muchas transcripciones completas).
