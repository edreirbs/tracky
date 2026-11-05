import {
  type AskRequest,
  AskResponse,
  type CreateNoteInput,
  type NoteEvent,
  NoteEvent as NoteEventSchema,
  type NoteResult,
  type ParseTaskRequest,
  type PatchNoteRequest,
  Problem,
  TaskSuggestion,
} from "@tracky/shared";
import { WORKER_URL } from "../config.js";
import { accessToken, freshAccessToken } from "../supabase.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

async function authFetch(path: string, init: RequestInit = {}, fresh = false): Promise<Response> {
  // Los resúmenes corren en segundo plano con el token de la persona: se envía uno con margen.
  const token = fresh ? await freshAccessToken() : await accessToken();
  if (!token) throw new ApiError(401, "unauthorized", false, "Inicia sesión");
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(0, "network_error", true, "Sin conexión");
  }
  if (!res.ok) {
    const p = Problem.safeParse(await res.json().catch(() => null));
    throw new ApiError(
      res.status,
      p.success ? p.data.type : "http_error",
      p.success ? (p.data.retryable ?? res.status >= 500) : res.status >= 500 || res.status === 429,
      p.success ? p.data.title : `Error ${res.status}`,
    );
  }
  return res;
}

interface JobView {
  status: "queued" | "running" | "done" | "partial" | "error";
  event: NoteEvent | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function finalResult(last: NoteEvent | null): { result: NoteResult; partial: boolean } {
  if (!last) throw new ApiError(0, "network_error", true, "Sin respuesta del servidor");
  if (last.event === "done") return { result: last.result, partial: false };
  if (last.event === "partial") return { result: last.result, partial: true };
  if (last.event === "error") throw new ApiError(0, last.error.type, last.error.retryable, last.error.detail ?? "Error");
  throw new ApiError(0, "network_error", true, "El proceso terminó antes de tiempo");
}

/** Espera entre consultas del estado: 1.5 s al inicio y hasta 5 s (cada consulta gasta créditos de Netlify). */
export function pollDelayMs(attempt: number): number {
  return Math.min(5000, 1500 + attempt * 500);
}

async function waitForJob(meetingId: string, first: JobView, onEvent: (e: NoteEvent) => void) {
  let view = first;
  const deadline = Date.now() + 16 * 60_000;
  for (let attempt = 0; ; attempt++) {
    const parsed = view.event ? NoteEventSchema.safeParse(view.event) : null;
    const event = parsed?.success ? parsed.data : null;
    if (event) onEvent(event);
    if (view.status === "done" || view.status === "partial" || view.status === "error") return finalResult(event);
    if (Date.now() > deadline) throw new ApiError(0, "timeout", true, "El resumen tardó demasiado; se reintentará");
    await sleep(pollDelayMs(attempt));
    view = (await (await authFetch(`/v1/notes/${meetingId}`)).json()) as JobView;
  }
}

export async function createNote(req: CreateNoteInput, onEvent: (e: NoteEvent) => void = () => {}) {
  const res = await authFetch("/v1/notes", { method: "POST", headers: { "idempotency-key": req.meetingId }, body: JSON.stringify(req) }, true);
  return waitForJob(req.meetingId, (await res.json()) as JobView, onEvent);
}

export async function regenerateNote(meetingId: string, body: PatchNoteRequest, onEvent: (e: NoteEvent) => void = () => {}) {
  const res = await authFetch(`/v1/notes/${meetingId}`, { method: "PATCH", body: JSON.stringify(body) }, true);
  return waitForJob(meetingId, (await res.json()) as JobView, onEvent);
}

export async function parseTask(req: ParseTaskRequest, signal?: AbortSignal): Promise<TaskSuggestion> {
  const res = await authFetch("/v1/tasks/parse", { method: "POST", body: JSON.stringify(req), ...(signal ? { signal } : {}) });
  return TaskSuggestion.parse(((await res.json()) as { suggestion: unknown }).suggestion);
}

export async function askTracky(req: AskRequest): Promise<AskResponse> {
  const res = await authFetch("/v1/ask", { method: "POST", body: JSON.stringify(req) });
  return AskResponse.parse(await res.json());
}

export async function health(check = false): Promise<{ claude: string; configured: Record<string, boolean> } | null> {
  try {
    const res = await fetch(`${WORKER_URL}/health${check ? "?check=claude" : ""}`);
    return res.ok ? ((await res.json()) as { claude: string; configured: Record<string, boolean> }) : null;
  } catch {
    return null;
  }
}
