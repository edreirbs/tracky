# 0004. Dónde viven los secretos

- Estado: Aceptado · Fecha: 2026-11-05

## Contexto
Req. 4: la llave de Claude debe configurarse "desde GitHub o Supabase o donde sea seguro".

## Opciones
1. GitHub Secrets → solo los ven las Actions; Netlify no los recibe en tiempo de ejecución. ❌
2. Supabase Vault → seguro, pero obliga a las funciones de Netlify a leerlo con `service_role` en cada llamada.
3. **Variable de entorno secreta en Netlify** (marcada *secret*, solo en *Functions*, oculta en la UI). ✅

## Decisión
Opción 3 para `ANTHROPIC_API_KEY`, **el único secreto de Tracky** (no hay `service_role`: ADR-0010). La PWA y
las funciones solo reciben además `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`, públicas por diseño.
**La llave de Claude nunca pasa por el chat**: la skill de setup da el enlace a las variables del sitio, la persona
la pega (marcada como secreta, alcance Functions) **antes del único despliegue** (Netlify aplica variables nuevas
en el siguiente despliegue) y Claude verifica con `GET /health?check=claude` → `claude: "ok"`.

## Consecuencias
* (+) Un único lugar de secretos; rotación documentada.
* (−) Un paso manual en la configuración (es intencional).
