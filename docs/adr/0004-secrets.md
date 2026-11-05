# 0004. Dónde viven los secretos

- Estado: Propuesto · Fecha: 2026-11-05

## Contexto
Req. 4: la llave de Claude debe configurarse "desde GitHub o Supabase o donde sea seguro".

## Opciones
1. GitHub Secrets → solo los ven las Actions; Netlify no los recibe en tiempo de ejecución. ❌
2. Supabase Vault → seguro, pero obliga a las funciones de Netlify a leerlo con `service_role` en cada llamada.
3. **Variable de entorno secreta en Netlify** (marcada *secret*, solo en *Functions*, oculta en la UI). ✅

## Decisión
Opción 3 para `ANTHROPIC_API_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. La PWA solo recibe `VITE_SUPABASE_URL` y
`VITE_SUPABASE_PUBLISHABLE_KEY`. **La llave de Claude nunca pasa por el chat**: la skill de setup da el enlace a
*Site configuration → Environment variables*, el usuario la pega y Claude verifica con `GET /health` → `claude: "ok"`.
La `service_role` sí la puede poner Claude con el conector (la obtiene de Supabase y la escribe en Netlify sin mostrarla).

## Consecuencias
* (+) Un único lugar de secretos; rotación documentada.
* (−) Un paso manual en la configuración (es intencional).
