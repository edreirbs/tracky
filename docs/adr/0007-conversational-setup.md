# 0007. Configuración por conversación en Claude Code Desktop

- Estado: Propuesto · Fecha: 2026-11-05

## Contexto
Req. 6, 7 y 11: la configuración debe hacerla Claude en una conversación de **Claude Code Desktop**, con los
conectores de GitHub, Supabase y Netlify, y debe instalar también el puente de Whisper en la Mac.

## Opciones
1. Script de instalación (`curl | bash`) + guía manual. 2. CLI interactiva propia.
3. **Skill del repo `/tracky-setup`** que ejecuta Claude: conectores para la nube y bash local para la Mac. ✅

## Decisión
Opción 3. La skill (`.claude/skills/tracky-setup/SKILL.md`) define pasos verificables y reanudables, con estado en
`.tracky/setup-state.json` (sin secretos, ignorado por git). Los scripts locales (`scripts/setup-mac.sh`, descarga de
modelo, `launchd`) son idempotentes y Claude los ejecuta; el usuario solo acepta permisos de macOS y pega la llave en
Netlify. Si un conector falta, la skill se detiene y explica cómo activarlo (no pide tokens).

## Consecuencias
* (+) Instalación sin conocimientos técnicos; repetible.
* (−) Depende de nombres de herramientas de los conectores → la skill los valida al inicio y degrada a instrucciones.
