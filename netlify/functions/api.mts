// API de Tracky (/health, notas, cargador de tareas, asistente). Mismo origen que la app: sin CORS.
import type { Config, Context } from "@netlify/functions";
import type * as Server from "../../worker/src/netlify/server.js";

// worker/dist/server.mjs lo genera el build (`pnpm --filter @tracky/worker build:server`) con todas
// sus dependencias, para que la función no dependa de node_modules en Netlify.
// @ts-expect-error -- archivo generado en el build
const server = (await import("../../worker/dist/server.mjs")) as typeof Server;

export default async (req: Request, context: Context) => {
  const origin = new URL(req.url).origin;
  const env = await server.loadEnv(context.site.url ?? origin);
  const app = server.createApp(() => server.makeDeps(env, origin));
  return app.fetch(req, env, { waitUntil: (p: Promise<unknown>) => context.waitUntil(p), passThroughOnException: () => {}, props: {} });
};

export const config: Config = { path: ["/health", "/v1/*"] };
