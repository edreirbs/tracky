# 0005. Supabase Auth + RLS + lista de correos

- Estado: Propuesto · Fecha: 2026-11-05

## Decisión
Inicio de sesión con **enlace mágico por correo** (por defecto) y opcional GitHub. Un *hook* `before_user_created`
(o un trigger) rechaza correos que no estén en `allowed_emails` (configurada por la skill de setup con el correo del
dueño). Todas las tablas con RLS `user_id = auth.uid()`. Las funciones de Netlify validan el JWT con la JWKS del
proyecto. Sustituye el GitHub OAuth propio (`worker/src/auth.ts`).

## Consecuencias
* (+) Sin servidor de OAuth propio; sesiones renovables; RLS protege aunque la PWA sea pública.
* (−) El correo de Supabase gratuito tiene límite de envíos por hora (suficiente para uso personal).
