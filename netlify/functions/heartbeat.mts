// Latido diario (FR-410, ADR-0011): evita que Supabase (plan gratuito) pause el proyecto por inactividad.
import type { Config } from "@netlify/functions";
import type * as Server from "../../worker/src/netlify/server.js";

// @ts-expect-error -- archivo generado en el build (ver api.mts)
const server = (await import("../../worker/dist/server.mjs")) as typeof Server;

export default async () => {
  const get = (k: string) => Netlify.env.get(k) ?? "";
  await server.heartbeat({
    SUPABASE_URL: get("SUPABASE_URL") || get("VITE_SUPABASE_URL"),
    SUPABASE_PUBLISHABLE_KEY: get("SUPABASE_PUBLISHABLE_KEY") || get("VITE_SUPABASE_PUBLISHABLE_KEY"),
  });
};

// Una vez al día (UTC), en un minuto poco concurrido. Solo corre en despliegues publicados.
export const config: Config = { schedule: "17 9 * * *" };
