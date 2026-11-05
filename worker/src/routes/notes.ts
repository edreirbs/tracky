// Notas de reunión (spec 001): resumir con Claude y guardar en Supabase en segundo plano.
import type Anthropic from "@anthropic-ai/sdk";
import {
  applySpeakerFixes,
  applySpeakerNames,
  CreateNoteRequest,
  type Estado,
  type NoteEvent,
  type NoteResult,
  PatchNoteRequest,
  type TemplateId,
  toTurns,
  turnsToPlainText,
} from "@tracky/shared";
import { Hono } from "hono";
import { fallbackTag, normalizeTag, summarize, type SummarizeResult } from "../claude/summarize.js";
import { type AppEnv, effortOf, type Env } from "../env.js";
import { TEMPLATES } from "../generated/prompts.js";
import { HttpError, logEvent, problem } from "../lib/http.js";
import { eq, type SupabaseRest } from "../supabase/client.js";

export interface Deps {
  /** Cliente con service_role: solo para el trabajo en segundo plano (siempre filtra por user_id). */
  service: SupabaseRest;
  /** Cliente con el JWT del usuario (RLS). */
  asUser: (token: string) => SupabaseRest;
  anthropic: Anthropic;
  /** Lanza el procesamiento de una junta (en producción: función de Netlify en segundo plano). */
  enqueue: (meetingId: string) => Promise<void>;
}
export type DepsFactory = (env: Env) => Deps;

type JobStatus = "queued" | "running" | "done" | "partial" | "error";

/** Trabajo pendiente. La transcripción vive aquí solo hasta guardarse; después se borra. */
interface Job {
  meetingId: string;
  userId: string;
  kind: "create" | "regenerate";
  request?: CreateNoteRequest | { templateId: TemplateId; extraInstructions?: string | undefined };
  status: JobStatus;
  last?: NoteEvent;
  updatedAt: number;
}

interface TagRow {
  id: string;
  name: string;
  description: string;
  signals: string[];
  is_fallback: boolean;
}

interface NoteRow {
  id: string;
  title: string;
  tag_id: string | null;
  estado: Estado;
  status: "saved" | "summary_failed";
  template: string | null;
  model: string | null;
  usage: NoteResult["usage"];
  tag_confidence: number | null;
  tag_alternatives: string[];
  action_items: NoteResult["actionItems"];
  started_at: string | null;
  duration_s: number | null;
  mode: "online" | "in_person" | null;
  transcript_text: string | null;
}

const JOB_TTL_S = 24 * 3600;
const STALE_JOB_MS = 16 * 60_000; // más que el límite de 15 min de una función en segundo plano
const jobKey = (userId: string, id: string) => `job:${userId}:${id}`;
const NOTE_COLUMNS =
  "id,title,tag_id,estado,status,template,model,usage,tag_confidence,tag_alternatives,action_items,started_at,duration_s,mode,transcript_text";

async function userTags(db: SupabaseRest, userId: string): Promise<TagRow[]> {
  return db.select<TagRow>("tags", `select=id,name,description,signals,is_fallback&user_id=${eq(userId)}&order=sort.asc,name.asc`);
}

async function ownerName(db: SupabaseRest, userId: string): Promise<string | null> {
  const rows = await db.select<{ display_name: string | null }>("profiles", `select=display_name&user_id=${eq(userId)}`);
  return rows[0]?.display_name ?? null;
}

async function findNote(db: SupabaseRest, userId: string, meetingId: string): Promise<NoteRow | null> {
  const rows = await db.select<NoteRow>("notes", `select=${NOTE_COLUMNS}&user_id=${eq(userId)}&meeting_id=${eq(meetingId)}`);
  return rows[0] ?? null;
}

function toResult(n: NoteRow, tags: readonly TagRow[]): NoteResult {
  return {
    noteId: n.id,
    title: n.title,
    tag: tags.find((t) => t.id === n.tag_id)?.name ?? "",
    tagConfidence: n.tag_confidence ?? 0,
    tagAlternatives: n.tag_alternatives ?? [],
    estado: n.estado,
    templateId: (n.template ?? "general") as TemplateId,
    model: n.model,
    usage: n.usage,
    summaryPending: n.status === "summary_failed",
    actionItems: n.action_items ?? [],
  };
}

function fallbackTitle(startedAt: string): string {
  const d = new Date(startedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });
  return `Reunión – ${d}`;
}

function nextStepsFrom(output: SummarizeResult["output"]): string {
  if (output.next_steps_short.trim()) return output.next_steps_short.trim();
  return output.action_items.map((a) => `• ${a.owner ? `${a.owner} — ` : ""}${a.task}${a.due ? ` (${a.due})` : ""}`).join("\n");
}

function jobView(job: Job) {
  return { meetingId: job.meetingId, status: job.status, event: job.last ?? null };
}

async function saveJob(env: Env, job: Job): Promise<void> {
  job.updatedAt = Date.now();
  await env.STATE.put(jobKey(job.userId, job.meetingId), JSON.stringify(job), { expirationTtl: JOB_TTL_S });
}

// --- Trabajo en segundo plano ---------------------------------------------------------------------

async function createFlow(env: Env, deps: Deps, userId: string, req: CreateNoteRequest, emit: (e: NoteEvent) => Promise<void>) {
  const { service, anthropic } = deps;
  const started = Date.now();
  const tags = await userTags(service, userId);
  const existing = await findNote(service, userId, req.meetingId);
  if (existing && existing.status === "saved") {
    await emit({ event: "done", result: toResult(existing, tags) });
    return;
  }

  const turns = toTurns(req.transcript, req.mode);
  await emit({ event: "summarizing" });
  let summary: SummarizeResult | null = null;
  let summaryError: HttpError | null = null;
  if (tags.length === 0) {
    summaryError = new HttpError(409, "no_tags", "Configura tus etiquetas antes de resumir");
  } else {
    try {
      summary = await summarize(anthropic, env.CLAUDE_MODEL, effortOf(env), {
        transcriptText: turnsToPlainText(turns, true),
        templateId: req.templateId,
        extraInstructions: req.extraInstructions,
        manualNotes: req.manualNotes,
        markedImportant: req.markedImportant,
        startedAt: req.startedAt,
        durationSec: req.durationSec,
        mode: req.mode,
        platformHint: req.platformHint,
        tags,
        ownerName: await ownerName(service, userId),
      });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      summaryError = err; // degradación (constitución IV.4): se guarda con la transcripción
    }
  }

  const tag = summary ? normalizeTag(summary.output, tags) : { tag: fallbackTag(tags), confidence: 0, alternatives: [] };
  const estado: Estado = req.markedImportant ? "Importante" : (summary?.output.estado ?? "Normal");
  const finalTurns = summary
    ? applySpeakerNames(applySpeakerFixes(turns, summary.output.speaker_fixes), summary.output.speaker_names)
    : turns;

  await emit({ event: "saving" });
  const row = {
    user_id: userId,
    kind: "meeting",
    meeting_id: req.meetingId,
    title: (summary?.output.title.trim() || fallbackTitle(req.startedAt)).slice(0, 200),
    tag_id: tags.find((t) => t.name === tag.tag)?.id ?? null,
    estado,
    status: summary ? "saved" : "summary_failed",
    summary_md: summary?.output.summary_markdown ?? null,
    key_points: summary?.output.key_points ?? [],
    decisions: summary?.output.decisions ?? [],
    action_items: summary?.output.action_items ?? [],
    next_steps: summary ? nextStepsFrom(summary.output) : null,
    transcript: { turns: finalTurns, manualNotes: req.manualNotes, transcription: req.transcription ?? null },
    transcript_text: turnsToPlainText(finalTurns, false),
    started_at: req.startedAt,
    duration_s: req.durationSec,
    mode: req.mode,
    template: req.templateId,
    model: summary?.model ?? null,
    usage: summary?.usage ?? null,
    tag_confidence: tag.confidence,
    tag_alternatives: tag.alternatives,
  };
  const [saved] = await service.insert<NoteRow>("notes", row, { onConflict: "user_id,meeting_id" });
  if (!saved) throw new HttpError(502, "upstream_supabase_error", "Supabase no devolvió la nota", true);

  logEvent({
    evt: "note_saved",
    segments: req.transcript.length,
    durationSec: req.durationSec,
    summary: summary !== null,
    inputTokens: summary?.usage.inputTokens,
    cacheReadTokens: summary?.usage.cacheReadTokens,
    outputTokens: summary?.usage.outputTokens,
    ms: Date.now() - started,
  });

  const result = toResult(saved, tags);
  if (summaryError) await emit({ event: "partial", result, error: { type: summaryError.type, detail: summaryError.title } });
  else await emit({ event: "done", result });
}

async function regenerateFlow(
  env: Env,
  deps: Deps,
  userId: string,
  meetingId: string,
  body: { templateId: TemplateId; extraInstructions?: string | undefined },
  emit: (e: NoteEvent) => Promise<void>,
) {
  const { service, anthropic } = deps;
  const note = await findNote(service, userId, meetingId);
  if (!note) throw new HttpError(404, "not_found", "No hay nota para esta junta");
  const tags = await userTags(service, userId);
  if (tags.length === 0) throw new HttpError(409, "no_tags", "Configura tus etiquetas antes de resumir");
  await emit({ event: "summarizing" });
  const summary = await summarize(anthropic, env.CLAUDE_MODEL, effortOf(env), {
    transcriptText: note.transcript_text ?? "",
    templateId: body.templateId,
    extraInstructions: body.extraInstructions,
    manualNotes: [],
    markedImportant: note.estado === "Importante",
    startedAt: note.started_at ?? new Date().toISOString(),
    durationSec: note.duration_s ?? 0,
    mode: note.mode ?? "online",
    platformHint: null,
    tags,
    ownerName: await ownerName(service, userId),
  });
  await emit({ event: "saving" });
  const tag = normalizeTag(summary.output, tags);
  const patch = {
    summary_md: summary.output.summary_markdown,
    key_points: summary.output.key_points,
    decisions: summary.output.decisions,
    action_items: summary.output.action_items,
    next_steps: nextStepsFrom(summary.output),
    template: body.templateId,
    model: summary.model,
    usage: summary.usage,
    status: "saved",
    // Si la nota no tenía resumen, también se clasifica ahora.
    ...(note.status === "summary_failed"
      ? { title: summary.output.title.trim().slice(0, 200) || note.title, tag_id: tags.find((t) => t.name === tag.tag)?.id ?? null, tag_confidence: tag.confidence, tag_alternatives: tag.alternatives }
      : {}),
  };
  const [saved] = await service.update<NoteRow>("notes", `id=${eq(note.id)}&user_id=${eq(userId)}`, patch);
  if (!saved) throw new HttpError(502, "upstream_supabase_error", "Supabase no devolvió la nota", true);
  await emit({ event: "done", result: toResult(saved, tags) });
}

/** Ejecuta un trabajo encolado. Nunca lanza: los errores quedan registrados en el trabajo. */
export async function runJob(env: Env, deps: Deps, userId: string, meetingId: string): Promise<void> {
  const job = await env.STATE.get<Job>(jobKey(userId, meetingId), "json");
  if (!job || !job.request || (job.status !== "queued" && job.status !== "running")) return;
  const request = job.request;
  job.status = "running";
  await saveJob(env, job);

  const emit = async (e: NoteEvent) => {
    job.last = e;
    job.status = e.event === "done" ? "done" : e.event === "partial" ? "partial" : e.event === "error" ? "error" : "running";
    if (job.status !== "running") delete job.request; // privacidad: la transcripción no se queda en Blobs
    await saveJob(env, job);
  };

  try {
    if (job.kind === "create") await createFlow(env, deps, userId, request as CreateNoteRequest, emit);
    else await regenerateFlow(env, deps, userId, meetingId, request as { templateId: TemplateId }, emit);
  } catch (err) {
    const e = err instanceof HttpError ? err : new HttpError(500, "internal_error", "Error interno", true);
    if (!(err instanceof HttpError)) console.error("job_error", err instanceof Error ? err.name : "unknown");
    await emit({ event: "error", error: { type: e.type, detail: e.title, retryable: e.retryable } });
  }
}

// --- Rutas ------------------------------------------------------------------------------------------

export function notesRoutes(depsFactory: DepsFactory) {
  const r = new Hono<AppEnv>();

  r.post("/notes", async (c) => {
    const parsed = CreateNoteRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return problem(new HttpError(400, "validation_error", "Solicitud inválida", false, parsed.error.issues[0]?.message));
    }
    const req = parsed.data;
    if (c.req.header("idempotency-key") !== req.meetingId) {
      return problem(new HttpError(400, "validation_error", "Idempotency-Key debe ser igual a meetingId"));
    }
    if (!req.transcript.some((s) => s.text.trim()) && req.manualNotes.length === 0) {
      return problem(new HttpError(422, "empty_transcript", "La junta no tiene transcripción ni notas; no se crea la nota"));
    }
    const env = c.env;
    const userId = c.get("userId");
    const deps = depsFactory(env);
    const existing = await findNote(deps.asUser(c.get("userToken")), userId, req.meetingId);
    if (existing?.status === "saved") {
      const tags = await userTags(deps.asUser(c.get("userToken")), userId);
      return c.json({ meetingId: req.meetingId, status: "done", event: { event: "done", result: toResult(existing, tags) } });
    }

    const current = await env.STATE.get<Job>(jobKey(userId, req.meetingId), "json");
    if (current && (current.status === "queued" || current.status === "running") && Date.now() - current.updatedAt < STALE_JOB_MS) {
      return c.json(jobView(current), 202);
    }
    const job: Job = { meetingId: req.meetingId, userId, kind: "create", request: req, status: "queued", updatedAt: Date.now() };
    await saveJob(env, job);
    await deps.enqueue(`${userId}:${req.meetingId}`);
    const after = (await env.STATE.get<Job>(jobKey(userId, req.meetingId), "json")) ?? job;
    return c.json(jobView(after), 202);
  });

  r.get("/notes/:meetingId", async (c) => {
    const meetingId = c.req.param("meetingId");
    const userId = c.get("userId");
    const job = await c.env.STATE.get<Job>(jobKey(userId, meetingId), "json");
    if (job) return c.json(jobView(job));
    const db = depsFactory(c.env).asUser(c.get("userToken"));
    const note = await findNote(db, userId, meetingId);
    if (note) return c.json({ meetingId, status: "done", event: { event: "done", result: toResult(note, await userTags(db, userId)) } });
    return problem(new HttpError(404, "not_found", "No hay trabajo ni nota para esta junta"));
  });

  r.patch("/notes/:meetingId", async (c) => {
    const meetingId = c.req.param("meetingId");
    const userId = c.get("userId");
    const parsed = PatchNoteRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(new HttpError(400, "validation_error", "Solicitud inválida"));
    if (!TEMPLATES[parsed.data.templateId]) return problem(new HttpError(400, "validation_error", "Plantilla desconocida"));
    const deps = depsFactory(c.env);
    const note = await findNote(deps.asUser(c.get("userToken")), userId, meetingId);
    if (!note) return problem(new HttpError(404, "not_found", "No hay nota para esta junta"));

    const job: Job = { meetingId, userId, kind: "regenerate", request: parsed.data, status: "queued", updatedAt: Date.now() };
    await saveJob(c.env, job);
    await deps.enqueue(`${userId}:${meetingId}`);
    const after = (await c.env.STATE.get<Job>(jobKey(userId, meetingId), "json")) ?? job;
    return c.json(jobView(after), 202);
  });

  return r;
}
