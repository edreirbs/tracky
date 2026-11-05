/**
 * Detector de eco (ADR-0011): ¿el fragmento del micrófono es solo lo que sonó en las bocinas?
 *
 * Busca el audio de las bocinas dentro del fragmento del micrófono (GCC-PHAT, desfase de hasta ±1 s) y, si
 * aparece, mide qué tanto la energía del micrófono sigue a la de las bocinas. Si solo hablas tú, o las
 * bocinas están calladas, el puntaje es bajo.
 */
import { SAMPLE_RATE } from "./vad.js";

const FRAME = SAMPLE_RATE / 50; // 20 ms
const MAX_LAG_FRAMES = 50; // ±1 s
const SILENT_RMS = 0.003;

/** Últimos `seconds` del canal "Otros", indexados por posición absoluta en muestras. */
export class SystemRing {
  private buf: Float32Array;
  private written = 0;

  constructor(seconds = 60) {
    this.buf = new Float32Array(seconds * SAMPLE_RATE);
  }

  get position(): number {
    return this.written;
  }

  push(block: Float32Array): void {
    for (let i = 0; i < block.length; i++) this.buf[(this.written + i) % this.buf.length] = block[i]!;
    this.written += block.length;
  }

  /** Copia [start, end) (posiciones absolutas); lo que no esté disponible queda en 0. */
  slice(start: number, end: number): Float32Array {
    const out = new Float32Array(Math.max(0, end - start));
    const oldest = this.written - this.buf.length;
    for (let p = Math.max(start, oldest, 0); p < Math.min(end, this.written); p++) out[p - start] = this.buf[p % this.buf.length]!;
    return out;
  }
}

function envelope(pcm: Float32Array): { env: number[]; rms: number[] } {
  const env: number[] = [];
  const rms: number[] = [];
  for (let i = 0; i + FRAME <= pcm.length; i += FRAME) {
    let s = 0;
    for (let k = i; k < i + FRAME; k++) s += pcm[k]! * pcm[k]!;
    const r = Math.sqrt(s / FRAME);
    rms.push(r);
    env.push(Math.log10(r + 1e-4));
  }
  return { env, rms };
}

function pearson(a: number[], b: number[], offset: number): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i + offset]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i + offset]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

// --- GCC-PHAT: ¿aparece el sonido de las bocinas dentro del micrófono, y con qué retraso? ------------

function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k]!;
        const ai = im[i + k]!;
        const br = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const bi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Baja a 8 kHz promediando pares (suficiente para comparar voz). */
function half(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (x[2 * i]! + x[2 * i + 1]!) / 2;
  return out;
}

/**
 * Busca `mic` dentro de `ref` (que tiene margen antes y después). Devuelve el desfase en muestras de
 * 16 kHz y qué tan sobresaliente es el pico (puntaje z): con eco real el pico es muy marcado; con voces
 * independientes no hay pico.
 */
export function findEchoLag(mic: Float32Array, ref: Float32Array): { lag: number; z: number } {
  const a = half(mic);
  const b = half(ref);
  let n = 1;
  while (n < a.length + b.length) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(a);
  br.set(b);
  fft(ar, ai, false);
  fft(br, bi, false);
  for (let k = 0; k < n; k++) {
    // conj(A)·B, normalizado por su magnitud (PHAT)
    const re = ar[k]! * br[k]! + ai[k]! * bi[k]!;
    const im = ar[k]! * bi[k]! - ai[k]! * br[k]!;
    const mag = Math.hypot(re, im) + 1e-12;
    ar[k] = re / mag;
    ai[k] = im / mag;
  }
  fft(ar, ai, true);
  const maxLag = b.length - a.length;
  if (maxLag < 1) return { lag: 0, z: 0 };
  let best = 0;
  let sum = 0;
  let sum2 = 0;
  for (let l = 0; l <= maxLag; l++) {
    const v = ar[l]!;
    sum += v;
    sum2 += v * v;
    if (v > ar[best]!) best = l;
  }
  const count = maxLag + 1;
  const mean = sum / count;
  const sd = Math.sqrt(Math.max(1e-24, sum2 / count - mean * mean));
  return { lag: best * 2, z: (ar[best]! - mean) / sd };
}

const MIN_PEAK_Z = 8; // sin pico claro no hay eco (voces independientes rondan z≈4–5)

/**
 * Puntaje 0–1 de que `mic` sea eco de `ref`. `ref` cubre el mismo tramo que `mic` con 1 s extra antes
 * y después (ver `echoScoreAt`). Dos pasos: (1) GCC-PHAT confirma que el sonido de las bocinas está en
 * el micrófono y da el retraso; (2) en ese retraso, qué tanto la energía del micrófono sigue a la de las
 * bocinas. Si además hablas tú encima, (2) baja.
 */
export function echoScore(mic: Float32Array, ref: Float32Array): number {
  const m = envelope(mic);
  const r = envelope(ref);
  if (m.env.length < 25 || r.env.length < m.env.length) return 0; // < 0.5 s
  const voicedRef = r.rms.filter((x) => x > SILENT_RMS).length;
  if (voicedRef < m.env.length * 0.3) return 0; // las bocinas casi calladas: no puede ser eco
  const { lag, z } = findEchoLag(mic, ref);
  if (z < MIN_PEAK_Z) return 0;
  const off = Math.min(r.env.length - m.env.length, Math.round(lag / FRAME));
  return Math.max(0, Math.min(1, pearson(m.env, r.env, off)));
}

/** Puntaje de eco de un fragmento del micrófono que empieza en `startSample` (misma línea de tiempo). */
export function echoScoreAt(ring: SystemRing, mic: Float32Array, startSample: number): number {
  const margin = MAX_LAG_FRAMES * FRAME;
  return echoScore(mic, ring.slice(startSample - margin, startSample + mic.length + margin));
}
