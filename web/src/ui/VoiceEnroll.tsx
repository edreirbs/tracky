import { useRef, useState } from "preact/hooks";
import { deleteVoice, enrollVoice } from "../bridge/client.js";
import { openMic } from "../capture/devices.js";
import { floatToInt16 } from "../capture/vad.js";

const SECONDS = 30;

const TEXT =
  "Hola, soy yo. Estoy registrando mi voz para que la aplicación sepa cuándo hablo en las reuniones. " +
  "Hoy revisamos los avances del proyecto, los acuerdos de la semana pasada y los siguientes pasos. " +
  "Me interesa que el resumen sea claro, que las tareas tengan responsable y que nada importante se pierda. " +
  "Si hace falta, puedo seguir leyendo este texto con calma, con mi tono de voz normal, como en cualquier junta.";

/** Registro de la huella de voz de "Yo" (ADR-0011): 30 s leyendo un texto, una sola vez. */
export function VoiceEnroll(props: { registered: boolean; onChange: () => void }) {
  const [state, setState] = useState<"idle" | "recording" | "saving" | "done" | "error">("idle");
  const [left, setLeft] = useState(SECONDS);
  const [message, setMessage] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);

  async function record() {
    setMessage(null);
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      stream = await openMic(undefined);
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}worklets/capture-processor.js`);
      const node = new AudioWorkletNode(ctx, "capture-processor", { numberOfInputs: 2, numberOfOutputs: 1 });
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);
      ctx.createMediaStreamSource(stream).connect(node, 0, 0);
      const blocks: Float32Array[] = [];
      node.port.onmessage = (ev: MessageEvent<{ channel: 0 | 1; pcm: Float32Array }>) => {
        if (ev.data.channel === 0) blocks.push(ev.data.pcm);
      };
      setState("recording");
      const ok = await new Promise<boolean>((resolve) => {
        let t = SECONDS;
        setLeft(t);
        const id = setInterval(() => {
          setLeft(--t);
          if (t <= 0) {
            clearInterval(id);
            resolve(true);
          }
        }, 1000);
        cancel.current = () => {
          clearInterval(id);
          resolve(false);
        };
      });
      node.port.postMessage("stop");
      if (!ok) {
        setState("idle");
        return;
      }
      setState("saving");
      const total = blocks.reduce((n, b) => n + b.length, 0);
      const pcm = new Float32Array(total);
      let off = 0;
      for (const b of blocks) {
        pcm.set(b, off);
        off += b.length;
      }
      const result = await enrollVoice(floatToInt16(pcm));
      if (result === "ok") {
        setState("done");
        props.onChange();
      } else {
        setState("error");
        setMessage(
          result === "not_enough_voice"
            ? "No se escuchó suficiente voz. Lee el texto en voz alta, cerca del micrófono, e inténtalo de nuevo."
            : "No se pudo guardar en el puente. Revisa que esté encendido y emparejado.",
        );
      }
    } catch {
      setState("error");
      setMessage("No se pudo usar el micrófono.");
    } finally {
      cancel.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      await ctx?.close().catch(() => {});
    }
  }

  if (state === "recording") {
    return (
      <div class="voice-enroll">
        <p>
          <strong>🎙️ Lee en voz alta, con tu tono normal ({left} s):</strong>
        </p>
        <blockquote>{TEXT}</blockquote>
        <button class="link" onClick={() => cancel.current?.()}>
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div class="voice-enroll">
      {props.registered || state === "done" ? (
        <p class="muted">
          🎙️ Tu voz está registrada: la app reconoce cuándo hablas tú.{" "}
          <button class="link" onClick={() => void record()}>
            Volver a grabar
          </button>{" "}
          ·{" "}
          <button
            class="link"
            onClick={async () => {
              if (await deleteVoice()) {
                setState("idle");
                props.onChange();
              }
            }}
          >
            Borrar
          </button>
        </p>
      ) : (
        <p class="muted">
          🎙️ Para que la app distinga cuándo hablas tú,{" "}
          <button class="link" disabled={state === "saving"} onClick={() => void record()}>
            {state === "saving" ? "guardando…" : "registra tu voz (30 s, una sola vez)"}
          </button>
          . Se guarda solo en tu computadora.
        </p>
      )}
      {message && <p class="error">{message}</p>}
    </div>
  );
}
