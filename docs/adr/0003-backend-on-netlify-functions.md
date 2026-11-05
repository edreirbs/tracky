# 0003. Backend en Netlify Functions

- Estado: Aceptado · Fecha: 2026-11-05

## Contexto
El backend de `meeting-recording` es Hono + TS empaquetado para Netlify Functions, con una función en segundo plano
para resumir. Supabase ofrece Edge Functions (Deno) como alternativa.

## Opciones
1. **Netlify Functions** (reuso directo del código, mismo dominio que la PWA, sin CORS). ✅
2. Supabase Edge Functions (Deno; reescribir el adaptador de Claude; secretos en Supabase).
3. Mixto.

## Decisión
Opción 1. Supabase queda como BD y Auth. Las funciones validan el JWT de Supabase y consultan **siempre con ese
JWT** (RLS aplica), incluida la función en segundo plano que guarda el resumen (ADR-0010).

## Consecuencias
* (+) Reuso del 80 % del `worker/`; un solo lugar para secretos (Netlify).
* (−) Cada llamada gasta créditos de Netlify; la PWA lee y escribe tareas **directo a Supabase** (con RLS) para no
  pasar por funciones en operaciones frecuentes. Solo Claude pasa por Netlify.
