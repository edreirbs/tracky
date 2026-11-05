import { BRIDGE_URL } from "../config.js";
import { forgetBridgeToken, readToken } from "./client.js";
import { pcm16ToFloat } from "./protocol.js";

const MESSAGES: Record<string, string> = {
  unavailable: "Esta computadora no tiene la captura nativa instalada (tracky-audiotap).",
  busy: "El audio del sistema ya se está capturando en otra pestaña.",
  unauthorized: "El puente no está emparejado.",
  capture_failed: "macOS no permitió capturar el audio del sistema.",
  tap_create: "macOS no permitió capturar el audio del sistema. Revisa el permiso en Ajustes → Privacidad y seguridad.",
  macos_too_old: "La captura nativa requiere macOS 14.2 o posterior.",
};

export function systemAudioMessage(code: string): string {
  return MESSAGES[code] ?? `Se interrumpió la captura del audio del sistema (${code}).`;
}

/**
 * Audio de los demás capturado por el puente (Core Audio en la Mac), sin el diálogo de "compartir".
 * Llega como PCM16 16 kHz mono en bloques de 100 ms por 127.0.0.1; la página lo trata como el canal
 * "Otros" igual que si viniera de una pestaña compartida.
 */
export class SystemAudioStream {
  private ws: WebSocket | null = null;
  private stopped = false;

  constructor(
    private readonly onBlock: (pcm: Float32Array) => void,
    private readonly onEnded: (message: string) => void,
  ) {}

  /** Resuelve cuando el puente empezó a capturar; rechaza con un mensaje en español si no se pudo. */
  start(timeoutMs = 8000): Promise<void> {
    const token = readToken();
    if (!token) return Promise.reject(new Error(systemAudioMessage("unauthorized")));
    return new Promise((resolve, reject) => {
      let started = false;
      const ws = new WebSocket(`${BRIDGE_URL.replace(/^http/, "ws")}/system-audio`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      const timer = setTimeout(() => {
        if (started) return;
        ws.close();
        reject(new Error("El puente no respondió al iniciar la captura del audio del sistema."));
      }, timeoutMs);
      ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token }));
      ws.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => {
        if (typeof ev.data !== "string") {
          this.onBlock(pcm16ToFloat(ev.data));
          return;
        }
        const msg = JSON.parse(ev.data) as { type: string; code?: string };
        if (msg.type === "ready") {
          started = true;
          clearTimeout(timer);
          resolve();
        } else if (msg.type === "error") {
          if (msg.code === "unauthorized") forgetBridgeToken();
          const text = systemAudioMessage(msg.code ?? "capture_failed");
          if (started) {
            if (!this.stopped) this.onEnded(text);
          } else {
            clearTimeout(timer);
            reject(new Error(text));
          }
          this.stopped = true;
        }
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!started) reject(new Error("No se pudo conectar con el puente para capturar el audio del sistema."));
        else if (!this.stopped) this.onEnded("Se perdió la conexión con el puente: solo se graba tu micrófono.");
        this.stopped = true;
      };
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "stop" }));
    this.ws?.close();
  }
}
