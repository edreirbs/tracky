# Prompts

Los prompts son **código**: se versionan, se revisan en PR y se evalúan antes de cambiar
(constitución VII.2). El backend los empaqueta en build y expone su hash en `GET /health`.

| Archivo | Uso |
|---|---|
| [`system-summary.md`](system-summary.md) | Resumen de reuniones: prompt del sistema (estable → se cachea) |
| [`assistant.md`](assistant.md) | Pregúntale a Tracky (spec 004) |
| [`task-parse.md`](task-parse.md) | Sugerencias del cargador de tareas (spec 002) |
| [`templates/general.md`](templates/general.md) | Plantilla predeterminada de resumen |
| [`templates/acta-junta.md`](templates/acta-junta.md) | Acta formal |
| [`templates/ejecutivo.md`](templates/ejecutivo.md) | Resumen corto para dirección |
| [`templates/seguimiento-proyecto.md`](templates/seguimiento-proyecto.md) | Avances, bloqueos, riesgos |
| [`templates/one-on-one.md`](templates/one-on-one.md) | 1:1 |
| [`templates/clase-taller.md`](templates/clase-taller.md) | Clases y talleres |

## Agregar una plantilla

1. Crear `templates/<id>.md` con el *frontmatter* `id`, `nombre`, `descripcion`.
2. Describir secciones y tono. No repetir reglas del prompt del sistema.
3. Correr evals y adjuntar resultado al PR.

## Orden de ensamblado (para *prompt caching*)

```
system:  system-summary.md  +  catálogo de etiquetas del usuario (tabla tags)  +  plantilla   ← cache_control
user:    metadatos de la junta  +  notas manuales  +  <transcript>…</transcript>  +  instrucciones extra
```
Lo variable (fecha, transcripción, instrucciones extra) va **siempre al final**.
