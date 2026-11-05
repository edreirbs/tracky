import type Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../src/env.js";
import type { Deps } from "../src/routes/notes.js";
import type { SupabaseRest } from "../src/supabase/client.js";

export const USER = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const TOKEN = "token-de-ana";

export class MemoryKV {
  store = new Map<string, string>();
  async get(key: string, type?: "json" | "text") {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    STATE: new MemoryKV(),
    APP_URL: "https://tracky-prueba.netlify.app/",
    SUPABASE_URL: "https://proyecto.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    CLAUDE_MODEL: "claude-opus-5-5",
    CLAUDE_FAST_MODEL: "claude-haiku-5-5",
    CLAUDE_EFFORT: "medium",
    ANTHROPIC_API_KEY: "test",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    INTERNAL_KEY: "internal",
    ...overrides,
  };
}

type Row = Record<string, unknown>;

/** Supabase simulado: tablas en memoria con filtros eq.* como PostgREST y RLS simple por user_id. */
export class FakeDb {
  tables: Record<string, Row[]> = { tags: [], notes: [], profiles: [], tasks: [], people: [] };
  rpcs: Record<string, (args: Row) => unknown> = {};
  calls: Array<{ who: string; op: string; table: string; query?: string }> = [];
  private seq = 0;

  client(who: "service" | string): SupabaseRest {
    const filters = (query: string) =>
      query
        .split("&")
        .map((p) => p.split("="))
        .filter(([k, v]) => k && v?.startsWith("eq."))
        .map(([k, v]) => [k!, decodeURIComponent(v!.slice(3))] as const);
    const visible = (r: Row) => who === "service" || r.user_id === who;
    const match = (r: Row, query: string) => visible(r) && filters(query).every(([k, v]) => String(r[k]) === v);
    return {
      select: async (table: string, query: string) => {
        this.calls.push({ who, op: "select", table, query });
        return (this.tables[table] ?? []).filter((r) => match(r, query));
      },
      insert: async (table: string, row: Row, opts: { onConflict?: string } = {}) => {
        this.calls.push({ who, op: "insert", table });
        const list = (this.tables[table] ??= []);
        const keys = opts.onConflict?.split(",") ?? [];
        const existing = keys.length ? list.find((r) => keys.every((k) => r[k] === row[k])) : undefined;
        if (existing) {
          Object.assign(existing, row);
          return [existing];
        }
        const created = { id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`, ...row };
        list.push(created);
        return [created];
      },
      update: async (table: string, filter: string, patch: Row) => {
        this.calls.push({ who, op: "update", table, query: filter });
        const rows = (this.tables[table] ?? []).filter((r) => match(r, filter));
        rows.forEach((r) => Object.assign(r, patch));
        return rows;
      },
      rpc: async (fn: string, args: Row) => {
        this.calls.push({ who, op: "rpc", table: fn });
        const f = this.rpcs[fn];
        if (!f) throw new Error(`rpc no simulada: ${fn}`);
        return f(args);
      },
    } as unknown as SupabaseRest;
  }
}

/** Claude simulado: devuelve una secuencia de mensajes finales. */
export function fakeAnthropic(messages: Array<Record<string, unknown>>) {
  const requests: Array<Record<string, unknown>> = [];
  const client = {
    beta: {
      messages: {
        stream: (params: Record<string, unknown>) => {
          requests.push(structuredClone(params));
          const m = messages.shift();
          return {
            finalMessage: async () => {
              if (!m) throw new Error("sin respuesta simulada");
              return m;
            },
          };
        },
      },
    },
    models: { retrieve: async () => ({ id: "claude-opus-5-5" }) },
  } as unknown as Anthropic;
  return { client, requests };
}

export function claudeMessage(output: Record<string, unknown> | string, stop_reason = "end_turn", extra: unknown[] = []) {
  return {
    model: "claude-opus-5-5",
    stop_reason,
    content: [...extra, { type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }],
    usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
  };
}

export function toolUseMessage(calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) {
  return {
    model: "claude-opus-5-5",
    stop_reason: "tool_use",
    content: calls.map((c) => ({ type: "tool_use", ...c })),
    usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
  };
}

export const TAGS = [
  { id: "t-proy", user_id: USER, name: "Proyecto Aula", description: "Remodelación del aula", signals: ["proyectores"], is_fallback: false, sort: 1 },
  { id: "t-equipo", user_id: USER, name: "Equipo", description: "Juntas del equipo", signals: [], is_fallback: false, sort: 2 },
  { id: "t-otros", user_id: USER, name: "Otros", description: "Todo lo demás", signals: [], is_fallback: true, sort: 9 },
];

export const validOutput = {
  title: "Proyecto Aula – Cotización de proyectores",
  tag: "Proyecto Aula",
  tag_confidence: 0.92,
  tag_alternatives: ["Equipo", "Inventada"],
  tag_rationale: "Se habló de los proyectores del aula.",
  estado: "Normal",
  estado_rationale: "Sin urgencias.",
  summary_markdown: "## Resumen\nSe revisaron cotizaciones.",
  key_points: ["Punto"],
  decisions: ["Decisión"],
  action_items: [{ task: "Pedir cotización", owner: "Ana", due: "2026-11-10" }],
  next_steps_short: "• Pedir cotización – Ana",
  language: "es-MX",
  speaker_names: [],
  speaker_fixes: [],
};

export function makeDeps(db: FakeDb, anthropic: Anthropic, enqueued: string[] = []): Deps {
  return {
    service: db.client("service"),
    asUser: (token) => db.client(token === TOKEN ? USER : OTHER),
    anthropic,
    enqueue: async (ref) => {
      enqueued.push(ref);
    },
  };
}

/** fetch simulado para Supabase Auth: TOKEN = Ana; cualquier otro, inválido. */
export const authFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const auth = new Headers(init?.headers).get("authorization");
  if (String(input).endsWith("/auth/v1/user") && auth === `Bearer ${TOKEN}`) {
    return new Response(JSON.stringify({ id: USER, email: "ana@example.com" }), { status: 200 });
  }
  return new Response(JSON.stringify({ msg: "invalid" }), { status: 401 });
}) as typeof fetch;
