# Tracky

> Grabadora de reuniones + organizador de tareas para personas con TDAH, con economía de monedas
> canjeables por tiempo libre y un asistente que responde preguntas sobre tus notas y tareas.

**Estado:** Fase 0 — especificaciones en revisión (sin código todavía).
Nace del código de `meeting-recording`, pero es un proyecto **independiente** (ADR-0001).

## Qué hace

| Pestaña | Para qué |
|---|---|
| **Grabar** | Graba cualquier junta (Teams, Zoom, Meet, en persona), transcribe con el Whisper de tu Mac y resume con Claude. El audio nunca sale de tu computadora. |
| **Notas** | Consulta tipo Notion: busca, filtra por etiqueta y fecha, y abre resumen y transcripción. |
| **Tareas** | Organizador amable para TDAH: *Ahora / Siguiente / Después*, captura en una línea, monedas por cada tarea terminada y celebración con confeti. |
| **Pregúntale a Tracky** | Chat en lenguaje natural sobre tus tareas y notas ("¿qué quedó pendiente con Ana?"). |

## El triángulo

```
GitHub (código) ──push──▶ Netlify (PWA + funciones) ──▶ Supabase (Postgres + Auth + RLS)
                                    │
                                    └──▶ API de Claude (llave secreta solo en Netlify)
Tu Mac: puente local de Whisper en 127.0.0.1 (el audio nunca sale de ahí)
```

## Instalar (para cualquier persona)

1. Abre **Claude Code en la app de escritorio** (no la CLI) con los conectores de **GitHub, Supabase y Netlify**.
2. Escribe: `Configura Tracky desde https://github.com/<dueño>/tracky` o, ya clonado, `/tracky-setup`.
3. Claude crea tu copia del repo, tu proyecto de Supabase y tu sitio de Netlify, instala el puente de Whisper en tu Mac
   y descarga el modelo. Solo te pedirá pegar tu llave de Claude **directamente en Netlify** (nunca en el chat)
   y aceptar los permisos de micrófono de macOS.

Detalle en [specs/005-guided-setup/spec.md](specs/005-guided-setup/spec.md).

## Documentación

* [Constitución](docs/constitution.md) — principios no negociables.
* [ADRs](docs/adr/) — decisiones de arquitectura.
* Specs: [001 Notas en Supabase](specs/001-notes-supabase/spec.md) ·
  [002 Tareas TDAH](specs/002-tasks-adhd/spec.md) ·
  [003 Economía de monedas](specs/003-coin-economy/spec.md) ·
  [004 Pregúntale a Tracky](specs/004-ask-tracky/spec.md) ·
  [005 Configuración guiada](specs/005-guided-setup/spec.md)
* [Hoja de ruta](specs/ROADMAP.md)
