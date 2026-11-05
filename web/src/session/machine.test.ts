import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { meetingToMarkdown } from "../export/markdown.js";
import {
  addSegment,
  buildCreateRequest,
  getPendingAudio,
  getSegments,
  putPendingAudio,
  purgeMeetingContent,
  saveMeeting,
  type MeetingRecord,
} from "../storage/db.js";
import { canTransition, needsRecovery } from "./machine.js";

describe("máquina de estados", () => {
  it("permite el flujo feliz y bloquea saltos", () => {
    expect(canTransition("recording", "finalizing")).toBe(true);
    expect(canTransition("processing", "saved")).toBe(true);
    expect(canTransition("recording", "saved")).toBe(false);
    expect(canTransition("saved", "processing")).toBe(true); // regenerar
  });
  it("marca qué juntas recuperar", () => {
    expect(needsRecovery("recording")).toBe(true);
    expect(needsRecovery("saved")).toBe(false);
  });
});

const meeting: MeetingRecord = {
  id: "0193a5b2-7c1d-7e00-8000-000000000009",
  startedAt: "2026-11-04T16:00:00.000-06:00",
  durationSec: 125,
  mode: "online",
  platformHint: "teams",
  templateId: "acta-junta",
  markedImportant: true,
  manualNotes: [{ atMs: 60_000, text: "Revisar presupuesto" }],
  state: "queued",
};

describe("almacenamiento local", () => {
  it("arma la solicitud con la transcripción y la purga al confirmar", async () => {
    await saveMeeting(meeting);
    await addSegment({ meetingId: meeting.id, seq: 0, startMs: 0, endMs: 1000, channel: 0, text: "Hola" });
    await addSegment({ meetingId: meeting.id, seq: 1, startMs: 1500, endMs: 3000, channel: 1, text: "Buenas" });
    await putPendingAudio({ meetingId: meeting.id, seq: 3, channel: 0, startMs: 0, pcm: new ArrayBuffer(4) });

    const req = await buildCreateRequest(meeting);
    expect(req.transcript).toHaveLength(2);
    expect(req.markedImportant).toBe(true);
    expect(req).not.toHaveProperty("state");

    const md = meetingToMarkdown(meeting, await getSegments(meeting.id));
    expect(md).toContain("**[00:01] Otros:** Buenas");
    expect(md).toContain("Revisar presupuesto");

    await purgeMeetingContent(meeting.id);
    expect(await getSegments(meeting.id)).toHaveLength(0);
    expect(await getPendingAudio(meeting.id)).toHaveLength(0);
  });
});
