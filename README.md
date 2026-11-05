# Tracky

> Grabadora de reuniones + organizador de tareas para personas con TDAH, con economía de monedas
> canjeables por tiempo libre y un asistente que responde preguntas sobre tus notas y tareas.

**Estado:** v1 implementada (specs 001–005). Pendiente: validar con cuentas reales y una Mac (ver `specs/*/tasks.md`).
Nace del código de `meeting-recording`, pero es un proyecto **independiente** (ADR-0001).

## Qué hace

| Pestaña | Para qué |
|---|---|
| **Grabar** | Graba cualquier junta (Teams, Zoom, Meet, en persona), transcribe con el Whisper de tu Mac y resume con Claude. El audio nunca sale de tu computadora. |
| **Notas** | Consulta de tus reuniones: busca, filtra por etiqueta y fecha, abre resumen, acuerdos y transcripción. |
| **Tareas** | Organizador amable para TDAH (esencia *Foco Diario*): captura en una línea, Procesar, máximo 3 en Ahora, Esperando de…, Personas, Cerrar el día y Archivo. |
| **Monedas** | Cada tarea terminada da monedas (con confeti); se canjean por tiempo libre. Nunca se pierden. |
| **Pregúntale a Tracky** | Chat en lenguaje natural sobre tus tareas y notas ("¿qué quedó pendiente con Ana?"). |

## El triángulo

```
GitHub (código) ──push──▶ Netlify (PWA + funciones) ──▶ Supabase (Postgres + Auth + RLS)
                                    │
                                    └──▶ API de Claude (único secreto, solo en Netlify; sin service_role)
Tu Mac: puente local de Whisper en 127.0.0.1 (el audio nunca sale de ahí)
```

## Instalar (para cualquier persona)

Guía con requisitos, cuentas y costos: **[INSTALAR.md](INSTALAR.md)**.

1. Abre **Claude Code en la app de escritorio** (no la CLI) con los conectores de **GitHub, Supabase y Netlify**.
2. Escribe: `Configura Tracky desde https://github.com/<dueño>/tracky` o, ya clonado, `/tracky-setup`.
3. Claude crea tu copia del repo, tu proyecto de Supabase (con tus etiquetas) y tu sitio de Netlify, instala el
   puente de Whisper en tu Mac, descarga el modelo y lo empareja. Solo te pedirá:
   * pegar tu llave de Claude **directamente en Netlify** (nunca en el chat),
   * poner la URL de tu sitio en Supabase Auth (30 s, con enlace directo),
   * abrir el enlace mágico de tu correo y aceptar los permisos de audio de macOS.

¿Algo falla? `/tracky-doctor`. ¿Hay versión nueva? `/tracky-update`.

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

## Desarrollo

```bash
pnpm install
```
```bash
pnpm check
```
```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_x pnpm --filter @tracky/web dev
```
```bash
cd bridge && uv run pytest && uv run tracky-bridge --dev --engine fake
```

| Carpeta | Qué hay |
|---|---|
| `web/` | PWA (Vite + Preact + TS) |
| `worker/` + `netlify/functions/` | API (Hono) en Netlify Functions |
| `supabase/` | Migraciones SQL y pruebas con PGlite |
| `bridge/` | Puente local de Whisper (Python) |
| `packages/shared/` | Esquemas zod y reglas de dominio |
| `prompts/` | Prompts versionados |
| `.claude/skills/` | `/tracky-setup`, `/tracky-doctor`, `/tracky-update` |
| `design-ref/` | Paquete de diseño *Foco Diario* |

E2E: `web/e2e/tracky.mjs` (interfaz, con Supabase y API simulados) y `web/e2e/smoke.mjs` (grabación con el puente).
