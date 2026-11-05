# Plan — Spec 002: tareas para TDAH (esencia Foco Diario)

* **Datos**: `tasks`, `people`, `contacts`, `notes(kind = memo)` con RLS; la PWA escribe directo en Supabase con
  cambios optimistas y una cola local de capturas sin conexión (`web/src/data/store.ts`).
* **Reglas de dominio compartidas** (`packages/shared/src/tracky.ts`): máximo 3 en Ahora, orden de Siguientes,
  orden de Esperando, factor estimado/real.
* **Terminar/reabrir** solo con `complete_task`/`uncomplete_task` (un trigger impide hacerlo con `update`).
* **Cargador**: `Capture.tsx` guarda al instante; `POST /v1/tasks/parse` (modelo rápido, salida estructurada)
  devuelve sugerencias que se aplican como chips reversibles solo si la persona no tocó la tarea.
* **Diseño**: tokens y componentes de `design-ref/foco-diario` (pizarra, papel, post-its), fuentes autoalojadas.
