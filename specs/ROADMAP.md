# Hoja de ruta de Tracky

| Fase | Spec | Entrega | Depende de |
|---|---|---|---|
| 0 | — | Constitución, ADRs 0001–0009, specs 001–005 en revisión | — |
| 1 | [001](001-notes-supabase/spec.md) | Grabación igual que hoy + notas en Supabase + pestaña Notas | Repo `tracky` |
| 2 | [002](002-tasks-adhd/spec.md) | Pestaña Tareas (esencia Foco Diario) y cargador de tareas | 001 (personas, outbox) |
| 3 | [003](003-coin-economy/spec.md) | Monedas, canjes y celebración | 002 |
| 4 | [004](004-ask-tracky/spec.md) | Pregúntale a Tracky | 001, 002 |
| 5 | [005](005-guided-setup/spec.md) | `/tracky-setup` en Claude Code Desktop | 001–004 (se valida al final con una instalación limpia) |
| 6 | — | E2E completo, advisors de Supabase, README para terceros, repo plantilla | Todo |

Cada fase: `plan.md` y `tasks.md` se escriben **después** de aprobar su `spec.md`.
