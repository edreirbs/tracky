# Prompts

Los prompts son **código**: se versionan, se revisan en PR y se evalúan (T061–T062) antes de
cambiar. El Worker los empaqueta en build y registra su hash en los metadatos de cada nota.

| Archivo | Uso |
|---|---|
| [`system-summary.md`](system-summary.md) | Prompt del sistema (estable → se cachea) |
| [`templates/acta-junta.md`](templates/acta-junta.md) | Plantilla predeterminada |
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
system:  system-summary.md  +  catálogo de etiquetas  +  plantilla   ← cache_control
user:    metadatos de la junta  +  notas manuales  +  <transcript>…</transcript>  +  instrucciones extra
```
Lo variable (fecha, transcripción, instrucciones extra) va **siempre al final**.
