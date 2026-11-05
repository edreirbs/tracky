import { type ManualNote, type MeetingMode, participantLabel } from "@tracky/shared";
import { BridgeSession } from "../bridge/client.js";
import type { BridgeHealth } from "../bridge/protocol.js";
import { SystemAudioStream } from "../bridge/system-audio.js";
import { NoSharedAudioError, onDeviceChange, openMic, openSystemAudio, type PlatformHint } from "../capture/devices.js";
import { echoScoreAt, SystemRing } from "../capture/echo.js";
import { floatToInt16, SAMPLE_RATE, VadSegmenter } from "../capture/vad.js";
import { getVocabulary } from "./vocabulary.js";
import {
  addSegment,
  deletePendingAudio,
  getMeeting,
  getPendingAudio,
  getSegments,
  putPendingAudio,
  saveMeeting,
  updateMeeting,
  type MeetingRecord,
} from "../storage/db.js";
import { enqueueCreate } from "../sync/outbox.js";

export interface LiveSegment {
  seq: number;
  startMs: number;
  endMs: number;
  channel: 0 | 1;
  text: string;
  /** "Participante N" si el puente distinguió la voz (ADR-0010). */
  speaker?: string;
}

/**
 * Canales donde distinguir voces. En línea, ambos: en "Otros" separa a las personas y en el micrófono
 * reconoce tu voz si registraste tu huella (ADR-0011). En persona, el micrófono.
 */
export function diarizeChannelsFor(mode: MeetingMode): Array<0 | 1> {
  return mode === "online" ? [0, 1] : [0];
}

type BridgeSegment = { channel: 0 | 1; startMs: number; endMs: number; text: string; speaker?: number };

/** Segmento del puente → registro local. Usa un `seq` propio: varios segmentos pueden venir del mismo fragmento. */
function toSegment(seq: number, s: BridgeSegment): LiveSegment {
  return {
    seq,
    startMs: s.startMs,
    endMs: s.endMs,
    channel: s.channel,
    text: s.text,
    ...(s.speaker === 0 ? { speaker: "Yo" } : s.speaker ? { speaker: participantLabel(s.speaker) } : {}),
  };
}

/**
 * macOS no entrega audio del sistema mientras nada suena: hay que rellenar ese hueco con silencio para
 * que las marcas de tiempo de "Otros" sigan alineadas con el reloj de la junta. Devuelve cuántas
 * muestras de silencio insertar antes del bloque que acaba de llegar (0 si no hay hueco relevante).
 */
export function silenceGap(expectedSamples: number, receivedSamples: number, blockLen: number, toleranceSamples = 4800): number {
  const gap = expectedSamples - blockLen - receivedSamples;
  return gap > toleranceSamples ? Math.floor(gap) : 0;
}

export interface RecorderEvents {
  onSegment(s: LiveSegment): void;
  onLevels(levels: [number, number]): void;
  onBridge(status: "connecting" | "ready" | "offline" | "unauthorized", pending: number): void;
  onLag(queuedSec: number): void;
  onWarning(message: string): void;
}

export interface StartOptions {
  mode: MeetingMode;
  templateId: string;
  micId?: string | undefined;
  extraInstructions?: string | undefined;
  bridge: BridgeHealth | null;
  /** Audio de los demás: captura nativa del puente (sin diálogo) o compartir pestaña/pantalla. */
  otherAudio?: "bridge" | "share" | undefined;
}

export class Recorder {
  readonly meetingId = crypto.randomUUID();
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private sysStream: MediaStream | null = null;
  private sysBridge: SystemAudioStream | null = null;
  private stopping = false;
  private sysSamples = 0;
  /** Último momento (ms de junta) con sonido de los demás, y si se dejó de compartir (ADR-0012). */
  lastOtherSoundMs = 0;
  shareEnded = false;
  /** Audio reciente de "Otros" para reconocer eco en el micrófono (ADR-0011). */
  private sysRing = new SystemRing(60);
  private vads: [VadSegmenter, VadSegmenter];
  private bridge: BridgeSession;
  private chunkSeq = 0;
  private segSeq = 0;
  private startedAt = new Date();
  private elapsedBeforePause = 0;
  private runningSince = performance.now();
  private paused = false;
  private stopDeviceWatch: () => void = () => {};
  private levels: [number, number] = [0, 0];
  /** Escrituras en curso (fragmentos y segmentos): stop() las espera antes de cerrar. */
  private inflight = new Set<Promise<void>>();
  private maxLevel = 0;
  private micId: string | undefined;
  manualNotes: ManualNote[] = [];
  markedImportant = false;
  platform: PlatformHint = null;
  mode: MeetingMode = "online";

  constructor(private readonly events: RecorderEvents) {
    const onChunk = (channel: 0 | 1) => (c: { startMs: number; pcm: Float32Array }) =>
      this.track(this.handleChunk(channel, c.startMs, c.pcm));
    this.vads = [new VadSegmenter(onChunk(0)), new VadSegmenter(onChunk(1))];
    this.bridge = new BridgeSession(this.meetingId, getVocabulary(), {
      onSegment: (s) => this.track(this.handleSegment(s)),
      onChunkDone: (seq) => {
        void deletePendingAudio(this.meetingId, seq);
        this.events.onBridge(this.bridge.isReady ? "ready" : "offline", this.bridge.pendingCount);
      },
      onStatus: (st) => this.events.onBridge(st, this.bridge.pendingCount),
      onLag: (q) => this.events.onLag(q),
    });
  }

  elapsedMs(): number {
    return this.elapsedBeforePause + (this.paused ? 0 : performance.now() - this.runningSince);
  }

  async start(opts: StartOptions): Promise<void> {
    this.micId = opts.micId;
    this.mode = opts.mode;
    this.bridge.diarizeChannels = diarizeChannelsFor(opts.mode);
    this.bridge.mode = opts.mode;
    this.micStream = await openMic(opts.micId);
    if (opts.mode === "online" && opts.otherAudio === "bridge") {
      const sys = new SystemAudioStream(
        (pcm) => this.handleSystemBlock(pcm),
        (message) => this.events.onWarning(`${message} Solo se graba tu micrófono.`),
      );
      try {
        await sys.start();
      } catch (err) {
        this.micStream.getTracks().forEach((t) => t.stop());
        throw new Error(`${err instanceof Error ? err.message : String(err)} Elige “Compartir pestaña” en “Audio de los demás”.`, { cause: err });
      }
      this.sysBridge = sys;
    } else if (opts.mode === "online") {
      try {
        const sys = await openSystemAudio();
        this.sysStream = sys.stream;
        this.platform = sys.platform;
        sys.stream.getAudioTracks()[0]?.addEventListener("ended", () => {
          this.shareEnded = true;
          this.events.onWarning("Se dejó de compartir el audio de la reunión.");
        });
      } catch (err) {
        this.micStream.getTracks().forEach((t) => t.stop());
        if (err instanceof NoSharedAudioError) throw err;
        throw new Error("Se canceló el diálogo de compartir. Para juntas en línea elige la pestaña o pantalla con audio.", { cause: err });
      }
    }

    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}worklets/capture-processor.js`);
    const node = new AudioWorkletNode(ctx, "capture-processor", { numberOfInputs: 2, numberOfOutputs: 1 });
    this.node = node;
    const mute = ctx.createGain();
    mute.gain.value = 0; // el nodo debe estar conectado para procesarse; no se reproduce nada
    node.connect(mute).connect(ctx.destination);

    this.micSource = ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.voiceFilter(ctx, node, 0));
    if (this.sysStream) ctx.createMediaStreamSource(this.sysStream).connect(this.voiceFilter(ctx, node, 1));

    node.port.onmessage = (ev: MessageEvent<{ channel: 0 | 1; pcm: Float32Array; level: number }>) => {
      const { channel, pcm, level } = ev.data;
      this.levels[channel] = level;
      this.maxLevel = Math.max(this.maxLevel, level);
      this.events.onLevels([...this.levels] as [number, number]);
      this.vads[channel].push(pcm);
      if (channel === 1) {
        this.sysRing.push(pcm);
        if (level > 0.01) this.lastOtherSoundMs = this.elapsedMs();
      }
    };

    this.stopDeviceWatch = onDeviceChange(() => void this.swapMicIfDefaultChanged());

    this.startedAt = new Date();
    this.runningSince = performance.now();
    const meeting: MeetingRecord = {
      id: this.meetingId,
      startedAt: this.startedAt.toISOString(),
      mode: opts.mode,
      platformHint: this.platform,
      templateId: opts.templateId,
      ...(opts.extraInstructions ? { extraInstructions: opts.extraInstructions } : {}),
      markedImportant: false,
      manualNotes: [],
      ...(opts.bridge ? { transcription: { engine: opts.bridge.engine, model: opts.bridge.model } } : {}),
      state: "recording",
    };
    await saveMeeting(meeting);
    this.bridge.connect();
  }

  /**
   * Filtro de voz por canal: pasa-altos 80 Hz (zumbidos, golpes en la mesa, aire acondicionado) y
   * pasa-bajos 7 kHz (antialias antes de bajar a 16 kHz; sin él, el ruido agudo se "dobla" dentro de
   * la banda de voz y Whisper lo interpreta como palabras). Devuelve la entrada del filtro.
   */
  private voiceFilter(ctx: AudioContext, node: AudioWorkletNode, input: 0 | 1): AudioNode {
    const highpass = new BiquadFilterNode(ctx, { type: "highpass", frequency: 80, Q: 0.7 });
    const lowpass1 = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 7000, Q: 0.7 });
    const lowpass2 = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 7000, Q: 0.7 });
    highpass.connect(lowpass1).connect(lowpass2).connect(node, 0, input);
    if (input === 0) this.micFilterInput = highpass;
    return highpass;
  }

  private micFilterInput: AudioNode | null = null;

  /** Bloque de 100 ms (16 kHz) del audio del sistema que captura el puente: canal "Otros". */
  private handleSystemBlock(pcm: Float32Array): void {
    if (this.paused || this.stopping) return;
    const missing = silenceGap((this.elapsedMs() / 1000) * 16_000, this.sysSamples, pcm.length);
    for (let left = missing; left > 0; left -= 1600) {
      const n = Math.min(1600, left);
      const silence = new Float32Array(n);
      this.vads[1].push(silence);
      this.sysRing.push(silence);
      this.sysSamples += n;
    }
    this.sysSamples += pcm.length;
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
    this.levels[1] = Math.sqrt(sum / Math.max(1, pcm.length));
    if (this.levels[1] > 0.01) this.lastOtherSoundMs = this.elapsedMs();
    this.events.onLevels([...this.levels] as [number, number]);
    this.vads[1].push(pcm);
    this.sysRing.push(pcm);
  }

  /** Si el usuario usa el micrófono predeterminado y conecta/desconecta audífonos, lo seguimos. */
  private async swapMicIfDefaultChanged(): Promise<void> {
    if (!this.ctx || !this.node || (this.micId && this.micId !== "default")) return;
    try {
      const fresh = await openMic(undefined);
      const oldLabel = this.micStream?.getAudioTracks()[0]?.label;
      const newLabel = fresh.getAudioTracks()[0]?.label;
      if (oldLabel === newLabel) {
        fresh.getTracks().forEach((t) => t.stop());
        return;
      }
      this.micSource?.disconnect();
      this.micStream?.getTracks().forEach((t) => t.stop());
      this.micStream = fresh;
      this.micSource = this.ctx.createMediaStreamSource(fresh);
      this.micSource.connect(this.micFilterInput ?? this.voiceFilter(this.ctx, this.node, 0));
      this.events.onWarning(`Micrófono cambiado a: ${newLabel ?? "predeterminado"}`);
    } catch {
      this.events.onWarning("No se pudo cambiar al nuevo micrófono.");
    }
  }

  private track(p: Promise<void>): void {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  private async settle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  /** Nivel máximo visto: si sigue en ~0, no llegó audio del micrófono. */
  get heardAudio(): boolean {
    return this.maxLevel > 0.003;
  }

  private async handleChunk(channel: 0 | 1, startMs: number, pcm: Float32Array): Promise<void> {
    const seq = this.chunkSeq++;
    const int16 = floatToInt16(pcm);
    // ¿Es solo eco de las bocinas? (en línea, micrófono). El puente decide con esto y tu huella de voz.
    const echo =
      channel === 0 && this.mode === "online" ? echoScoreAt(this.sysRing, pcm, Math.round((startMs / 1000) * SAMPLE_RATE)) : 0;
    // Durable primero: si el puente está apagado o se cierra la pestaña, se transcribe después.
    await putPendingAudio({ meetingId: this.meetingId, seq, channel, startMs, pcm: int16.buffer as ArrayBuffer, echo });
    this.bridge.enqueue({ seq, channel, startMs, pcm: int16, echo });
    this.events.onBridge(this.bridge.isReady ? "ready" : "offline", this.bridge.pendingCount);
  }

  private async handleSegment(s: BridgeSegment): Promise<void> {
    const seg = toSegment(this.segSeq++, s);
    await addSegment({ meetingId: this.meetingId, ...seg });
    this.events.onSegment(seg);
  }

  async pause(): Promise<void> {
    if (this.paused || !this.ctx) return;
    this.elapsedBeforePause = this.elapsedMs();
    this.paused = true;
    await this.ctx.suspend();
  }

  async resume(): Promise<void> {
    if (!this.paused || !this.ctx) return;
    this.paused = false;
    this.runningSince = performance.now();
    await this.ctx.resume();
  }

  addNote(text: string): void {
    this.manualNotes.push({ atMs: Math.round(this.elapsedMs()), text });
    void updateMeeting(this.meetingId, { manualNotes: this.manualNotes });
  }

  setImportant(v: boolean): void {
    this.markedImportant = v;
    void updateMeeting(this.meetingId, { markedImportant: v });
  }

  /**
   * Detiene la captura, espera a que Whisper termine y encola el envío a Supabase.
   * Si no hubo voz ni notas, NO crea una nota vacía: marca la junta como fallida con el motivo.
   */
  async stop(): Promise<{ transcribedAll: boolean; empty: boolean }> {
    const durationSec = Math.round(this.elapsedMs() / 1000);
    this.stopping = true;
    this.sysBridge?.stop();
    this.vads.forEach((v) => v.flush());
    this.node?.port.postMessage("stop");
    this.stopDeviceWatch();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.sysStream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    await updateMeeting(this.meetingId, { state: "finalizing", endedAt: new Date().toISOString(), durationSec });

    // 1) Que el último fragmento (el del flush) quede guardado y enviado al puente.
    await this.settle();
    // 2) Que Whisper procese todo lo enviado.
    const transcribedAll = await this.bridge.drain();
    // 3) Que los últimos segmentos queden escritos en IndexedDB.
    await this.settle();
    this.bridge.close();

    const segments = await getSegments(this.meetingId);
    const pending = await getPendingAudio(this.meetingId);
    if (segments.length === 0 && pending.length === 0 && this.manualNotes.length === 0) {
      await updateMeeting(this.meetingId, {
        state: "failed",
        error: {
          type: "empty_transcript",
          detail: this.heardAudio
            ? "No se detectó voz en la grabación. No se creó la nota."
            : "No llegó audio del micrófono (revisa el permiso o el dispositivo). No se creó la nota.",
          retryable: false,
        },
      });
      return { transcribedAll, empty: true };
    }
    await enqueueCreate(this.meetingId);
    return { transcribedAll, empty: false };
  }
}

/** Transcribe el audio que quedó pendiente (puente apagado, pestaña cerrada) de una junta. */
export async function transcribePending(
  meetingId: string,
  onStatus: (pending: number) => void,
): Promise<boolean> {
  const pending = await getPendingAudio(meetingId);
  if (pending.length === 0) return true;
  let segSeq = (await getSegments(meetingId)).reduce((m, s) => Math.max(m, s.seq + 1), 0);
  const writes: Array<Promise<void>> = [];
  const meeting = await getMeeting(meetingId);
  const session = new BridgeSession(meetingId, getVocabulary(), {
    onSegment: (s) => void writes.push(addSegment({ meetingId, ...toSegment(segSeq++, s) })),
    onChunkDone: (seq) => {
      void deletePendingAudio(meetingId, seq);
      onStatus(session.pendingCount);
    },
    onStatus: () => onStatus(session.pendingCount),
    onLag: () => {},
  }, meeting ? diarizeChannelsFor(meeting.mode) : [], meeting?.mode ?? "online");
  for (const p of pending) session.enqueue({ seq: p.seq, channel: p.channel, startMs: p.startMs, pcm: new Int16Array(p.pcm), echo: p.echo });
  session.connect();
  // Espera a estar listo (máx. 10 s) y luego a vaciar la cola.
  for (let i = 0; i < 40 && !session.isReady; i++) await new Promise((r) => setTimeout(r, 250));
  const ok = session.isReady && (await session.drain(10 * 60_000));
  session.close();
  await Promise.allSettled(writes);
  return ok;
}
