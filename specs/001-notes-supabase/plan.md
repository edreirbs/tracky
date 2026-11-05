# Plan — Spec 001: grabación y notas en Supabase

* **Captura y transcripción**: sin cambios respecto a meeting-recording (`web/src/capture`, `session`,
  `bridge/`). El puente cambia de nombre (`tracky-bridge`), puerto (47831) y ya no trae un origen fijo
  (`tracky-bridge set-origin`).
* **Envío**: la PWA manda la transcripción a `POST /v1/notes` (cola local con reintentos, idempotencia por
  `meetingId`). La función en segundo plano resume con Claude y hace *upsert* en `public.notes` con el JWT de
  la persona (ADR-0010). Etiquetas desde `public.tags` (catálogo de la persona, con descripciones).
* **Consulta**: la pestaña Notas lee `notes` directo de Supabase (RLS); búsqueda con `search_everything`
  (full-text en español); edición de título/etiqueta/estado directo en Supabase; regenerar resumen vía
  `PATCH /v1/notes/:meetingId`.
* **Acuerdos → tareas**: `action_items` del resumen → `tasks` con `source = meeting` y `note_id`.
* **Pruebas**: contrato del backend con Supabase y Claude simulados (`worker/test`), RLS en PGlite
  (`supabase/test`), E2E de grabación con el puente real en modo `fake` (`web/e2e/smoke.mjs`).
