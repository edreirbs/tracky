# 0008. Libro mayor de monedas en SQL

- Estado: Aceptado · Fecha: 2026-11-05

## Opciones
1. Columna `balance` actualizada desde el cliente → manipulable. ❌
2. **Libro mayor `coin_ledger` de solo agregar + funciones `security definer`** (`complete_task`, `uncomplete_task`,
   `redeem_reward`) que aplican las reglas de la spec 003 en una transacción. ✅

## Decisión
Opción 2. El cliente no tiene `insert/update/delete` sobre `coin_ledger`; solo `select` propio. El saldo es una vista
(`sum(amount)`). Cada movimiento lleva `idempotency_key` único. Las reglas (tabla de valores) viven en `coin_rules`
para poder ajustarse sin migración.

## Consecuencias
* (+) Auditable, a prueba de dobles clics y de manipulación desde la consola del navegador.
* (−) La celebración es optimista en el cliente y se concilia con la respuesta de la función.
