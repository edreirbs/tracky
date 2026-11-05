import { BRIDGE_URL } from "../config.js";
import { type BridgeHealth, type BridgeMessage, encodeFrame } from "./protocol.js";

const TOKEN_KEY = "tracky-bridge-token";

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function bridgeHealth(): Promise<BridgeHealth | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as BridgeHealth) : null;
  } catch {
    return null; // puente apagado o permiso de red local denegado
  }
}

export function hasBridgeToken(): boolean {
  return readToken() !== null;
}

export async function pairBridge(code: string): Promise<boolean> {
  const res = await fetch(`${BRIDGE_URL}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: code.trim() }),
  });
  if (!res.ok) return false;
  const { token } = (await res.json()) as { token: string };
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    return false;
  }
  return true;
}

export function forgetBridgeToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

export interface Chunk {
  seq: number;
  channel: 0 | 1;
  startMs: number;
  pcm: Int16Array;
  /** 0–1: cuánto se parece este fragmento del micrófono al audio de las bocinas (ADR-0011). */
  echo?: number | undefined;
}

export interface BridgeHandlers {
  onSegment(s: Extract<BridgeMessage, { type: "segment" }>): void;
  onChunkDone(seq: number): void;
  onStatus(status: "connecting" | "ready" | "offline" | "unauthorized"): void;
  onLag(queuedSec: number): void;
}

/**
 * Sesión de transcripción con reconexión: guarda los fragmentos sin confirmar y los reenvía al
 * reconectar (el puente es idempotente por seq).
 */
export class BridgeSession {
  private ws: WebSocket | null = null;
  private unacked = new Map<number, Chunk>();
  private closed = false;
  private retry = 0;
  private drainedResolvers: Array<() => void> = [];
  private ready = false;

  constructor(
    private readonly meetingId: string,
    private readonly vocabulary: readonly string[],
    private readonly handlers: BridgeHandlers,
    /** Canales en los que el puente distingue voces: en línea 1 ("Otros"), en persona 0. */
    public diarizeChannels: ReadonlyArray<0 | 1> = [],
    public mode: "online" | "in_person" = "online",
  ) {}

  connect(): void {
    const token = readToken();
    if (!token) {
      this.handlers.onStatus("unauthorized");
      return;
    }
    this.handlers.onStatus("connecting");
    const ws = new WebSocket(`${BRIDGE_URL.replace(/^http/, "ws")}/transcribe`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", token, meetingId: this.meetingId, language: "es", vocabulary: this.vocabulary, diarizeChannels: this.diarizeChannels, mode: this.mode }));
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as BridgeMessage);
    ws.onclose = (ev) => {
      this.ready = false;
      if (ev.code === 4401) {
        forgetBridgeToken();
        this.handlers.onStatus("unauthorized");
        return;
      }
      if (this.closed) return;
      this.handlers.onStatus("offline");
      const delay = Math.min(10_000, 500 * 2 ** this.retry++) * (0.5 + Math.random() / 2);
      setTimeout(() => !this.closed && this.connect(), delay);
    };
  }

  /** Reenvía fragmentos que quedaron pendientes (p. ej. recuperados de IndexedDB). */
  enqueue(chunk: Chunk): void {
    this.unacked.set(chunk.seq, chunk);
    if (this.ready) this.sendChunk(chunk);
  }

  get pendingCount(): number {
    return this.unacked.size;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Espera a que el puente procese todo. Resuelve aunque esté apagado (lo pendiente queda guardado). */
  async drain(timeoutMs = 120_000): Promise<boolean> {
    if (!this.ready) return this.unacked.size === 0;
    const done = new Promise<void>((resolve) => this.drainedResolvers.push(resolve));
    this.ws?.send(JSON.stringify({ type: "flush" }));
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), timeoutMs));
    return (await Promise.race([done, timeout])) !== "timeout" && this.unacked.size === 0;
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private sendChunk(c: Chunk): void {
    this.ws?.send(encodeFrame(c.seq, c.channel, c.startMs, c.pcm, c.echo ?? 0));
  }

  private onMessage(msg: BridgeMessage): void {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        this.retry = 0;
        this.handlers.onStatus("ready");
        for (const c of [...this.unacked.values()].sort((a, b) => a.seq - b.seq)) this.sendChunk(c);
        break;
      case "segment":
        this.handlers.onSegment(msg);
        break;
      case "chunk_done":
        this.unacked.delete(msg.seq);
        this.handlers.onChunkDone(msg.seq);
        break;
      case "lag":
        this.handlers.onLag(msg.queuedSec);
        break;
      case "drained":
        this.drainedResolvers.splice(0).forEach((r) => r());
        break;
      case "error":
        if (msg.code === "unauthorized") {
          forgetBridgeToken();
          this.handlers.onStatus("unauthorized");
        }
        break;
    }
  }
}

/** Registra la huella de voz de "Yo" en el puente (ADR-0011). El audio solo viaja a 127.0.0.1. */
export async function enrollVoice(pcm: Int16Array): Promise<"ok" | "not_enough_voice" | "error"> {
  const token = readToken();
  if (!token) return "error";
  try {
    const res = await fetch(`${BRIDGE_URL}/voice`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
      body: pcm.buffer as ArrayBuffer,
    });
    if (res.ok) return "ok";
    return res.status === 422 ? "not_enough_voice" : "error";
  } catch {
    return "error";
  }
}

export async function deleteVoice(): Promise<boolean> {
  const token = readToken();
  if (!token) return false;
  try {
    return (await fetch(`${BRIDGE_URL}/voice`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } })).ok;
  } catch {
    return false;
  }
}

/** Apps de videollamada con el micrófono abierto (ADR-0012). null si el puente no puede saberlo. */
export async function activeCallApps(): Promise<string[] | null> {
  const token = readToken();
  if (!token) return null;
  try {
    const res = await fetch(`${BRIDGE_URL}/calls`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { supported: boolean; apps: string[] };
    return body.supported ? body.apps : null;
  } catch {
    return null;
  }
}
