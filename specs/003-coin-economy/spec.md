# Spec 003 — Economía de monedas y celebración

| Campo | Valor |
|---|---|
| Estado | **Aprobada** (2026-11-05; valores ajustables en `coin_rules`) |
| Fecha | 2026-11-05 |

## 1. Objetivo
Dar **recompensa inmediata** (dopamina) al terminar tareas y convertir el esfuerzo en **tiempo libre sin culpa**.
La economía debe tener sentido (más esfuerzo = más monedas), ser difícil de "trampear" y **nunca castigar**.

## 2. Reglas de ganancia
| # | Regla | Valor por defecto |
|---|---|---|
| R1 | Monedas base por tamaño | XS **5** · S **10** · M **20** · L **40** |
| R2 | **Sapo del día** (1 por día, la tarea más temida) | ×2 sobre la base |
| R3 | **Arranque**: primera tarea del día | +5 |
| R4 | **Racha**: días seguidos con ≥ 1 tarea terminada | +10 % por día, tope +50 %; 1 día de gracia por semana (no rompe la racha) |
| R5 | **Cofre sorpresa** (recompensa variable) | 1 de cada ~8 tareas, +5 a +15; lo decide el servidor |
| R6 | Pasos (subtareas) | 2 cada uno, máximo 10 pasos por tarea; la tarea madre conserva su valor completo |
| R7 | **Anti-trampa**: tarea creada y terminada en < 2 min | vale como XS sin bonos (excepto si vino de una reunión) |
| R8 | **Tope diario** de ganancias | 300 (tras el tope, se celebra igual pero sin monedas, con mensaje amable de descanso) |
| R9 | **Deshacer** (≤ 24 h) | revierte exactamente lo ganado por esa tarea (movimiento inverso) |

Fórmula: `total = round((base × sapo) × (1 + racha)) + arranque + cofre`, sujeto a R7 y R8.

## 3. Reglas de gasto (canje)
| Recompensa por defecto | Costo |
|---|---|
| 15 min de tiempo libre | 30 🪙 |
| 30 min de tiempo libre | 55 🪙 |
| 1 h de tiempo libre | 100 🪙 |
| Personalizada (p. ej. "un episodio", "postre") | la define el usuario (mín. 10) |

* Referencia: un día productivo típico (2 M + 3 S + 2 XS + arranque) ≈ 95 🪙 ≈ 1 h libre.
* Canjear inicia, si el usuario quiere, un **temporizador de tiempo libre** visible ("disfrútalo, te lo ganaste").
* El saldo nunca es negativo; no se puede canjear lo que no se tiene.

## 4. Lo que nunca pasa (constitución VIII)
* No se restan monedas por tareas no hechas, rachas perdidas ni fechas pasadas.
* No hay rankings ni comparación con otras personas.
* No hay mensajes de culpa; al perder una racha: "¡Nueva racha hoy! 🔥".

## 5. Celebración
| Evento | Animación |
|---|---|
| Terminar XS/S | confeti discreto de Foco Diario (16 piezas en colores de post-it) + contador de 🪙 sube + vibración corta (si existe) |
| Terminar M/L | confeti a pantalla completa + monedas que vuelan al saldo |
| Sapo del día | "fiesta": confeti, serpentinas y mensaje especial |
| Cofre sorpresa | cofre que se abre con el bono |
| Racha de 7, 30, 100 días / nivel nuevo | pantalla de logro |

* Canvas nativo, sin dependencias pesadas; < 100 ms desde el clic; 60 fps en equipos modestos.
* `prefers-reduced-motion`: sin partículas, solo un destello y el contador. Sonido apagado por defecto.

## 6. Niveles (cosméticos)
Nivel por monedas ganadas en la vida (no se pierden al canjear): 0, 100, 300, 700, 1500, 3000… Desbloquean temas de
color o estilos de confeti. No dan ventajas.

## 7. Requisitos funcionales
| ID | Requisito |
|---|---|
| FR-201 | `coin_ledger(id, user_id, amount, kind, task_id, reward_id, idempotency_key unique, meta jsonb, created_at)` de solo agregar. |
| FR-202 | `complete_task(task_id, idempotency_key)` aplica R1–R8 en una transacción y devuelve el desglose. |
| FR-203 | `uncomplete_task(task_id)` aplica R9. |
| FR-204 | `redeem_reward(reward_id, idempotency_key)` valida saldo y registra el canje. |
| FR-205 | El cliente solo puede leer su ledger; no puede insertar ni editar (prueba de RLS). |
| FR-206 | `coin_rules` guarda los valores de la tabla de § 2; cambiarlos no requiere migración. |
| FR-207 | La UI muestra saldo, racha, nivel, historial y el desglose de cada ganancia ("10 base + 2 racha + 5 arranque"). |

## 8. Preguntas abiertas
* Q1. ¿El tiempo libre es solo simbólico o quieres el temporizador? *Propuesta:* temporizador opcional.
* ~~Q2. ¿Valores de la tabla OK?~~ → **Aprobados (2026-11-05).** Se revisan tras 2 semanas de uso.
