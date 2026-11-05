# 0001. Repo independiente a partir de meeting-recording

- Estado: Aceptado · Fecha: 2026-11-05

## Contexto
Tracky reutiliza casi todo `meeting-recording` (captura, puente, resumen), pero cambia el almacenamiento, agrega
tareas y se distribuye a cualquier persona. `meeting-recording` está en producción y no debe verse afectado (req. 10).

## Opciones
1. Rama o carpeta dentro de `meeting-recording` → comparte CI, `netlify.toml` y despliegues; riesgo de interferir.
2. *Fork* → hereda historial y remoto; confuso para terceros y ata Tracky a decisiones de Notion.
3. **Repo nuevo `tracky`, marcado como plantilla de GitHub**, con el código copiado y adaptado. ✅

## Decisión
Opción 3. Se copian `bridge/`, `packages/shared`, `web/`, `worker/`, `scripts/` y `prompts/`, se renombran los paquetes
(`@tracky/*`, `tracky-bridge`) y el puerto del puente pasa a **47831** para que ambos puentes convivan en la misma Mac.

## Consecuencias
* (+) Cero interferencia; terceros crean su copia con "Use this template".
* (−) Las mejoras del puente no se comparten solas; se portan a mano (aceptable).
