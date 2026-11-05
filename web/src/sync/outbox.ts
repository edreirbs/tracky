import type { NoteEvent } from "@tracky/shared";
import { ApiError, createNote } from "../api/client.js";
import {
  buildCreateRequest,
  getMeeting,
  getPendingAudio,
  pendingOutbox,
  purgeMeetingContent,
  putOutbox,
  updateMeeting,
} from "../storage/db.js";

const MAX_ATTEMPTS = 10;

export function nextDelayMs(attempts: number): number {
  // 1 s, 2 s, 4 s… hasta 5 min, con jitter.
  return Math.min(300_000, 1000 * 2 ** attempts) * (0.5 + Math.random() / 2);
}

export async function enqueueCreate(meetingId: string): Promise<void> {
  await putOutbox({ id: `create:${meetingId}`, meetingId, op: "create_note", attempts: 0, nextAttemptAt: Date.now(), status: "pending" });
  await updateMeeting(meetingId, { state: "queued" });
}

let running = false;

/**
 * Procesa la cola: envía cada junta al Worker, con reintentos e idempotencia (meetingId).
 * Solo envía juntas sin audio pendiente de transcribir.
 */
export async function processOutbox(onEvent: (meetingId: string, e: NoteEvent) => void = () => {}): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const item of await pendingOutbox()) {
      if (item.nextAttemptAt > Date.now()) continue;
      const meeting = await getMeeting(item.meetingId);
      if (!meeting) {
        await putOutbox({ ...item, status: "done" });
        continue;
      }
      if ((await getPendingAudio(item.meetingId)).length > 0) continue; // falta transcribir

      await putOutbox({ ...item, status: "in_flight" });
      await updateMeeting(meeting.id, { state: "processing" });
      try {
        const req = await buildCreateRequest(meeting);
        const { result, partial } = await createNote(req, (e) => onEvent(meeting.id, e));
        await updateMeeting(meeting.id, { state: partial ? "partially_saved" : "saved", result });
        await putOutbox({ ...item, status: "done" });
        if (!partial) await purgeMeetingContent(meeting.id);
      } catch (err) {
        const e = err instanceof ApiError ? err : new ApiError(0, "network_error", true, "Sin conexión");
        const attempts = item.attempts + 1;
        const dead = !e.retryable || attempts >= MAX_ATTEMPTS;
        await putOutbox({ ...item, attempts, status: dead ? "dead" : "pending", nextAttemptAt: Date.now() + nextDelayMs(attempts) });
        await updateMeeting(meeting.id, {
          state: dead ? "failed" : "queued",
          error: { type: e.type, detail: e.message, retryable: !dead },
        });
      }
    }
  } finally {
    running = false;
  }
}

export async function retryMeeting(meetingId: string): Promise<void> {
  await enqueueCreate(meetingId);
  await processOutbox();
}

/** Reintentos periódicos y al recuperar la conexión. */
export function startOutboxLoop(onChange: () => void): () => void {
  const tick = () => void processOutbox().then(onChange);
  const id = setInterval(tick, 15_000);
  window.addEventListener("online", tick);
  tick();
  return () => {
    clearInterval(id);
    window.removeEventListener("online", tick);
  };
}
