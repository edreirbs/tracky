# Spec 005 — Configuración guiada desde Claude Code Desktop

| Campo | Valor |
|---|---|
| Estado | **Borrador para revisión** |
| Fecha | 2026-11-05 |

## 1. Objetivo
Que **cualquier persona** tenga Tracky funcionando (nube + Mac) en una sola conversación de Claude Code en la app de
escritorio, haciendo ella solo lo que no se puede delegar con seguridad.

## 2. Prerrequisitos (los verifica la skill al iniciar)
* Claude Code Desktop en una Mac (Apple Silicon recomendado) con conectores **GitHub, Supabase y Netlify** activos.
* Cuentas gratuitas en GitHub, Supabase y Netlify; una llave de la API de Claude.

## 3. Flujo de `/tracky-setup` (reanudable; estado en `.tracky/setup-state.json`, sin secretos)
| Paso | Quién | Herramienta | Verificación |
|---|---|---|---|
| 0. Revisión | Claude | lista de herramientas de conectores, `sw_vers`, `uname -m` | conectores y Mac compatibles |
| 1. Repo | Claude | GitHub: crear repo desde la plantilla `tracky`, clonar | repo propio clonado |
| 2. Supabase | Claude | `create_project` (región cercana), `apply_migration` (esquema, RLS, funciones, catálogo), `allowed_emails`, `get_project_url`, `get_publishable_keys` | `get_advisors` sin alertas de seguridad |
| 3. Etiquetas | Claude + **usuario** | Conversación: "¿De qué temas son tus juntas y notas?"; Claude propone nombre + descripción de cada etiqueta, el usuario ajusta y Claude las inserta en `tags` con `execute_sql` | ≥ 2 etiquetas con descripción |
| 3b. Netlify | Claude | crear sitio ligado al repo, variables (URL y publishable key; `service_role` como secreta), un despliegue | sitio responde `GET /health` |
| 4. Llave de Claude | **Usuario** | Claude da el enlace directo a las variables de Netlify | `/health` → `claude: "ok"` |
| 5. Mac | Claude (bash) | Homebrew/uv, ffmpeg, `tracky-bridge`, modelo de Whisper según chip y RAM, `audiotap`, `launchd` | `curl 127.0.0.1:47831/health` |
| 6. Permisos | **Usuario** | Aceptar micrófono / grabación de audio en macOS | `check-system-audio` con nivel > 0 |
| 7. Emparejar | Claude + usuario | abre la PWA, inicia sesión con enlace mágico, empareja el token del puente | PWA muestra "Puente conectado" |
| 8. Prueba | Claude | grabación simulada → nota → tarea → monedas | todo en verde |
| 9. Resumen | Claude | escribe `SETUP-RESULT.md` local (sin secretos) | — |

## 4. Requisitos
| ID | Requisito |
|---|---|
| FR-401 | La skill vive en `.claude/skills/tracky-setup/SKILL.md` y se activa también con "configura Tracky". |
| FR-402 | Cada paso es idempotente: si ya existe (repo, proyecto, sitio, puente) se reutiliza. |
| FR-403 | Si falta un conector, la skill se detiene y explica cómo activarlo; **nunca** pide tokens en el chat. |
| FR-404 | La llave de Claude nunca se escribe en el chat, archivos locales ni GitHub. |
| FR-405 | Elección automática del modelo de Whisper: ≥ 16 GB y Apple Silicon → `large-v3-turbo`; 8 GB → `small`; Intel → `faster-whisper small`. |
| FR-406 | El puente queda como agente de `launchd` que inicia con la sesión; `/tracky-doctor` diagnostica y repara. |
| FR-407 | `/tracky-update` trae cambios de la plantilla y aplica migraciones pendientes. |
| FR-409 | Las **etiquetas son un paso obligatorio** de la configuración: Claude entrevista al usuario (temas, proyectos, áreas), propone de 3 a 12 etiquetas con su descripción para clasificar, las confirma con el usuario y las guarda; incluye siempre "Otros". |
| FR-408 | Un solo despliegue a producción por configuración (ahorro de créditos de Netlify). |
| NFR-401 | Configuración completa en < 20 min en una Mac con buena conexión (sin contar descarga del modelo). |
| NFR-402 | Prueba de aceptación: una persona sin experiencia técnica la completa sin ayuda externa. |

## 5. Riesgos
* Los nombres de herramientas de los conectores pueden cambiar → la skill describe **intenciones** y valida al inicio.
* Plan gratuito de Supabase se pausa tras 7 días sin uso → `/tracky-doctor` lo detecta y lo reanuda.
* El conector de Netlify podría no permitir marcar variables como secretas → plan B: el usuario pega también la `service_role` en la UI.
