/**
 * Detector de voz por energía con piso de ruido adaptativo. Corta el audio en frases de 2–15 s
 * para que Whisper reciba fragmentos con contexto y sin silencios largos (menos alucinaciones).
 */
export const SAMPLE_RATE = 16_000;

export interface VadOptions {
  minSpeechMs: number; // frases más cortas se descartan (clics, toses)
  maxChunkMs: number; // corte forzado
  hangoverMs: number; // silencio que termina una frase
  preRollMs: number; // audio previo que se incluye al detectar voz
  thresholdDb: number; // dB sobre el piso de ruido
  minLevelDbfs: number; // nunca considerar voz por debajo de esto
  minSpeechRatio: number; // fracción mínima del fragmento con voz (si no, es ruido)
}

export const DEFAULT_VAD: VadOptions = {
  minSpeechMs: 500,
  maxChunkMs: 15_000,
  hangoverMs: 700,
  preRollMs: 300,
  thresholdDb: 8,
  minLevelDbfs: -55,
  minSpeechRatio: 0.35,
};

export interface SpeechChunk {
  startMs: number;
  pcm: Float32Array;
}

const toDb = (rms: number) => 20 * Math.log10(Math.max(rms, 1e-8));

export class VadSegmenter {
  private noiseDb = -60;
  private inSpeech = false;
  private buffers: Float32Array[] = [];
  private bufferedSamples = 0;
  private speechSamples = 0;
  private silenceMs = 0;
  private chunkStartSample = 0;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private processedSamples = 0;
  private readonly opts: VadOptions;

  constructor(
    private readonly onChunk: (chunk: SpeechChunk) => void,
    opts: Partial<VadOptions> = {},
  ) {
    this.opts = { ...DEFAULT_VAD, ...opts };
  }

  /** Bloques de 16 kHz (típicamente 100 ms). */
  push(block: Float32Array): void {
    const blockMs = (block.length / SAMPLE_RATE) * 1000;
    let sum = 0;
    for (let i = 0; i < block.length; i++) sum += block[i]! * block[i]!;
    const db = toDb(Math.sqrt(sum / block.length));
    const isVoice = db > this.noiseDb + this.opts.thresholdDb && db > this.opts.minLevelDbfs;

    if (!isVoice) {
      // El piso de ruido sigue lentamente al nivel en silencio.
      this.noiseDb = this.noiseDb * 0.95 + db * 0.05;
    }

    if (this.inSpeech) {
      this.append(block);
      if (isVoice) {
        this.speechSamples += block.length;
        this.silenceMs = 0;
      } else {
        this.silenceMs += blockMs;
      }
      const lengthMs = (this.bufferedSamples / SAMPLE_RATE) * 1000;
      if (this.silenceMs >= this.opts.hangoverMs || lengthMs >= this.opts.maxChunkMs) this.emit();
    } else if (isVoice) {
      this.inSpeech = true;
      this.chunkStartSample = this.processedSamples - this.preRollSamples;
      for (const b of this.preRoll) this.append(b);
      this.preRoll = [];
      this.preRollSamples = 0;
      this.append(block);
      this.speechSamples = block.length;
      this.silenceMs = 0;
    } else {
      this.preRoll.push(block);
      this.preRollSamples += block.length;
      const maxPre = (this.opts.preRollMs / 1000) * SAMPLE_RATE;
      while (this.preRollSamples - (this.preRoll[0]?.length ?? 0) >= maxPre && this.preRoll.length > 1) {
        this.preRollSamples -= this.preRoll.shift()!.length;
      }
    }
    this.processedSamples += block.length;
  }

  /** Entrega lo pendiente (al detener la grabación). */
  flush(): void {
    if (this.inSpeech) this.emit();
  }

  private append(block: Float32Array): void {
    this.buffers.push(block);
    this.bufferedSamples += block.length;
  }

  private emit(): void {
    const speechMs = (this.speechSamples / SAMPLE_RATE) * 1000;
    const ratio = this.bufferedSamples > 0 ? this.speechSamples / this.bufferedSamples : 0;
    // Fragmentos casi sin voz (ruido de fondo, teclado) no se envían: Whisper alucina con ellos.
    if (speechMs >= this.opts.minSpeechMs && ratio >= this.opts.minSpeechRatio) {
      const pcm = new Float32Array(this.bufferedSamples);
      let off = 0;
      for (const b of this.buffers) {
        pcm.set(b, off);
        off += b.length;
      }
      this.onChunk({ startMs: Math.max(0, Math.round((this.chunkStartSample / SAMPLE_RATE) * 1000)), pcm });
    }
    this.inSpeech = false;
    this.buffers = [];
    this.bufferedSamples = 0;
    this.speechSamples = 0;
    this.silenceMs = 0;
  }
}

export function floatToInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
