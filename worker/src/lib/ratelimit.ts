// Rate limit en memoria por isolate (mejor esfuerzo, sin escrituras a KV).
// Suficiente para un solo usuario; el tope duro de gasto está en la Console de Anthropic.
const buckets = new Map<string, { windowStart: number; count: number }>();

export function allow(key: string, limitPerMinute: number, now = Date.now()): boolean {
  const windowStart = Math.floor(now / 60_000) * 60_000;
  const b = buckets.get(key);
  if (!b || b.windowStart !== windowStart) {
    buckets.set(key, { windowStart, count: 1 });
    if (buckets.size > 1000) buckets.clear();
    return true;
  }
  b.count++;
  return b.count <= limitPerMinute;
}
