# Plan — Spec 004: Pregúntale a Tracky

* `POST /v1/ask` → bucle de herramientas (máx. 6 rondas, la última sin herramientas) con el JWT de la persona.
* Herramientas: `search_everything`, `get_note`, `list_notes`, `list_tasks`, `coin_summary`, `propose_tasks`.
* Resultados envueltos en `<untrusted_data>`; solo cuentan como cita los ids que devolvieron las herramientas.
* Prompt del sistema en `prompts/assistant.md` (cacheado); hilos en `assistant_threads`.
