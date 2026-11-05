# Spec 001 — Grabación de reuniones y notas en Supabase

| Campo | Valor |
|---|---|
| Estado | **Borrador para revisión** |
| Fecha | 2026-11-05 |
| Base | `meeting-recording` spec 001 (FR de captura, transcripción y resumen se heredan sin cambios) |

## 1. Problema
La grabadora funciona bien pero guarda en Notion, lo que obliga a cada persona a tener una base con un esquema exacto.
Tracky debe grabar **igual de bien** y guardar las notas en Supabase, con una pestaña para consultarlas.

## 2. Historias
* **US-1 (P1)** Grabar con un clic, transcripción en vivo con Whisper local, "Yo"/"Otros"/participantes, detección de
  fin de junta en línea. *Igual que meeting-recording.*
* **US-2 (P1)** Al detener, la nota (título, etiqueta, estado, resumen, acuerdos, transcripción) aparece en la pestaña
  **Notas** en < 30 s.
* **US-3 (P1)** Consultar notas: lista por fecha, filtro por etiqueta y estado, búsqueda de texto, vista de detalle con
  resumen arriba y transcripción plegada.
* **US-4 (P2)** Regenerar resumen con otra plantilla, cambiar etiqueta, renombrar, borrar (con confirmación) y exportar
  a Markdown.
* **US-5 (P2)** Convertir acuerdos (`action_items`) en tareas con un clic (puente con spec 002).

## 3. Requisitos funcionales
| ID | Requisito |
|---|---|
| FR-001 | Se heredan sin cambios los FR de captura, VAD, transcripción local, hablantes, eco, auto-detención y resumen de meeting-recording. |
| FR-002 | La nota se guarda en `notes` con `meeting_id` único por usuario (idempotente: reintentar no duplica). |
| FR-003 | Si Claude falla o rechaza, la nota se guarda con la transcripción y estado `summary_failed`; se puede reintentar. |
| FR-004 | Las etiquetas vienen del catálogo `tags` del usuario; Claude elige una existente; **nunca** se crean solas. |
| FR-005 | La pestaña Notas lista, filtra (etiqueta, estado, rango de fechas) y busca en título, resumen y transcripción. |
| FR-006 | Detalle: resumen en Markdown, puntos clave, decisiones, acuerdos, transcripción por turnos plegable. |
| FR-007 | Editar título y etiqueta, regenerar resumen, borrar con confirmación, exportar a `.md`. |
| FR-008 | Botón "Crear tareas" sobre los acuerdos: muestra la lista editable y crea las elegidas en `tasks` (`source = meeting`). |
| FR-009 | La transcripción local (IndexedDB) se borra al confirmar que la nota existe en Supabase (configurable). |

## 4. No funcionales
| ID | Requisito |
|---|---|
| NFR-001 | Paridad: el E2E de grabación de meeting-recording (`smoke.mjs`, motor simulado) pasa sin cambios de comportamiento. |
| NFR-002 | p95 nota guardada < 30 s tras detener (junta de 60 min). |
| NFR-003 | El puente usa el puerto 47831 y el nombre `tracky-bridge` para convivir con meeting-recording. |
| NFR-004 | RLS: un usuario nunca lee ni escribe notas de otro (prueba SQL obligatoria). |
| NFR-005 | La lista de notas carga en < 1 s con 1 000 notas (paginación + índices). |

## 5. Modelo de datos (borrador)
```
tags(id, user_id, name, description, color, sort, created_at)            unique(user_id, name)
notes(id, user_id, meeting_id, title, tag_id, estado, status,
      summary_md, key_points jsonb, decisions jsonb, action_items jsonb,
      transcript jsonb, transcript_text, started_at, duration_s,
      template, language, search tsvector generated, created_at, updated_at)
      unique(user_id, meeting_id); gin(search)
```

## 6. Preguntas abiertas
* Q1. ¿El catálogo inicial de etiquetas se copia del `config/tags.yaml` actual o se le pregunta a cada persona en el setup?
  *Propuesta:* catálogo genérico (Proyectos, Clientes, Equipo, Personal, Otros) y la skill ofrece personalizarlo.
