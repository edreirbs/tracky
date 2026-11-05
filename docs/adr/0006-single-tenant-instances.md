# 0006. Una instancia por persona

- Estado: Propuesto · Fecha: 2026-11-05

## Opciones
1. **Cada persona despliega su propia copia** (repo + Supabase + Netlify + llave). ✅
2. Servicio multiusuario operado por un dueño (pagos, soporte, privacidad de terceros, costos de Claude ajenos).

## Decisión
Opción 1. El esquema conserva `user_id` en todo (por RLS y para no cerrar la puerta a varios usuarios por instancia).

## Consecuencias
* (+) Privacidad total, costos de Claude a cargo de cada quien, sin operación central.
* (−) Las actualizaciones se traen desde la plantilla (la skill ofrece `/tracky-update`).
