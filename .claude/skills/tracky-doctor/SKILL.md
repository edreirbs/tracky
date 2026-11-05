---
name: tracky-doctor
description: Diagnostica y repara una instalación de Tracky (sitio, Claude, Supabase, puente de Whisper, emparejamiento, permisos de audio). Úsala cuando Tracky "no funciona", no graba, no resume, no deja entrar, o la persona escriba /tracky-doctor.
---

# Diagnóstico de Tracky (spec 005 FR-406)

Lee `.tracky/setup-state.json` (si existe) para conocer el sitio, el proyecto y el correo. Revisa en este
orden, di en una línea qué encontraste y **arregla lo que puedas sin pedir nada**. Nunca pidas llaves en el chat.

1. **Sitio**: `curl -s https://<sitio>/health?check=claude`.
   * No responde → revisa el último despliegue con el conector de Netlify.
   * `claude: missing|invalid` → Paso 6 de `/tracky-setup` (la persona pega la llave en Netlify) y un redespliegue.
2. **Supabase**: estado del proyecto. Si está en pausa → `restore_project` y espera a que esté activo.
   Revisa el latido: `select beat_at, beats from public.heartbeat;` — si tiene más de 2 días, revisa en
   Netlify que la función programada `heartbeat` exista en el despliegue publicado.
   Corre los *advisors* de seguridad; explica y corrige errores. Verifica que `allowed_emails` tenga su
   correo y que existan etiquetas: `select count(*) from public.tags;`.
3. **Entrar**: si el enlace mágico falla, revisa el Paso 5 (URL del sitio en Auth).
4. **Puente** (solo en la Mac): `scripts/setup-mac.sh status`.
   * No instalado → `scripts/setup-mac.sh install --origin <url-del-sitio>`.
   * No responde → `launchctl load ~/Library/LaunchAgents/app.tracky.tracky-bridge.plist`; lee las
     últimas líneas de `~/.config/tracky-bridge/logs/bridge.log` (no contienen audio ni texto).
   * Origen equivocado (la app dice "puente apagado" aunque responde) → `tracky-bridge set-origin <url>` y
     reinicia el agente (`launchctl unload` + `load`).
   * "Sin emparejar" → `scripts/setup-mac.sh pair`.
5. **Audio de los demás**: `tracky-bridge check-system-audio` con un video sonando. Si falla, guía a
   Ajustes del Sistema → Privacidad y seguridad → Grabación de pantalla y audio del sistema → activar
   `tracky-audiotap`.
6. **Navegador**: recomienda Chrome o Edge, con permiso de micrófono y de red local (127.0.0.1).

Termina con un resumen: qué estaba mal, qué arreglaste y qué falta (si algo).
