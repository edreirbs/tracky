# Plan — Spec 003: economía de monedas

* Reglas R1–R9 en SQL (`complete_task`, `uncomplete_task`, `redeem_reward`, `my_wallet`, `tracky_streak`,
  `tracky_level`), `security definer`, sobre un libro mayor de solo agregar (ADR-0008). Valores en `coin_rules`.
* La celebración es optimista (canvas, < 100 ms) y el desglose llega del servidor.
* Pruebas de cada regla con PGlite (`supabase/test/schema.test.ts`).
