import preact from "@preact/preset-vite";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** CSP estricta solo en build (el dev server de Vite necesita scripts inline para HMR). */
function csp(bridgeUrl: string, supabaseUrl: string): Plugin {
  const bridgeWs = bridgeUrl.replace(/^http/, "ws");
  const supa = supabaseUrl ? `${supabaseUrl} ${supabaseUrl.replace(/^https/, "wss")}` : "";
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${bridgeUrl} ${bridgeWs} ${supa}`.trim(),
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace("<!--CSP-->", `<meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const bridgeUrl = env.VITE_BRIDGE_URL || "http://127.0.0.1:47831";
  return {
    base: env.VITE_BASE_PATH || "/",
    plugins: [preact(), csp(bridgeUrl, (env.VITE_SUPABASE_URL ?? "").replace(/\/$/, ""))],
    build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 }, // sin data: (CSP font-src 'self')
    // En desarrollo, /v1 y /health van a `netlify dev` (puerto 8888) o a la API que indiques.
    server: { port: 5173, strictPort: true, proxy: { "/v1": env.VITE_DEV_API || "http://127.0.0.1:8888", "/health": env.VITE_DEV_API || "http://127.0.0.1:8888" } },
    test: { environment: "jsdom" },
  };
});
