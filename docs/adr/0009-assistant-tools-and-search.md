# 0009. Asistente con herramientas y búsqueda full-text

- Estado: Propuesto · Fecha: 2026-11-05

## Opciones
1. Meter todas las notas y tareas en el prompt → caro y limitado.
2. **Claude con herramientas** (`search_notes`, `get_note`, `list_tasks`, `coin_summary`; escritura `propose_task`
   con confirmación) sobre **Postgres full-text en español**. ✅
3. RAG con embeddings (pgvector) → requiere otro proveedor de embeddings; se pospone.

## Decisión
Opción 2. Las herramientas se ejecutan en la función de Netlify **con el JWT del usuario** (RLS aplica), nunca con
`service_role`. Resultados de herramientas delimitados como datos no confiables. Límite de iteraciones por pregunta.

## Consecuencias
* (+) Respuestas con citas a notas y tareas; costo acotado.
* (−) La búsqueda léxica falla con sinónimos lejanos → se mide con evals; pgvector queda como mejora futura.
