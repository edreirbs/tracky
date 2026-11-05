# 0005. Supabase Auth + RLS + lista de correos

- Estado: Aceptado · Fecha: 2026-11-05

## Decisión
Inicio de sesión con **enlace mágico por correo**. Un trigger `before insert on auth.users` rechaza correos que no
estén en `allowed_emails` (la llena la skill de setup con el correo de la persona). La URL del sitio debe estar en
*Auth → URL configuration* de Supabase (paso manual de 30 s: el conector no lo expone). Todas las tablas con RLS `user_id = auth.uid()`. Las funciones de Netlify validan el JWT con la JWKS del
proyecto. Sustituye el GitHub OAuth propio (`worker/src/auth.ts`).

## Consecuencias
* (+) Sin servidor de OAuth propio; sesiones renovables; RLS protege aunque la PWA sea pública.
* (−) El correo de Supabase gratuito tiene límite de envíos por hora (suficiente para uso personal).
