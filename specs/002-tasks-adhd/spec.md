# Spec 002 — Organizador de tareas para TDAH (esencia "Foco Diario")

| Campo | Valor |
|---|---|
| Estado | **Borrador para revisión** |
| Fecha | 2026-11-05 |
| Diseño | [design-ref/NOTES.md](../../design-ref/NOTES.md) · paquete [Foco Diario](../../design-ref/foco-diario/) |

## 1. Problema
Las listas largas paralizan a las personas con TDAH. El problema no es saber qué hacer sino hacerlo en el momento
(Barkley). Tracky funciona como **función ejecutiva externa**: pone afuera y a la vista lo que la memoria de trabajo y
la percepción del tiempo no sostienen. **Cada pantalla responde una sola pregunta.**

## 2. Estructura (pestaña Tareas)
| Vista | Pregunta que responde | Metodología |
|---|---|---|
| **Barra de captura** (siempre arriba, en todas las pestañas) | "¿Qué tengo en mente?" | GTD: capturar |
| **Procesar** (una tarjeta a la vez) | "¿Qué es esto y qué hago con ello?" | GTD: aclarar + regla de 2 min |
| **Tablero: Ahora (máx. 3) · Siguientes · Esperando** | "¿Qué hago ahora?" | Kanban (límite WIP) + Eisenhower simplificado |
| **Esperando de…** | "¿A quién le tengo que volver a preguntar?" | GTD: en espera |
| **Personas** | "¿Cómo va lo de X?" | Áreas de responsabilidad |
| **Cerrar el día** | "¿Cómo dejo listo mañana?" | Ritual de *shutdown* (Newport) |
| **Archivo** (contactos, notas sueltas, etiquetas, `Ctrl+K`) | "¿Dónde está aquello?" | GTD: material de referencia / Segundo cerebro |
| **Pregúntale a Tracky** (panel) | cualquier pregunta | spec 004 |

## 3. El cargador de tareas (captura + procesar)
**Capturar** (tira de papel, siempre visible; atajo `N` o `/`):
```
┌────────────────────────────────────────────────────────────────┐
│ ¿Qué tienes en mente?  llamar a Ana mañana por lo del aula▌      │  ← Enter guarda en Bandeja
└────────────────────────────────────────────────────────────────┘
  Enter guarda · Shift+Enter guarda y sigue · @persona · Esc cierra
  sugerido: [Ana ●] [📅 mañana] [S · ~10 min · 10🪙]                 ← chips de Claude, editables, no bloquean
```
* Guardar es **instantáneo** (optimista) a la Bandeja; separar capturar de decidir evita perder cosas al ser interrumpido.
* Claude (asíncrono, `POST /v1/tasks/parse`) sugiere persona, fecha, tamaño/estimado y "alguien me espera".
  Sin conexión o sin Claude se guarda igual.
* Pegar varias líneas → ofrece una tarea por línea.

**Procesar** (una tarjeta a la vez, tres preguntas, con las sugerencias ya prellenadas):
1. ¿Cuál es la **siguiente acción física**? (convierte "lo de la sala" en "escribirle a Luis para reservar la sala 3")
2. ¿Toma **menos de 2 minutos**? → "Hazlo ya" con temporizador de 2 min.
3. ¿**De quién** es y **para cuándo**? → Ahora / Siguientes / Esperando de… (con fecha de seguimiento) / Archivo / Borrar.
* "Dividir en pasos" para lo grande (sugerido por Claude, editable).
* Muestra la recompensa en 🪙 desde aquí (motivación anticipada).

## 4. Historias
* **US-1 (P1)** Capturar en < 5 s desde cualquier pestaña, sin decidir nada.
* **US-2 (P1)** Procesar la Bandeja una tarjeta a la vez con 3 preguntas.
* **US-3 (P1)** Tablero con **máximo 3 post-its grandes en Ahora**; Siguientes ordenados solos; Esperando con seguimiento.
* **US-4 (P1)** Terminar → celebración + monedas (spec 003) + "Hecho hoy" crece. Deshacer 10 s.
* **US-5 (P2)** Temporizador visual con estimado contra real; tras 3 tareas medidas muestra "tardas 1.8× lo que calculas".
* **US-6 (P2)** Personas: color de post-it por persona y todo lo de cada una en una vista.
* **US-7 (P2)** Cerrar el día: 3 pasos y 3 **estrellas** para mañana que aparecen solas en Ahora.
* **US-8 (P2)** Acuerdos de una nota de reunión → Bandeja en un clic, con enlace a la nota (puente con spec 001).
* **US-9 (P2)** Archivo: contactos y notas sueltas con etiquetas; buscador global `Ctrl+K` (tareas, contactos, notas, reuniones).

## 5. Requisitos funcionales
| ID | Requisito |
|---|---|
| FR-101 | Tarea: `text`, `action` (siguiente acción física), `person_id`, `status` (inbox/now/next/waiting/done/archived), `due`, `blocking` (alguien me espera), `follow_up`, `waiting_on`, `size` (XS/S/M/L), `estimate_min`, `actual_min`, `tomorrow` (estrella), `is_frog`, `source` (manual/meeting/assistant), `note_id`, `parent_id`, `created_at`, `done_at`. |
| FR-102 | **Máximo 3 en Ahora.** Al intentar un 4.º, la app pide elegir cuál baja a Siguientes (nunca lo bloquea sin salida). |
| FR-103 | Siguientes y Esperando muestran 4 elementos y "Ver todos". Orden automático: vencida → hoy → mañana → "alguien me espera" → resto. |
| FR-104 | Captura con un solo campo; Enter guarda en Bandeja; sugerencias asíncronas de Claude como chips editables. |
| FR-105 | Procesar: una tarjeta a la vez, 3 preguntas, regla de 2 min con temporizador. |
| FR-106 | Esperando de…: fecha de seguimiento; el día indicado vuelve a aparecer arriba con "¿Ya te respondió?". |
| FR-107 | Temporizador visual por tarea; guarda estimado y real; muestra el factor tras ≥ 3 mediciones. Si se pasa: cambia de color y dice "está bien". |
| FR-108 | Personas (`people`: nombre, color 0–5) compartidas con las notas de reunión (participantes). |
| FR-109 | Cerrar el día: revisar Hecho hoy, mover lo pendiente, elegir hasta 3 estrellas → al día siguiente pasan a Ahora. |
| FR-110 | Terminar → `complete_task()` (spec 003) + celebración; deshacer 10 s → `uncomplete_task()`. |
| FR-111 | Lectura/escritura **directo a Supabase** con RLS; *outbox* local sin conexión. |
| FR-112 | Estilo visual según `design-ref/NOTES.md`: pizarra + papel + post-its, tokens tal cual, fuentes autoalojadas. |
| FR-113 | Nunca rojo de "atrasado": una tarea vencida se ofrece para mover a Hoy / Mañana / Algún día. |
| FR-114 | **Archivo** (como Foco Diario): contactos (`contacts`: nombre, empresa, teléfono, correo, `person_id`, etiquetas, fijado) y notas sueltas (`notes` con `kind = memo`: título, cuerpo, etiquetas, fijada). Lo que no es tarea sale de la lista de tareas. |
| FR-115 | Buscador `Ctrl+K` sobre tareas, contactos, notas sueltas y notas de reunión. |
| FR-116 | La pestaña **Notas** (spec 001) y el **Archivo** conviven: Notas se centra en reuniones; Archivo reúne contactos y notas sueltas, y enlaza a las reuniones de cada persona. |

## 6. No funcionales
| ID | Requisito |
|---|---|
| NFR-101 | Captura completa < 5 s; aparece en la Bandeja < 100 ms (optimista). |
| NFR-102 | Teclado completo, lector de pantalla, contraste AA, `prefers-reduced-motion`; usable a 400 px de ancho. |
| NFR-103 | Evals del parser: ≥ 90 % de fechas relativas correctas en es-MX ("el jueves", "pasado mañana", "fin de mes"). |
| NFR-104 | Prueba E2E equivalente a `foco-diario/pruebas/prueba-basica.js` (capturar, procesar, terminar, buscar) con Playwright. |

## 7. Decisiones y preguntas abiertas
* ~~Q1. ¿Conservar Archivo?~~ → **Resuelto (2026-11-05):** se conservan ambas, la pestaña Notas y el Archivo (FR-114 a FR-116).
* Q2. ¿Tareas que se repiten (idea abierta de Foco Diario)? *Propuesta:* v1.1.
