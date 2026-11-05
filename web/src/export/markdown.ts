import { formatTimestamp, toTurns } from "@tracky/shared";
import type { MeetingRecord, SegmentRecord } from "../storage/db.js";

/** Exporta la junta a Markdown (respaldo si Supabase no está disponible). */
export function meetingToMarkdown(m: MeetingRecord, segments: SegmentRecord[]): string {
  const turns = toTurns(segments, m.mode);
  const lines = [
    `# ${m.result?.title ?? `Reunión ${new Date(m.startedAt).toLocaleString("es-MX")}`}`,
    "",
    `- Fecha: ${new Date(m.startedAt).toLocaleString("es-MX")}`,
    `- Duración: ${formatTimestamp((m.durationSec ?? 0) * 1000)}`,
    `- Modalidad: ${m.mode === "online" ? "en línea" : "en persona"}`,
    ...(m.result ? [`- Etiqueta: ${m.result.tag}`] : []),
    "",
  ];
  if (m.manualNotes.length) {
    lines.push("## Notas manuales", "", ...m.manualNotes.map((n) => `- [${formatTimestamp(n.atMs)}] ${n.text}`), "");
  }
  lines.push("## Transcripción", "", ...turns.map((t) => `**[${formatTimestamp(t.startMs)}] ${t.speaker}:** ${t.text}`), "");
  return lines.join("\n");
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
