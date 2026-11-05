# Spec 005 — Configuración guiada desde Claude Code Desktop

| Campo | Valor |
|---|---|
| Estado | **Borrador para revisión** |
| Fecha | 2026-11-05 |

## 1. Objetivo
Que **cualquier persona** tenga Tracky funcionando (nube + Mac) en una sola conversación de Claude Code en la app de
escritorio, haciendo ella solo lo que no se puede delegar con seguridad.

## 2. Prerrequisitos (los verifica la skill al iniciar)
* Claude Code (app de escritorio en macOS o Windows; en Linux, Claude Code en terminal) con conectores **GitHub, Supabase y Netlify** activos.
* Una computadora con macOS, Windows 10/11 o Linux; Chrome o Edge.
* Cuentas gratuitas en GitHub, Supabase y Netlify; una llave de la API de Claude.

## 3. Flujo de `/tracky-setup` (reanudable; estado en `.tracky/setup-state.json`, sin secretos)
Implementado en `.claude/skills/tracky-setup/SKILL.md`.

| Paso | Quién | Herramienta | Verificación |
|---|---|---|---|
| 0. Revisión | Claude | conectores disponibles, `uname`, `sw_vers`, RAM; correo, nombre y sitio | Mac compatible |
| 1. Repo | Claude | `gh repo create --template` o conector de GitHub; clonar | su repo clonado |
| 2. Supabase | Claude | `create_project`, `apply_migration`, `allowed_emails`, URL y publishable key, advisors | sin alertas de seguridad |
| 3. Etiquetas | Claude + **persona** | entrevista → 3–12 etiquetas con descripción + "Otros" | lista confirmada |
| 4. Netlify | Claude | `create-new-project`, `manage-env-vars` (solo valores públicos) | sitio creado, sin desplegar |
| 5. URL en Supabase Auth | **Persona** (30 s) | enlace directo a *Auth → URL configuration* | "listo" |
| 6. Llave de Claude | **Persona** (1 min) | enlace directo a las variables de Netlify (secreta, Functions) | la variable existe |
| 7. Desplegar | Claude | `deploy-site` **una vez**, desde un clon limpio | `/health?check=claude` → `ok` |
| 8. Primer acceso | **Persona** + Claude | enlace mágico; `execute_sql` inserta perfil y etiquetas | entra a Tracky |
| 9. Computadora | Claude (bash) + **persona** (permisos) | `scripts/setup.py install` y `pair` (macOS, Windows o Linux) | puente responde y emparejado |
| 10. Prueba | Claude + persona | tarea con confeti, grabación corta, pregunta al asistente | todo en verde; `SETUP-RESULT.md` |

## 4. Requisitos
| ID | Requisito |
|---|---|
| FR-401 | La skill vive en `.claude/skills/tracky-setup/SKILL.md` y se activa también con "configura Tracky". |
| FR-402 | Cada paso es idempotente: si ya existe (repo, proyecto, sitio, puente) se reutiliza. |
| FR-403 | Si falta un conector, la skill se detiene y explica cómo activarlo; **nunca** pide tokens en el chat. |
| FR-404 | La llave de Claude nunca se escribe en el chat, archivos locales ni GitHub. |
| FR-405 | Elección automática del motor y modelo: Mac Apple Silicon → mlx-whisper (`large-v3-turbo` con ≥ 16 GB, si no `small`); Windows, Linux y Mac Intel → faster-whisper (`large-v3-turbo` con GPU NVIDIA, si no `small`). |
| FR-406 | El puente arranca solo al iniciar sesión en **macOS, Windows y Linux** (launchd, carpeta Inicio, systemd/XDG); `/tracky-doctor` diagnostica y repara (ADR-0012). |
| FR-407 | `/tracky-update` trae cambios de la plantilla y aplica migraciones pendientes. |
| FR-409 | Las **etiquetas son un paso obligatorio** de la configuración: Claude entrevista al usuario (temas, proyectos, áreas), propone de 3 a 12 etiquetas con su descripción para clasificar, las confirma con el usuario y las guarda; incluye siempre "Otros". |
| FR-410 | La instalación incluye un **latido diario** a Supabase (función programada de Netlify) para que el plan gratuito no pause el proyecto por inactividad; no requiere pasos de la persona (ADR-0011). |
| FR-408 | Un solo despliegue a producción por configuración (ahorro de créditos de Netlify). |
| NFR-401 | Configuración completa en < 20 min en una Mac con buena conexión (sin contar descarga del modelo). |
| NFR-402 | Prueba de aceptación: una persona sin experiencia técnica la completa sin ayuda externa. |

## 5. Riesgos
* Los nombres de herramientas de los conectores pueden cambiar → la skill describe **intenciones** y valida al inicio.
* Plan gratuito de Supabase se pausa tras 7 días sin uso → latido diario (FR-410); si aun así se pausa, `/tracky-doctor` lo reanuda.
* El conector de Supabase no expone la configuración de Auth ni la `service_role` → paso 5 manual y ADR-0010 (sin service_role).
* El conector de Netlify no enlaza el repo de GitHub → los despliegues se hacen con el conector desde un clon limpio; enlazarlo en la UI de Netlify es opcional (despliegue automático por push).
