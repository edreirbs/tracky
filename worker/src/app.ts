import type Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireAuth } from "./auth.js";
import type { AppEnv, Env } from "./env.js";
import { PROMPTS_VERSION } from "./generated/prompts.js";
import { HttpError, logEvent, problem, randomToken } from "./lib/http.js";
import { allow } from "./lib/ratelimit.js";
import { assistRoutes } from "./routes/assist.js";
import { type DepsFactory, notesRoutes } from "./routes/notes.js";
import { type Fetch, SupabaseError } from "./supabase/client.js";

/** Verificación de la llave de Claude para /health?check=claude (sin costo: consulta el modelo). */
async function claudeStatus(anthropic: Anthropic, env: Env): Promise<"ok" | "missing" | "invalid" | "error"> {
  if (!env.ANTHROPIC_API_KEY) return "missing";
  try {
    await anthropic.models.retrieve(env.CLAUDE_MODEL);
    return "ok";
  } catch (err) {
    const status = (err as { status?: number }).status;
    return status === 401 || status === 403 ? "invalid" : "error";
  }
}

export function createApp(depsFactory: DepsFactory, fetchImpl: Fetch = fetch) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("requestId", randomToken(9));
    const t0 = Date.now();
    await next();
    c.header("x-request-id", c.get("requestId"));
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("cache-control", "no-store");
    logEvent({
      rid: c.get("requestId"),
      method: c.req.method,
      path: new URL(c.req.url).pathname.replace(/\/notes\/[^/]+/, "/notes/:id"),
      status: c.res.status,
      ms: Date.now() - t0,
    });
  });

  app.get("/health", async (c) => {
    const env = c.env;
    const checkClaude = c.req.query("check") === "claude" && allow("health:claude", 6);
    return c.json({
      status: "ok",
      app: "tracky",
      version: env.GIT_SHA ?? "dev",
      prompts: PROMPTS_VERSION,
      // Solo indica si cada variable existe; nunca su valor (FR-404).
      configured: {
        supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY),
        serviceRole: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
        anthropic: Boolean(env.ANTHROPIC_API_KEY),
      },
      claude: checkClaude ? await claudeStatus(depsFactory(env).anthropic, env) : env.ANTHROPIC_API_KEY ? "configured" : "missing",
      model: env.CLAUDE_MODEL,
    });
  });

  app.use("/v1/*", requireAuth(fetchImpl));
  app.use(
    "/v1/*",
    bodyLimit({ maxSize: 2 * 1024 * 1024, onError: () => problem(new HttpError(413, "payload_too_large", "Cuerpo demasiado grande")) }),
  );
  app.use("/v1/*", async (c, next) => {
    // Las consultas de estado (polling) no cuentan contra el límite.
    if (c.req.method !== "GET" && !allow(`u:${c.get("userId")}`, 30)) {
      const res = problem(new HttpError(429, "rate_limited", "Demasiadas solicitudes", true));
      res.headers.set("retry-after", "60");
      return res;
    }
    await next();
  });
  app.route("/v1", notesRoutes(depsFactory));
  app.route("/v1", assistRoutes(depsFactory));

  app.notFound(() => problem(new HttpError(404, "not_found", "Ruta no encontrada")));
  app.onError((err) => {
    if (err instanceof HttpError) return problem(err);
    if (err instanceof SupabaseError) {
      return problem(new HttpError(err.status === 401 ? 401 : 502, "upstream_supabase_error", "Error al hablar con Supabase", err.retryable, err.code));
    }
    const status = (err as { status?: number }).status;
    if (typeof status === "number" && err.constructor.name.includes("Error") && "headers" in err) {
      // Errores del SDK de Anthropic (sin contenido).
      return problem(new HttpError(502, "upstream_llm_error", "Error al hablar con Claude", status >= 500 || status === 429, String(status)));
    }
    console.error("unhandled", err instanceof Error ? err.name : "unknown");
    return problem(new HttpError(500, "internal_error", "Error interno", true));
  });

  return app;
}
