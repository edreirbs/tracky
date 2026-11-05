---
name: tracky-update
description: Trae a la copia de la persona las mejoras de la plantilla de Tracky, aplica migraciones pendientes en Supabase, reinstala el puente si cambió y despliega una sola vez. Úsala con /tracky-update o "actualiza Tracky".
---

# Actualizar Tracky (spec 005 FR-407)

1. `git status` limpio; si no, pregunta qué hacer con los cambios locales.
2. `git remote get-url upstream || git remote add upstream https://github.com/edreirbs/tracky.git`,
   `git fetch upstream main` y muestra en 5 viñetas qué trae (`git log --oneline HEAD..upstream/main`).
3. Con su visto bueno: `git merge upstream/main` (sin reescribir historia) y `git push origin main`.
4. Migraciones: compara `supabase/migrations/*.sql` con `list_migrations` del conector y aplica solo las
   nuevas, en orden, con `apply_migration`. Corre los *advisors* de seguridad.
5. Si cambió `bridge/`: `uv run --no-project --python 3.12 scripts/setup.py install --origin <url-del-sitio>` (conserva el emparejamiento).
6. Si cambió algo fuera de `docs/` y `specs/`: **un** despliegue desde un clon limpio (ver Paso 7 de
   `/tracky-setup`) y verifica `/health`. Si solo cambió documentación, no despliegues.
