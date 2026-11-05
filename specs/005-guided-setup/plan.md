# Plan — Spec 005: configuración guiada

* Skills del repo: `.claude/skills/tracky-setup` (flujo completo), `tracky-doctor` (diagnóstico),
  `tracky-update` (actualizar desde la plantilla).
* Nube con conectores: GitHub (repo), Supabase (proyecto, migraciones, SQL, llaves públicas, advisors),
  Netlify (sitio, variables, despliegue). La persona solo pega su llave de Claude en Netlify y la URL del sitio
  en Supabase Auth (el conector no expone esa configuración).
* Mac con bash: `scripts/setup-mac.sh install|pair|status`, sin sudo ni Homebrew; elige el modelo por chip y RAM.
* Sin `service_role` (ADR-0010): el único secreto es `ANTHROPIC_API_KEY`.
