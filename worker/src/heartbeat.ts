// Latido diario a Supabase (FR-410, ADR-0011). Sin datos de nadie: solo llama tracky_heartbeat().
import type { Env } from "./env.js";
import { logEvent } from "./lib/http.js";
import { type Fetch, SupabaseRest } from "./supabase/client.js";

export async function heartbeat(env: Pick<Env, "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY">, fetchImpl: Fetch = fetch): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    logEvent({ evt: "heartbeat", ok: false, reason: "not_configured" });
    return false;
  }
  try {
    const db = new SupabaseRest(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_PUBLISHABLE_KEY, fetchImpl);
    await db.rpc<string>("tracky_heartbeat", {});
    logEvent({ evt: "heartbeat", ok: true });
    return true;
  } catch (err) {
    logEvent({ evt: "heartbeat", ok: false, reason: err instanceof Error ? err.name : "unknown" });
    return false;
  }
}
