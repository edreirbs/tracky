// Pregúntale a Tracky (spec 004): Claude con herramientas de solo lectura sobre Supabase (RLS)
// y una herramienta de propuestas que la persona confirma en la pantalla.
import type Anthropic from "@anthropic-ai/sdk";
import { type AskRequest, type AskResponse, CITATION_LINK, type Citation, ProposedTask } from "@tracky/shared";
import type { Effort } from "../env.js";
import { ASSISTANT_PROMPT } from "../generated/prompts.js";
import { HttpError } from "../lib/http.js";
import { eq, type SupabaseRest } from "../supabase/client.js";

export const MAX_TOOL_ROUNDS = 6;
const MAX_TOOL_RESULT_CHARS = 24_000;

export const TOOLS = [
  {
    name: "search_everything",
    description:
      "Búsqueda de texto completo en notas de reunión, notas sueltas, tareas y contactos. Devuelve id, tipo, título y un fragmento. Úsala primero para casi cualquier pregunta.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Palabras clave en español (sin signos raros)" },
        limit: { type: "integer", minimum: 1, maximum: 30 },
      },
    },
  },
  {
    name: "get_note",
    description: "Lee una nota (reunión o nota suelta) por id: resumen, acuerdos, decisiones y, si se pide, la transcripción.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "string" }, include_transcript: { type: "boolean" } },
    },
  },
  {
    name: "list_notes",
    description: "Lista notas recientes, opcionalmente por rango de fechas o etiqueta.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        from: { type: "string", description: "AAAA-MM-DD" },
        to: { type: "string", description: "AAAA-MM-DD" },
        tag: { type: "string" },
        kind: { type: "string", enum: ["meeting", "memo"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "list_tasks",
    description:
      "Lista tareas por estado (inbox, now, next, waiting, done), persona o fecha límite. Incluye tamaño, energía, fecha, 'alguien me espera' y seguimiento.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        status: { type: "array", items: { type: "string", enum: ["inbox", "now", "next", "waiting", "done", "archived"] } },
        person: { type: "string" },
        due_before: { type: "string", description: "AAAA-MM-DD" },
        done_since: { type: "string", description: "AAAA-MM-DD (para tareas terminadas)" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "coin_summary",
    description: "Saldo de monedas, racha, nivel y movimientos de los últimos días.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: { days: { type: "integer", minimum: 1, maximum: 90 } },
    },
  },
  {
    name: "propose_tasks",
    description:
      "Propone crear tareas nuevas o mover tareas existentes (existing_task_id). NO las crea: la persona confirma en pantalla. Úsala solo cuando ayude de verdad.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["tasks"],
      properties: {
        tasks: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text"],
            properties: {
              text: { type: "string" },
              due: { type: ["string", "null"] },
              size: { type: "string", enum: ["XS", "S", "M", "L"] },
              status: { type: "string", enum: ["inbox", "now", "next", "waiting"] },
              existing_task_id: { type: ["string", "null"] },
              reason: { type: "string" },
            },
          },
        },
      },
    },
  },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clampInt = (v: unknown, def: number, max: number) => (Number.isInteger(v) ? Math.min(max, Math.max(1, v as number)) : def);

interface ToolState {
  titles: Map<string, Citation>;
  proposals: AskResponse["proposals"];
}

function remember(state: ToolState, kind: Citation["kind"], id: string, title: string) {
  state.titles.set(id, { kind, id, title });
}

/** Ejecuta una herramienta con el JWT del usuario (RLS). Devuelve texto para Claude. */
export async function runTool(db: SupabaseRest, name: string, input: Record<string, unknown>, state: ToolState): Promise<unknown> {
  switch (name) {
    case "search_everything": {
      const query = String(input.query ?? "").slice(0, 200);
      if (!query.trim()) return { results: [] };
      const rows = await db.rpc<Array<{ kind: string; id: string; title: string; snippet: string; created_at: string }>>("search_everything", {
        p_query: query,
        p_limit: clampInt(input.limit, 12, 30),
      });
      for (const r of rows) remember(state, r.kind === "task" ? "task" : r.kind === "contact" ? "contact" : "note", r.id, r.title);
      return { results: rows };
    }
    case "get_note": {
      const id = String(input.id ?? "");
      if (!UUID.test(id)) return { error: "id inválido" };
      const cols = `id,kind,title,created_at,started_at,estado,summary_md,body,key_points,decisions,action_items,next_steps,labels,tag:tags(name)${input.include_transcript ? ",transcript_text" : ""}`;
      const [n] = await db.select<{ id: string; title: string }>("notes", `select=${cols}&id=${eq(id)}`);
      if (!n) return { error: "no encontrada" };
      remember(state, "note", n.id, n.title);
      return n;
    }
    case "list_notes": {
      const f = [`select=id,kind,title,created_at,estado,next_steps,tag:tags(name)`, `order=created_at.desc`, `limit=${clampInt(input.limit, 15, 50)}`];
      if (typeof input.from === "string" && DATE.test(input.from)) f.push(`created_at=gte.${input.from}`);
      if (typeof input.to === "string" && DATE.test(input.to)) f.push(`created_at=lte.${input.to}T23:59:59`);
      if (input.kind === "meeting" || input.kind === "memo") f.push(`kind=eq.${input.kind}`);
      let rows = await db.select<{ id: string; title: string; tag: { name: string } | null }>("notes", f.join("&"));
      if (typeof input.tag === "string") rows = rows.filter((r) => r.tag?.name.toLowerCase() === String(input.tag).toLowerCase());
      for (const r of rows) remember(state, "note", r.id, r.title);
      return { notes: rows };
    }
    case "list_tasks": {
      const f = [
        "select=id,text,action,status,due,blocking,follow_up,waiting_on,size,energy,estimate_min,is_frog,tomorrow,done_at,created_at,person:people(name),note_id",
        "parent_id=is.null",
        `limit=${clampInt(input.limit, 40, 100)}`,
        "order=status.asc,due.asc.nullslast,sort.asc",
      ];
      const statuses = Array.isArray(input.status) ? input.status.filter((s) => typeof s === "string" && /^[a-z]+$/.test(s)) : [];
      f.push(statuses.length ? `status=in.(${statuses.join(",")})` : "status=in.(inbox,now,next,waiting)");
      if (typeof input.due_before === "string" && DATE.test(input.due_before)) f.push(`due=lte.${input.due_before}`);
      if (typeof input.done_since === "string" && DATE.test(input.done_since)) f.push(`done_at=gte.${input.done_since}`);
      let rows = await db.select<{ id: string; text: string; person: { name: string } | null }>("tasks", f.join("&"));
      if (typeof input.person === "string") {
        const p = input.person.toLowerCase();
        rows = rows.filter((r) => r.person?.name.toLowerCase().includes(p));
      }
      for (const r of rows) remember(state, "task", r.id, r.text);
      return { tasks: rows };
    }
    case "coin_summary": {
      const days = clampInt(input.days, 7, 90);
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const wallet = await db.rpc<unknown>("my_wallet", {});
      const ledger = await db.select<unknown>("coin_ledger", `select=amount,kind,local_day,breakdown&local_day=gte.${since}&order=created_at.desc&limit=200`);
      return { wallet, movements: ledger };
    }
    case "propose_tasks": {
      const list = Array.isArray(input.tasks) ? input.tasks.slice(0, 10) : [];
      for (const raw of list) {
        const p = ProposedTask.safeParse(raw);
        if (p.success && (p.data.existing_task_id === null || UUID.test(p.data.existing_task_id))) state.proposals.push(p.data);
      }
      return { ok: true, note: "Propuestas mostradas a la persona para que confirme. No digas que ya se crearon." };
    }
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

function wrapUntrusted(value: unknown): string {
  let text = JSON.stringify(value);
  if (text.length > MAX_TOOL_RESULT_CHARS) text = `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…(recortado)`;
  return `<untrusted_data>\n${text}\n</untrusted_data>`;
}

export async function ask(client: Anthropic, model: string, effort: Effort, db: SupabaseRest, req: AskRequest): Promise<AskResponse> {
  const state: ToolState = { titles: new Map(), proposals: [] };
  const system = `${ASSISTANT_PROMPT}\n\n<context>\nHoy: ${req.today}\nZona horaria: ${req.timeZone}\n</context>`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...req.history.map((t) => ({ role: t.role, content: t.text }) as Anthropic.Beta.BetaMessageParam),
    { role: "user", content: req.question },
  ];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const last = round === MAX_TOOL_ROUNDS;
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 16_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort },
      // Lo estable primero (instrucciones + herramientas) para aprovechar la caché.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      ...(last ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    });
    const message = await stream.finalMessage();
    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;
    usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;

    if (message.stop_reason === "refusal") throw new HttpError(422, "llm_refusal", "Claude no respondió esta pregunta");
    if (message.stop_reason !== "tool_use") {
      const answer = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      return { answer: answer || "No encontré una respuesta.", citations: citationsIn(answer, state), proposals: state.proposals, usage };
    }

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      let content: string;
      try {
        content = wrapUntrusted(await runTool(db, block.name, (block.input ?? {}) as Record<string, unknown>, state));
      } catch (err) {
        content = wrapUntrusted({ error: err instanceof Error ? err.message : "error" });
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  throw new HttpError(502, "upstream_llm_error", "El asistente no terminó a tiempo", true);
}

/** Solo cuenta como cita un id que de verdad devolvieron las herramientas. */
export function citationsIn(answer: string, state: ToolState): Citation[] {
  const out = new Map<string, Citation>();
  for (const m of answer.matchAll(CITATION_LINK)) {
    const c = state.titles.get(m[2]!);
    if (c) out.set(c.id, c);
  }
  return [...out.values()];
}
