# 0002. Supabase en lugar de Notion

- Estado: Aceptado · Fecha: 2026-11-05

## Contexto
Notion obliga a cada usuario a tener una base con un esquema exacto, limita a ~3 req/s y 2000 caracteres por bloque,
y no sirve para tareas con reglas de monedas transaccionales. Tracky necesita consultas, búsqueda, transacciones e
integridad.

## Opciones
1. Notion (actual). 2. **Supabase (Postgres + Auth + RLS).** ✅ 3. SQLite/IndexedDB solo local (sin sincronizar dispositivos).

## Decisión
Supabase. Tablas: `profiles`, `tags`, `notes`, `tasks`, `coin_ledger`, `rewards`, `redemptions`, `assistant_threads`.
Transcripción como `jsonb` (turnos) + `text` plano para búsqueda; índice `tsvector` en español.

## Consecuencias
* (+) Transacciones, RLS, búsqueda, tiempo real opcional; plan gratuito suficiente para una persona.
* (−) Los proyectos gratuitos se pausan tras 7 días sin uso → la PWA muestra cómo reanudarlo y la skill de setup
  sabe hacerlo con el conector (`restore_project`).
