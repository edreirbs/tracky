// Contratos y reglas de dominio de Tracky (specs 002, 003 y 004).
import { z } from "zod";

// ------------------------------------------------------------------------------------------------
// Tareas (spec 002)
// ------------------------------------------------------------------------------------------------
export const TASK_STATUSES = ["inbox", "now", "next", "waiting", "done", "archived"] as const;
export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const TaskSize = z.enum(["XS", "S", "M", "L"]);
export type TaskSize = z.infer<typeof TaskSize>;
export const Energy = z.enum(["low", "medium", "high"]);
export type Energy = z.infer<typeof Energy>;

/** Regla central de Foco Diario: máximo 3 en Ahora (FR-102). */
export const MAX_NOW = 3;
/** Siguientes y Esperando muestran 4 y "Ver todos" (FR-103). */
export const VISIBLE_PER_COLUMN = 4;

export interface TaskLike {
  id: string;
  status: TaskStatus;
  due: string | null;
  blocking: boolean;
  follow_up?: string | null;
  sort: number;
  created_at: string;
}

/**
 * Orden automático de Siguientes (FR-103): vencida → hoy → mañana → "alguien me espera" → resto;
 * dentro de cada grupo, por fecha y luego por orden manual.
 */
export function nextRank(t: Pick<TaskLike, "due" | "blocking">, today: string): number {
  if (t.due && t.due < today) return 0;
  if (t.due === today) return 1;
  if (t.due && t.due === addDays(today, 1)) return 2;
  if (t.blocking) return 3;
  return 4;
}

export function sortNext<T extends TaskLike>(tasks: readonly T[], today: string): T[] {
  return [...tasks].sort(
    (a, b) =>
      nextRank(a, today) - nextRank(b, today) ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      a.sort - b.sort ||
      a.created_at.localeCompare(b.created_at),
  );
}

/** Esperando: primero las que ya toca volver a preguntar (FR-106). */
export function sortWaiting<T extends TaskLike>(tasks: readonly T[], today: string): T[] {
  const due = (t: T) => (t.follow_up && t.follow_up <= today ? 0 : 1);
  return [...tasks].sort(
    (a, b) => due(a) - due(b) || (a.follow_up ?? "9999").localeCompare(b.follow_up ?? "9999") || a.sort - b.sort,
  );
}

/** ¿Cabe otra tarea en Ahora? Si no, la UI pide elegir cuál baja (nunca bloquea sin salida). */
export function nowIsFull(tasks: readonly Pick<TaskLike, "status">[]): boolean {
  return tasks.filter((t) => t.status === "now").length >= MAX_NOW;
}

/** Fecha local AAAA-MM-DD en una zona horaria. */
export function localDate(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA ya produce AAAA-MM-DD
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Factor estimado contra real tras ≥ 3 mediciones (FR-107): "tardas 1.8× lo que calculas". */
export function estimateFactor(samples: ReadonlyArray<{ estimate_min: number | null; actual_min: number | null }>): number | null {
  const valid = samples.filter((s) => (s.estimate_min ?? 0) > 0 && (s.actual_min ?? 0) > 0);
  if (valid.length < 3) return null;
  const est = valid.reduce((a, s) => a + (s.estimate_min ?? 0), 0);
  const act = valid.reduce((a, s) => a + (s.actual_min ?? 0), 0);
  return Math.round((act / est) * 10) / 10;
}

/** Monedas estimadas que se muestran al capturar (spec 003 R1; el servidor decide el total real). */
export const BASE_COINS: Record<TaskSize, number> = { XS: 5, S: 10, M: 20, L: 40 };

// ------------------------------------------------------------------------------------------------
// POST /v1/tasks/parse (FR-103/104)
// ------------------------------------------------------------------------------------------------
export const ParseTaskRequest = z
  .object({
    text: z.string().trim().min(1).max(500),
    today: z.iso.date(),
    timeZone: z.string().min(1).max(64),
    people: z.array(z.string().min(1).max(80)).max(200).default([]),
  })
  .strict();
export type ParseTaskRequest = z.infer<typeof ParseTaskRequest>;

export const TaskSuggestion = z
  .object({
    action: z.string().max(200).nullable(),
    person: z.string().max(80).nullable(),
    due: z.iso.date().nullable(),
    size: TaskSize,
    estimate_min: z.number().int().min(1).max(1440).nullable(),
    energy: Energy.nullable(),
    blocking: z.boolean(),
    two_minute: z.boolean(),
    steps: z.array(z.string().min(1).max(200)).max(5),
  })
  .strict();
export type TaskSuggestion = z.infer<typeof TaskSuggestion>;

export const TASK_SUGGESTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "person", "due", "size", "estimate_min", "energy", "blocking", "two_minute", "steps"],
  properties: {
    action: { type: ["string", "null"], description: "Siguiente acción física, en infinitivo" },
    person: { type: ["string", "null"], description: "Nombre de una persona conocida o mencionada" },
    due: { type: ["string", "null"], description: "AAAA-MM-DD o null" },
    size: { type: "string", enum: ["XS", "S", "M", "L"] },
    estimate_min: { type: ["integer", "null"] },
    energy: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
    blocking: { type: "boolean" },
    two_minute: { type: "boolean" },
    steps: { type: "array", items: { type: "string" } },
  },
} as const;

// ------------------------------------------------------------------------------------------------
// POST /v1/ask (spec 004)
// ------------------------------------------------------------------------------------------------
export const AskTurn = z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(8000) }).strict();
export type AskTurn = z.infer<typeof AskTurn>;

export const AskRequest = z
  .object({
    question: z.string().trim().min(1).max(2000),
    history: z.array(AskTurn).max(12).default([]),
    today: z.iso.date(),
    timeZone: z.string().min(1).max(64),
  })
  .strict();
export type AskRequest = z.infer<typeof AskRequest>;

export const ProposedTask = z
  .object({
    text: z.string().min(1).max(500),
    due: z.iso.date().nullable().default(null),
    size: TaskSize.default("S"),
    status: z.enum(["inbox", "now", "next", "waiting"]).default("inbox"),
    existing_task_id: z.uuid().nullable().default(null),
    reason: z.string().max(300).default(""),
  })
  .strict();
export type ProposedTask = z.infer<typeof ProposedTask>;

export const Citation = z.object({ kind: z.enum(["note", "task", "contact"]), id: z.uuid(), title: z.string() });
export type Citation = z.infer<typeof Citation>;

export const AskResponse = z.object({
  answer: z.string(),
  citations: z.array(Citation),
  proposals: z.array(ProposedTask),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number() }).nullable(),
});
export type AskResponse = z.infer<typeof AskResponse>;

/** Enlaces internos que el asistente usa para citar: tracky://note/<id> */
export const CITATION_LINK = /tracky:\/\/(note|task|contact)\/([0-9a-f-]{36})/g;
