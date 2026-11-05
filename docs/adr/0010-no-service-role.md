# 0010. Sin service_role: el trabajo en segundo plano usa el token de la persona

- Estado: Aceptado · Fecha: 2026-11-05

## Contexto
El resumen corre en una función en segundo plano (hasta 15 min) que debe escribir la nota en Supabase. El diseño
inicial (ADR-0003/0004) usaba la `service_role`. Al construir `/tracky-setup` se vio que el conector de Supabase
**no entrega** esa llave (correcto, por seguridad), así que la persona tendría que copiarla a mano.

## Opciones
1. `service_role` en Netlify (llave que salta RLS; paso manual extra; daño grande si se filtra).
2. **El JWT de la persona viaja con el trabajo** (vida ≤ 1 h; la PWA lo renueva si le quedan < 20 min) y se borra
   del almacenamiento al terminar. RLS aplica en todo. ✅

## Decisión
Opción 2. Tracky no tiene `service_role` en ningún lado; el único secreto es `ANTHROPIC_API_KEY`.

## Consecuencias
* (+) Mínimo privilegio real; un paso manual menos en la configuración.
* (−) Si un trabajo queda en cola más de lo que dura el token, falla con error reintentable y la PWA lo reenvía
  con un token nuevo (la cola local ya reintenta).
