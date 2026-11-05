// Autenticación con Supabase Auth (ADR-0005). La PWA inicia sesión con enlace mágico y manda su
// access token; aquí se valida contra Supabase y se guarda en caché unos segundos.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env.js";
import { HttpError, problem, sha256 } from "./lib/http.js";
import { type Fetch, getAuthUser } from "./supabase/client.js";

const CACHE_MS = 60_000;
const cache = new Map<string, { userId: string; until: number }>();

export function requireAuth(fetchImpl: Fetch = fetch): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return problem(new HttpError(401, "unauthorized", "Falta el token"));
    const key = await sha256(token);
    const now = Date.now();
    let hit = cache.get(key);
    if (!hit || hit.until < now) {
      const user = await getAuthUser(c.env.SUPABASE_URL, c.env.SUPABASE_PUBLISHABLE_KEY, token, fetchImpl);
      if (!user) return problem(new HttpError(401, "unauthorized", "Sesión inválida o vencida"));
      hit = { userId: user.id, until: now + CACHE_MS };
      cache.set(key, hit);
      if (cache.size > 500) for (const [k, v] of cache) if (v.until < now) cache.delete(k);
    }
    c.set("userId", hit.userId);
    c.set("userToken", token);
    await next();
  };
}

export function _clearAuthCache(): void {
  cache.clear();
}
