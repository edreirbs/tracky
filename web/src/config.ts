// La API vive en el mismo dominio que la app (Netlify Functions): base vacía = mismo origen.
export const WORKER_URL: string = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? "";
export const BRIDGE_URL: string = (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? "http://127.0.0.1:47831";
// Valores públicos de Supabase (la publishable key es pública por diseño; RLS protege los datos).
export const SUPABASE_URL: string = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
export const SUPABASE_PUBLISHABLE_KEY: string = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";
export const DEFAULT_TEMPLATE = "general";
