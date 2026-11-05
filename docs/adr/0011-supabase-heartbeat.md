# 0011. Latido diario para que Supabase no pause el proyecto

- Estado: Aceptado · Fecha: 2026-11-06

## Contexto
El plan gratuito de Supabase pausa los proyectos con 7 días sin actividad (vacaciones, una semana sin
juntas). Al volver, Tracky no carga hasta reanudarlo a mano (`/tracky-doctor`). La persona pidió que la
configuración inicial lo evite.

## Opciones
1. **GitHub Actions programado** → GitHub desactiva los workflows programados tras 60 días sin commits, y
   requiere guardar la URL y la llave en el repo.
2. **Función programada de Netlify** (`netlify/functions/heartbeat.mts`, una vez al día) → viaja en el mismo
   despliegue, usa las variables que ya existen y no agrega pasos. ✅
3. `pg_cron` dentro de Supabase → no sirve: un proyecto pausado no corre sus propios cron.

## Decisión
Opción 2. La función llama `rpc/tracky_heartbeat` con la publishable key; esa función (`security definer`)
solo actualiza un renglón técnico (`public.heartbeat`), sin datos de nadie, y nadie puede leer la tabla.

## Consecuencias
* (+) Cero pasos manuales; costo despreciable (una invocación al día).
* (−) Si se borra el sitio de Netlify, el latido se detiene (y Tracky ya no se usaría de todos modos).
* (−) No garantiza nada si Supabase cambia su política de inactividad; `/tracky-doctor` sigue sabiendo reanudar.
