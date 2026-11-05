// Cliente mínimo de Supabase (PostgREST + Auth) sobre fetch: fácil de simular en pruebas.
// Siempre con el JWT del usuario: RLS aplica en todo (Tracky no usa service_role).

export class SupabaseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export type Fetch = typeof fetch;

export class SupabaseRest {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly bearer: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: this.apiKey,
          authorization: `Bearer ${this.bearer}`,
          "content-type": "application/json",
          accept: "application/json",
          ...(prefer ? { prefer } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new SupabaseError(0, "network_error", true, "No se pudo conectar con Supabase");
    }
    const text = await res.text();
    if (!res.ok) {
      let code = `http_${res.status}`;
      let message = "Error de Supabase";
      try {
        const j = JSON.parse(text) as { code?: string; message?: string; hint?: string };
        code = j.hint === "saldo_insuficiente" ? "saldo_insuficiente" : (j.code ?? code);
        message = j.message ?? message;
      } catch {
        /* cuerpo no JSON */
      }
      throw new SupabaseError(res.status, code, res.status >= 500 || res.status === 429, message);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  select<T>(table: string, query: string): Promise<T[]> {
    return this.req<T[]>("GET", `${table}?${query}`);
  }

  insert<T>(table: string, rows: unknown, opts: { onConflict?: string } = {}): Promise<T[]> {
    const q = opts.onConflict ? `?on_conflict=${encodeURIComponent(opts.onConflict)}` : "";
    const prefer = `return=representation${opts.onConflict ? ",resolution=merge-duplicates" : ""}`;
    return this.req<T[]>("POST", `${table}${q}`, rows, prefer);
  }

  update<T>(table: string, filter: string, patch: unknown): Promise<T[]> {
    return this.req<T[]>("PATCH", `${table}?${filter}`, patch, "return=representation");
  }

  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return this.req<T>("POST", `rpc/${fn}`, args);
  }
}

/** Valida el token con Supabase Auth (funciona con llaves simétricas o asimétricas del proyecto). */
export async function getAuthUser(
  url: string,
  apiKey: string,
  token: string,
  fetchImpl: Fetch = fetch,
): Promise<{ id: string; email: string | null } | null> {
  const res = await fetchImpl(`${url.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: apiKey, authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) throw new SupabaseError(0, "network_error", true, "No se pudo conectar con Supabase Auth");
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new SupabaseError(res.status, `http_${res.status}`, res.status >= 500, "Error de Supabase Auth");
  const user = (await res.json()) as { id?: string; email?: string };
  return user.id ? { id: user.id, email: user.email ?? null } : null;
}

/** Filtro seguro de PostgREST para un valor (comillas dobles escapadas). */
export function eq(value: string): string {
  return `eq.${encodeURIComponent(value)}`;
}
