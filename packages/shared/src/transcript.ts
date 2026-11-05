import type { TranscriptSegment } from "./schemas.js";

export interface Turn {
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
}

export function speakerLabel(seg: Pick<TranscriptSegment, "channel" | "speaker">, mode: "online" | "in_person"): string {
  if (seg.speaker) return seg.speaker;
  if (mode === "in_person") return "Participantes";
  return seg.channel === 0 ? "Yo" : "Otros";
}

/** mm:ss o h:mm:ss */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const tok = (w: string) => normalize(w).replace(/\s/g, "");

/** Colapsa n-gramas repetidos ≥3 veces seguidas ("a long a long a long" → "a long"). */
export function collapseRepeats(text: string, minRepeats = 3, maxN = 8): string {
  let t = text;
  if (/(\w{1,6},){4,}/.test(t)) t = t.replace(/(?<=\w),(?=\w)/g, ", ");
  const words = t.split(/\s+/).filter(Boolean);
  const norm = words.map(tok);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let collapsed = false;
    for (let n = 1; n <= maxN && i + n * minRepeats <= words.length; n++) {
      const pat = norm.slice(i, i + n);
      if (!pat.some(Boolean)) continue;
      let k = 1;
      while (norm.slice(i + k * n, i + (k + 1) * n).join(" ") === pat.join(" ")) k++;
      if (k >= minRepeats) {
        out.push(...words.slice(i, i + n));
        i += k * n;
        collapsed = true;
        break;
      }
    }
    if (!collapsed) out.push(words[i++]!);
  }
  return out.join(" ");
}

const PROMPT_ECHO = /reuni[oó]n de trabajo(?: en espa[nñ]ol)?(?: de (?:la universidad de )?m[eé]xico)?[^.]*\.?|t[eé]rminos:/gi;
const LONE_HALLUCINATIONS = new Set(["you", "thank you", "thanks", "bye", "so", "okay", "oh", "uh", "um", "hmm"]);

/** Limpieza de alucinaciones de Whisper (red de seguridad del servidor; el puente hace lo mismo). */
export function cleanSegmentText(text: string): string {
  const cleaned = collapseRepeats(text.trim()).replace(PROMPT_ECHO, " ").replace(/\s{2,}/g, " ").trim().replace(/^[,\s]+|[,\s]+$/g, "");
  return LONE_HALLUCINATIONS.has(normalize(cleaned)) ? "" : cleaned;
}

/**
 * Ordena por tiempo, descarta vacíos, elimina eco (mismo texto casi simultáneo en ambos canales,
 * prefiriendo el canal 1) y agrupa segmentos consecutivos del mismo hablante en turnos.
 */
export function toTurns(segments: readonly TranscriptSegment[], mode: "online" | "in_person", maxGapMs = 4000): Turn[] {
  const sorted = segments
    .map((s) => ({ ...s, text: cleanSegmentText(s.text) }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.startMs - b.startMs || a.channel - b.channel);

  // Quita la misma frase repetida en segmentos cercanos del mismo canal (bucle de Whisper).
  const recent = new Map<number, string[]>();
  const noLoops = sorted.filter((s) => {
    const key = normalize(s.text);
    const bucket = recent.get(s.channel) ?? [];
    if (bucket.includes(key)) return false;
    recent.set(s.channel, [...bucket, key].slice(-3));
    return true;
  });

  const deduped = dedupeEcho(noLoops);
  const turns: Turn[] = [];
  for (const seg of deduped) {
    const speaker = speakerLabel(seg, mode);
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker && seg.startMs - last.endMs <= maxGapMs) {
      last.text = `${last.text} ${seg.text.trim()}`;
      last.endMs = Math.max(last.endMs, seg.endMs);
    } else {
      turns.push({ startMs: seg.startMs, endMs: seg.endMs, speaker, text: seg.text.trim() });
    }
  }
  return turns;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const wa = new Set(normalize(a).split(" ").filter(Boolean));
  const wb = new Set(normalize(b).split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.max(wa.size, wb.size);
}

/** Si el micrófono captó las bocinas, el mismo texto aparece en ambos canales: se queda el canal 1. */
export function dedupeEcho(sorted: readonly TranscriptSegment[], windowMs = 2500, threshold = 0.7): TranscriptSegment[] {
  const drop = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (a.channel !== 0) continue;
    for (let j = 0; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.channel !== 1) continue;
      if (Math.abs(a.startMs - b.startMs) > windowMs) continue;
      if (similarity(a.text, b.text) >= threshold) {
        drop.add(i);
        break;
      }
    }
  }
  return sorted.filter((_, i) => !drop.has(i));
}

export function turnsToPlainText(turns: readonly Turn[], numbered = false): string {
  return turns
    .map((t, i) => `[${numbered ? `#${i + 1} ` : ""}${formatTimestamp(t.startMs)}] ${t.speaker}: ${t.text}`)
    .join("\n");
}

/**
 * Corrige el hablante de turnos que Claude identificó como mal atribuidos (ADR-0011, red de seguridad).
 * Solo acepta números de turno válidos y hablantes que ya aparecen en la transcripción (u "Otros").
 */
export function applySpeakerFixes(
  turns: readonly Turn[],
  fixes: ReadonlyArray<{ turn: number; speaker: string }>,
  max = 60,
): Turn[] {
  const allowed = new Set([...turns.map((t) => t.speaker), "Otros"]);
  const out = turns.map((t) => ({ ...t }));
  for (const { turn, speaker } of fixes.slice(0, max)) {
    const target = out[turn - 1];
    if (target && Number.isInteger(turn) && allowed.has(speaker)) target.speaker = speaker;
  }
  return out;
}

const PARTICIPANT_LABEL = /^Participante \d{1,2}$/;

/** Etiqueta de una voz detectada por el puente ("Participante 3"). */
export function participantLabel(n: number): string {
  return `Participante ${n}`;
}

/**
 * Sustituye "Participante N" por el nombre que infirió Claude (solo etiquetas válidas, nombres cortos
 * de una línea). Las voces sin nombre conservan su etiqueta. Une turnos contiguos que queden con el
 * mismo nombre (la detección a veces divide a una persona en dos voces).
 */
export function applySpeakerNames(
  turns: readonly Turn[],
  names: ReadonlyArray<{ label: string; name: string | null }>,
  maxGapMs = 4000,
): Turn[] {
  const map = new Map<string, string>();
  for (const { label, name } of names) {
    const clean = name?.replace(/\s+/g, " ").trim();
    if (PARTICIPANT_LABEL.test(label) && clean && clean.length <= 60 && !map.has(label)) map.set(label, clean);
  }
  const out: Turn[] = [];
  for (const t of turns) {
    const speaker = map.get(t.speaker) ?? t.speaker;
    const last = out[out.length - 1];
    if (last && last.speaker === speaker && t.startMs - last.endMs <= maxGapMs) {
      last.text = `${last.text} ${t.text}`;
      last.endMs = Math.max(last.endMs, t.endMs);
    } else {
      out.push({ ...t, speaker });
    }
  }
  return out;
}
