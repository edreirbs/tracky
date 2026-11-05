/** Frame binario del puente: [seq u32 | canal u8 | eco u8 | 2 reservados | startMs u64] + PCM16 LE. */
export const HEADER_BYTES = 16;

export function encodeFrame(seq: number, channel: 0 | 1, startMs: number, pcm: Int16Array, echo = 0): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_BYTES + pcm.byteLength);
  const view = new DataView(buf);
  view.setUint32(0, seq, true);
  view.setUint8(4, channel);
  view.setUint8(5, Math.round(Math.max(0, Math.min(1, echo)) * 255)); // eco 0–1 (ADR-0011)
  view.setBigUint64(8, BigInt(Math.max(0, Math.round(startMs))), true);
  const out = new Int16Array(buf, HEADER_BYTES);
  out.set(pcm);
  if (!littleEndian()) {
    for (let i = 0; i < out.length; i++) view.setInt16(HEADER_BYTES + i * 2, pcm[i]!, true);
  }
  return buf;
}

function littleEndian(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}

export type BridgeMessage =
  | { type: "ready" }
  | { type: "segment"; seq: number; channel: 0 | 1; startMs: number; endMs: number; text: string; speaker?: number }
  | { type: "chunk_done"; seq: number; duplicate?: boolean }
  | { type: "lag"; queuedSec: number }
  | { type: "drained" }
  | { type: "error"; code: string; seq?: number; retryable: boolean; detail?: string };

export interface BridgeHealth {
  status: "ok";
  bridgeVersion: string;
  engine: string;
  model: string;
  device: string;
  language: string;
  paired: boolean;
  /** El puente puede capturar el audio del sistema de forma nativa (macOS, ADR-0009). */
  systemAudio?: boolean;
  /** El puente distingue voces ("Participante N", ADR-0010). */
  speakers?: boolean;
  /** Hay huella de voz de "Yo" registrada en el puente (ADR-0011). */
  voiceprint?: boolean;
}

/** PCM16 LE (bloques de 100 ms del puente) → float32 [-1, 1). */
export function pcm16ToFloat(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  const out = new Float32Array(buf.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
