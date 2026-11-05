/// <reference types="@netlify/functions" />
// Adaptador a Netlify Functions: entorno, almacenamiento (Blobs) y cola (función en segundo plano).
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { DEFAULTS, type Env, type KVLike } from "../env.js";
import { hmacHex, randomToken } from "../lib/http.js";
import type { Deps } from "../routes/notes.js";
import { SupabaseRest } from "../supabase/client.js";

export const RUN_PATH = "/internal/run-note";

/** KV sobre Netlify Blobs con consistencia fuerte y expiración en metadatos. */
export function blobsKV(): KVLike {
  const store = getStore({ name: "state", consistency: "strong" });
  return {
    async get<T>(key: string): Promise<T | null> {
      const entry = await store.getWithMetadata(key, { type: "json" });
      if (entry === null) return null;
      const exp = (entry.metadata as { exp?: number } | undefined)?.exp;
      if (exp && exp < Date.now()) {
        await store.delete(key);
        return null;
      }
      return entry.data as T;
    },
    async put(key, value, opts) {
      await store.set(key, value, { metadata: opts?.expirationTtl ? { exp: Date.now() + opts.expirationTtl * 1000 } : {} });
    },
    async delete(key) {
      await store.delete(key);
    },
  };
}

/** Llave interna: se crea al azar la primera vez y vive solo en Blobs. */
async function internalKey(): Promise<string> {
  const fromEnv = Netlify.env.get("INTERNAL_KEY");
  if (fromEnv) return fromEnv;
  const store = getStore({ name: "secrets", consistency: "strong" });
  const existing = await store.get("internal-key", { type: "text" });
  if (existing) return existing;
  await store.set("internal-key", randomToken(48), { onlyIfNew: true });
  return (await store.get("internal-key", { type: "text" })) ?? "";
}

export async function loadEnv(siteUrl: string): Promise<Env> {
  const get = (k: string) => Netlify.env.get(k) ?? "";
  return {
    STATE: blobsKV(),
    APP_URL: get("APP_URL") || `${siteUrl.replace(/^http:/, "https:").replace(/\/$/, "")}/`,
    // La PWA usa los mismos valores públicos (VITE_*) en el build.
    SUPABASE_URL: get("SUPABASE_URL") || get("VITE_SUPABASE_URL"),
    SUPABASE_PUBLISHABLE_KEY: get("SUPABASE_PUBLISHABLE_KEY") || get("VITE_SUPABASE_PUBLISHABLE_KEY"),
    CLAUDE_MODEL: get("CLAUDE_MODEL") || DEFAULTS.CLAUDE_MODEL,
    CLAUDE_FAST_MODEL: get("CLAUDE_FAST_MODEL") || DEFAULTS.CLAUDE_FAST_MODEL,
    CLAUDE_EFFORT: get("CLAUDE_EFFORT") || DEFAULTS.CLAUDE_EFFORT,
    ANTHROPIC_API_KEY: get("ANTHROPIC_API_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: get("SUPABASE_SERVICE_ROLE_KEY"),
    INTERNAL_KEY: await internalKey(),
    GIT_SHA: get("COMMIT_REF").slice(0, 7) || undefined,
  };
}

/** Secreto que la API usa para invocar la función en segundo plano (derivado, nunca expuesto). */
export function internalSecret(env: Env): Promise<string> {
  return hmacHex(env.INTERNAL_KEY, "internal-run-note");
}

export function makeDeps(env: Env, origin: string): Deps {
  return {
    service: new SupabaseRest(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_ROLE_KEY),
    asUser: (token) => new SupabaseRest(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, token),
    anthropic: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 }),
    enqueue: async (jobRef) => {
      const res = await fetch(`${origin}${RUN_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": await internalSecret(env) },
        body: JSON.stringify({ job: jobRef }),
      });
      if (res.status !== 202 && !res.ok) throw new Error(`No se pudo encolar (${res.status})`);
    },
  };
}
