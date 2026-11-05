/** Subconjunto de almacenamiento clave-valor que usa el backend (Netlify Blobs en producción). */
export interface KVLike {
  get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  /** Solo trabajos en curso (la transcripción vive aquí hasta guardarse; después se borra). */
  STATE: KVLike;
  APP_URL: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  CLAUDE_MODEL: string;
  /** Modelo rápido para las sugerencias del cargador de tareas. */
  CLAUDE_FAST_MODEL: string;
  CLAUDE_EFFORT: string;
  // Secretos (variables secretas de Netlify, alcance Functions; ADR-0004)
  ANTHROPIC_API_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Llave para firmar llamadas internas a la función en segundo plano (se genera sola). */
  INTERNAL_KEY: string;
  GIT_SHA?: string;
}

export interface AuthVars {
  userId: string;
  /** JWT de Supabase del usuario: las consultas con él respetan RLS. */
  userToken: string;
  requestId: string;
}

export type AppEnv = { Bindings: Env; Variables: AuthVars };

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export function effortOf(env: Env): Effort {
  return (EFFORTS as readonly string[]).includes(env.CLAUDE_EFFORT) ? (env.CLAUDE_EFFORT as Effort) : "medium";
}

export const DEFAULTS = {
  CLAUDE_MODEL: "claude-opus-5-5",
  CLAUDE_FAST_MODEL: "claude-haiku-5-5",
  CLAUDE_EFFORT: "medium",
} as const;
