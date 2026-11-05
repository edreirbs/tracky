// Función en segundo plano (hasta 15 min): resume con Claude y guarda la nota en Supabase.
import type { Config, Context } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import type * as Server from "../../worker/src/netlify/server.js";

// @ts-expect-error -- archivo generado en el build (ver api.mts)
const server = (await import("../../worker/dist/server.mjs")) as typeof Server;

export default async (req: Request, context: Context) => {
  const origin = new URL(req.url).origin;
  const env = await server.loadEnv(context.site.url ?? origin);
  const expected = Buffer.from(await server.internalSecret(env));
  const given = Buffer.from(req.headers.get("x-internal-secret") ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return;
  const { job } = (await req.json()) as { job?: string };
  const m = typeof job === "string" ? /^([0-9a-f-]{36}):([0-9a-f-]{36})$/.exec(job) : null;
  if (!m) return;
  await server.runJob(env, server.makeDeps(env, origin), m[1]!, m[2]!);
};

// La ruta debe ser literal (Netlify lee esta configuración sin ejecutar el código).
export const config: Config = { path: "/internal/run-note", background: true, method: "POST" };
