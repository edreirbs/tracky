import type { CreateNoteInput, ManualNote, MeetingMode, NoteResult, TranscriptSegment } from "@tracky/shared";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

export type MeetingState =
  | "recording"
  | "finalizing"
  | "queued"
  | "processing"
  | "saved"
  | "partially_saved"
  | "failed";

export interface MeetingRecord {
  id: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  mode: MeetingMode;
  platformHint: "teams" | "zoom" | "meet" | "other" | null;
  templateId: string;
  extraInstructions?: string;
  markedImportant: boolean;
  manualNotes: ManualNote[];
  transcription?: { engine: string; model: string };
  state: MeetingState;
  result?: NoteResult;
  error?: { type: string; detail?: string; retryable: boolean };
}

export interface SegmentRecord extends TranscriptSegment {
  meetingId: string;
  seq: number;
}

export interface OutboxItem {
  id: string;
  meetingId: string;
  op: "create_note";
  attempts: number;
  nextAttemptAt: number;
  status: "pending" | "in_flight" | "done" | "dead";
}

export interface PendingAudio {
  meetingId: string;
  seq: number;
  channel: 0 | 1;
  startMs: number;
  pcm: ArrayBuffer; // Int16 LE
  echo?: number; // 0–1, solo canal 0 en juntas en línea
}

interface Schema extends DBSchema {
  meetings: { key: string; value: MeetingRecord; indexes: { byState: string; byStart: string } };
  segments: { key: [string, number]; value: SegmentRecord; indexes: { byMeeting: string } };
  outbox: { key: string; value: OutboxItem; indexes: { byStatus: string } };
  pending_audio: { key: [string, number]; value: PendingAudio; indexes: { byMeeting: string } };
  settings: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>("tracky", 1, {
    upgrade(d) {
      const meetings = d.createObjectStore("meetings", { keyPath: "id" });
      meetings.createIndex("byState", "state");
      meetings.createIndex("byStart", "startedAt");
      d.createObjectStore("segments", { keyPath: ["meetingId", "seq"] }).createIndex("byMeeting", "meetingId");
      d.createObjectStore("outbox", { keyPath: "id" }).createIndex("byStatus", "status");
      d.createObjectStore("pending_audio", { keyPath: ["meetingId", "seq"] }).createIndex("byMeeting", "meetingId");
      d.createObjectStore("settings");
    },
  });
  return dbPromise;
}

export async function saveMeeting(m: MeetingRecord): Promise<void> {
  await (await db()).put("meetings", m);
}

export async function getMeeting(id: string): Promise<MeetingRecord | undefined> {
  return (await db()).get("meetings", id);
}

export async function updateMeeting(id: string, patch: Partial<MeetingRecord>): Promise<MeetingRecord | undefined> {
  const d = await db();
  const m = await d.get("meetings", id);
  if (!m) return undefined;
  const next = { ...m, ...patch };
  await d.put("meetings", next);
  return next;
}

export async function listMeetings(limit = 50): Promise<MeetingRecord[]> {
  const all = await (await db()).getAllFromIndex("meetings", "byStart");
  return all.reverse().slice(0, limit);
}

export async function addSegment(s: SegmentRecord): Promise<void> {
  await (await db()).put("segments", s);
}

export async function getSegments(meetingId: string): Promise<SegmentRecord[]> {
  return (await db()).getAllFromIndex("segments", "byMeeting", meetingId);
}

export async function putPendingAudio(p: PendingAudio): Promise<void> {
  await (await db()).put("pending_audio", p);
}

export async function deletePendingAudio(meetingId: string, seq: number): Promise<void> {
  await (await db()).delete("pending_audio", [meetingId, seq]);
}

export async function getPendingAudio(meetingId: string): Promise<PendingAudio[]> {
  return (await db()).getAllFromIndex("pending_audio", "byMeeting", meetingId);
}

/** Privacidad: al confirmar que la nota está en Supabase se borran transcripción y audio pendiente locales. */
export async function purgeMeetingContent(meetingId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["segments", "pending_audio"], "readwrite");
  for (const store of ["segments", "pending_audio"] as const) {
    let cursor = await tx.objectStore(store).index("byMeeting").openCursor(meetingId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await tx.done;
}

export async function deleteEverything(): Promise<void> {
  const d = await db();
  await Promise.all((["meetings", "segments", "outbox", "pending_audio"] as const).map((s) => d.clear(s)));
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get("settings", key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put("settings", value, key);
}

export async function putOutbox(item: OutboxItem): Promise<void> {
  await (await db()).put("outbox", item);
}

export async function pendingOutbox(): Promise<OutboxItem[]> {
  return (await db()).getAllFromIndex("outbox", "byStatus", "pending");
}

export async function buildCreateRequest(m: MeetingRecord): Promise<CreateNoteInput> {
  const segments = await getSegments(m.id);
  return {
    meetingId: m.id,
    startedAt: m.startedAt,
    durationSec: m.durationSec ?? 0,
    mode: m.mode,
    platformHint: m.platformHint,
    templateId: m.templateId as CreateNoteInput["templateId"],
    ...(m.extraInstructions ? { extraInstructions: m.extraInstructions } : {}),
    markedImportant: m.markedImportant,
    manualNotes: m.manualNotes,
    ...(m.transcription ? { transcription: m.transcription } : {}),
    transcript: segments.map(({ startMs, endMs, channel, text, speaker }) => ({
      startMs,
      endMs,
      channel,
      text,
      ...(speaker ? { speaker } : {}),
    })),
  };
}
