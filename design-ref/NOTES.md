# Notas de diseño: lo que Tracky toma de "Foco Diario" (v1.0)

Fuente: [`foco-diario/`](foco-diario/) (paquete original, sin cambios). Metodología: [METODOLOGIA.md](foco-diario/METODOLOGIA.md).

## Esencia que se conserva
* **Función ejecutiva externa** (Barkley): la información aparece en el punto de acción. *Cada pantalla responde una sola pregunta.*
* **Mundo visual "pizarra ejecutiva con post-its":** fondo de grafito mate, hojas de papel para listas y formularios,
  post-its en tonos sobrios ligeramente girados con chincheta, títulos con tipografía de marcador.
* **Color del post-it = persona** (codificación visual: se sabe de quién es algo sin leer).
* **Máximo 3 en Ahora** (límite WIP de Kanban). Es la regla central; no se sube.
* **Mostrar poco:** Siguientes y Esperando muestran 4 post-its y "Ver todos".
* **Nunca regañar:** si el tiempo se pasa, la barra cambia de color y dice "está bien".
* **Celebrar** con confeti en los colores de los post-its; respeta `prefers-reduced-motion`.

## Tokens (copiar tal cual a `web/src/ui/tokens.css`)
| Token | Valor | Uso |
|---|---|---|
| `--board` / `--board-2` / `--frame` | `#2C3230` / `#353C39` / `#1F2423` | pizarra |
| `--chalk` / `--chalk-dim` / `--chalk-line` | `#ECEEE9` / `#A3AAA5` / `#46504C` | texto y líneas sobre pizarra |
| `--paper` / `--paper-ink` / `--paper-muted` / `--paper-line` | `#F7F6F1` / `#20252A` / `#69706C` / `#E1DFD6` | hojas de papel |
| `--accent` / `--accent-deep` / `--accent-soft` | `#2F5BD3` / `#2147A8` / `#E2E9FB` | acción principal |
| `--hi` | `#F2D45C` | resaltador, foco, pestaña activa |
| `--good` / `--warn` | `#2E8A5E` / `#C2482F` | hecho / aviso (nunca para regañar) |
| `--n0..--n5` | `#F3E3A1 #F1D0C8 #CFE2D0 #C9DBEA #DDD4EB #F2D9B3` | post-it por persona |
| `--p0..--p5` | `#C9A82A #C9705E #4F9A68 #4C80B5 #8A70B8 #C98A3A` | punto/acento por persona |
| `--f-ui` / `--f-marker` | Manrope / Caveat | interfaz / títulos de marcador |
| `--pin-shadow` | `0 1px 1px rgba(0,0,0,.25), 0 12px 20px -12px rgba(0,0,0,.65)` | sombra de post-it |

Las fuentes se **autoalojan** en la PWA (sin Google Fonts en tiempo de ejecución, por CSP y privacidad).

## Lo que cambia en Tracky
| Foco Diario | Tracky | Motivo |
|---|---|---|
| Archivo cifrado local (File System Access, AES-GCM) | Supabase con RLS + outbox local | Req. 1–2; varios dispositivos; Safari |
| "Pregúntale" sin IA | Pregúntale a Tracky con Claude (spec 004) | Req. 4; opt-in explícito, instancia propia |
| Tipo "Reunión" (idea pendiente) | Notas de la grabadora, acuerdos → Procesar en un clic | Req. 3; ya existe la grabadora |
| "Hecho hoy" + contador | + monedas, racha, canjes (spec 003) | Req. 8 |
| Confeti discreto (16 piezas) | Confeti escalonado: discreto en tareas chicas, fiesta en sapo/logros | Req. 8 pide fiesta; se mantiene sobrio por defecto |
| Seguridad (contraseña, USB) | Sesión de Supabase; exportar a Markdown/JSON | Otro modelo de datos |
