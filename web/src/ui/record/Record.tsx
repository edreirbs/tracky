// Grabar (spec 001, heredado de meeting-recording): captura, transcripción local y envío a Supabase.
import { formatTimestamp, type NoteEvent, speakerLabel } from "@tracky/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { activeCallApps, bridgeHealth, hasBridgeToken, pairBridge } from "../../bridge/client.js";
import type { BridgeHealth } from "../../bridge/protocol.js";
import { listMics, type MicDevice } from "../../capture/devices.js";
import { DEFAULT_TEMPLATE } from "../../config.js";
import { state } from "../../data/store.js";
import { downloadText, meetingToMarkdown } from "../../export/markdown.js";
import { TEMPLATES } from "../../generated/templates.js";
import { CallEndDetector } from "../../session/autostop.js";
import { needsRecovery } from "../../session/machine.js";
import { type LiveSegment, Recorder, transcribePending } from "../../session/recorder.js";
import {
  deleteEverything,
  getMeeting,
  getPendingAudio,
  getSegments,
  getSetting,
  listMeetings,
  type MeetingRecord,
  setSetting,
  updateMeeting,
} from "../../storage/db.js";
import { enqueueCreate, processOutbox, retryMeeting, startOutboxLoop } from "../../sync/outbox.js";
import { VoiceEnroll } from "../VoiceEnroll.js";

type View = { name: "home" } | { name: "live" } | { name: "review"; meetingId: string };
type BridgeStatus = "connecting" | "ready" | "offline" | "unauthorized";

const CONSENT_TEXT =
  "Aviso: esta reunión se transcribe localmente para generar notas. El audio no se almacena. Si alguien prefiere que no, avísenme.";

/** El recorder vive fuera del componente: cambiar de pestaña no detiene la grabación. */
let activeRecorder: Recorder | null = null;
export function isRecording(): boolean {
  return activeRecorder !== null;
}

export function RecordView({ onOpenNote }: { onOpenNote: (noteId: string) => void }) {
  const [view, setView] = useState<View>(activeRecorder ? { name: "live" } : { name: "home" });
  const [bridge, setBridge] = useState<BridgeHealth | null>(null);
  const [paired, setPaired] = useState(hasBridgeToken());
  const [history, setHistory] = useState<MeetingRecord[]>([]);
  const refreshHistory = () => void listMeetings().then(setHistory);
  const refreshBridge = () => void bridgeHealth().then(setBridge);

  useEffect(() => {
    refreshBridge();
    refreshHistory();
    const id = setInterval(refreshBridge, 10_000);
    return () => clearInterval(id);
  }, []);

  // Recuperación y cola de envío (juntas interrumpidas, sin red o con audio pendiente).
  useEffect(() => {
    let stop = () => {};
    void (async () => {
      for (const m of await listMeetings(200)) {
        if (!needsRecovery(m.state) || m.id === activeRecorder?.meetingId) continue;
        if (m.state === "recording" || m.state === "finalizing") {
          const segs = await getSegments(m.id);
          const durationSec = m.durationSec ?? Math.round(Math.max(0, ...segs.map((s) => s.endMs)) / 1000);
          await updateMeeting(m.id, { durationSec, endedAt: m.endedAt ?? new Date().toISOString() });
          await enqueueCreate(m.id);
        }
        if ((await getPendingAudio(m.id)).length > 0 && bridge && paired) await transcribePending(m.id, () => {});
      }
      stop = startOutboxLoop(refreshHistory);
    })();
    return () => stop();
  }, [bridge?.status, paired]);

  const noTags = state.tags.length === 0;
  return (
    <>
      <div class="row">
        <BridgePill bridge={bridge} paired={paired} />
      </div>
      {noTags && (
        <div class="banner follow">
          <p>
            Aún no tienes etiquetas. Sin ellas Claude no puede clasificar tus reuniones: agrégalas en <strong>Ajustes</strong> (la configuración
            inicial normalmente lo hace por ti).
          </p>
        </div>
      )}
      {(!bridge || !paired) && view.name === "home" && <BridgeSetup bridge={bridge} onRetry={refreshBridge} onPaired={() => setPaired(true)} />}
      {view.name === "home" && (
        <Home
          bridge={bridge}
          paired={paired}
          onBridgeChanged={refreshBridge}
          onStart={async (opts) => {
            const r = new Recorder(liveEvents);
            activeRecorder = r;
            await r.start({ ...opts, bridge });
            setView({ name: "live" });
          }}
        />
      )}
      {view.name === "live" && activeRecorder && (
        <Live
          recorder={activeRecorder}
          onStopped={(id) => {
            activeRecorder = null;
            setView({ name: "review", meetingId: id });
            refreshHistory();
          }}
        />
      )}
      {view.name === "review" && <Review meetingId={view.meetingId} onOpenNote={onOpenNote} onDone={() => (setView({ name: "home" }), refreshHistory())} />}
      {view.name === "home" && <History items={history} onOpen={(id) => setView({ name: "review", meetingId: id })} onChange={refreshHistory} />}
    </>
  );
}

// Los eventos en vivo se publican vía un pequeño bus para que <Live> se suscriba.
type LiveListener = Partial<{
  segment: (s: LiveSegment) => void;
  levels: (l: [number, number]) => void;
  bridge: (s: BridgeStatus, pending: number) => void;
  lag: (q: number) => void;
  warning: (w: string) => void;
}>;
const listeners = new Set<LiveListener>();
const liveEvents = {
  onSegment: (s: LiveSegment) => listeners.forEach((l) => l.segment?.(s)),
  onLevels: (v: [number, number]) => listeners.forEach((l) => l.levels?.(v)),
  onBridge: (s: BridgeStatus, p: number) => listeners.forEach((l) => l.bridge?.(s, p)),
  onLag: (q: number) => listeners.forEach((l) => l.lag?.(q)),
  onWarning: (w: string) => listeners.forEach((l) => l.warning?.(w)),
};

function BridgePill({ bridge, paired }: { bridge: BridgeHealth | null; paired: boolean }) {
  if (!bridge) return <span class="pill warn">Whisper: puente apagado</span>;
  if (!paired) return <span class="pill warn">Whisper: sin emparejar</span>;
  return (
    <span class="pill ok" title={`${bridge.engine} · ${bridge.model} · ${bridge.device}`}>
      Whisper listo · {(bridge.model ?? "").split("/").pop()}
    </span>
  );
}

function BridgeSetup(props: { bridge: BridgeHealth | null; onRetry: () => void; onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!props.bridge) {
    return (
      <section class="rec-card">
        <h2>Inicia el puente de Whisper</h2>
        <p>
          Normalmente arranca solo con tu Mac (lo instaló la configuración). Si no, en la Terminal ejecuta <code>tracky-bridge</code>. Puedes grabar de todos modos: el audio se guarda en
          este navegador y se transcribe en cuanto el puente esté activo.
        </p>
        <p class="muted">Si el navegador pregunta por acceso a la red local, permítelo (solo para 127.0.0.1).</p>
        <button class="btn" onClick={props.onRetry}>Volver a buscar</button>
      </section>
    );
  }
  return (
    <section class="rec-card">
      <h2>Empareja el puente</h2>
      <p>Escribe el código de 6 dígitos que muestra la Terminal (ejecuta <code>tracky-bridge pair</code> si venció).</p>
      <form
        class="row"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (await pairBridge(code)) props.onPaired();
          else setError("Código incorrecto o vencido.");
        }}
      >
        <input inputMode="numeric" maxLength={6} pattern="\d{6}" required value={code} onInput={(e) => setCode(e.currentTarget.value)} aria-label="Código" />
        <button class="btn primary">Emparejar</button>
      </form>
      {error && <p class="error">{error}</p>}
    </section>
  );
}

function Home(props: {
  bridge: BridgeHealth | null;
  paired: boolean;
  onBridgeChanged: () => void;
  onStart: (o: {
    mode: "online" | "in_person";
    templateId: string;
    micId?: string;
    extraInstructions?: string;
    otherAudio?: "bridge" | "share";
  }) => Promise<void>;
}) {
  const [mode, setMode] = useState<"online" | "in_person">("online");
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [micId, setMicId] = useState("default");
  const [extra, setExtra] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otherAudio, setOtherAudio] = useState<"bridge" | "share">("bridge");
  const nativeAvailable = Boolean(props.bridge?.systemAudio && props.paired);
  const useNative = mode === "online" && nativeAvailable && otherAudio === "bridge";

  useEffect(() => {
    void getSetting<{ mode: "online" | "in_person"; templateId: string; otherAudio?: "bridge" | "share" }>("prefs:v2").then((p) => {
      if (p) {
        setMode(p.mode);
        setTemplateId(p.templateId);
        if (p.otherAudio) setOtherAudio(p.otherAudio);
      }
    });
    void listMics().then(setMics).catch(() => {});
  }, []);

  return (
    <section class="rec-card">
      <div class="segmented" role="radiogroup" aria-label="Tipo de junta">
        <button role="radio" aria-checked={mode === "online"} class={mode === "online" ? "on" : ""} onClick={() => setMode("online")}>
          💻 En línea (Teams, Zoom, Meet)
        </button>
        <button role="radio" aria-checked={mode === "in_person"} class={mode === "in_person" ? "on" : ""} onClick={() => setMode("in_person")}>
          👥 En persona
        </button>
      </div>
      {mode === "online" && nativeAvailable && (
        <label>
          Audio de los demás
          <select value={otherAudio} onChange={(e) => setOtherAudio(e.currentTarget.value as "bridge" | "share")}>
            <option value="bridge">Automático: lo que suena en la Mac (Teams, Zoom…)</option>
            <option value="share">Compartir una pestaña o pantalla</option>
          </select>
        </label>
      )}
      {mode === "online" && useNative && (
        <p class="muted">Se graba tu micrófono y lo que suena en tu Mac, sin pedir compartir pantalla. El audio no sale de tu computadora.</p>
      )}
      {mode === "online" && !useNative && (
        <p class="muted">
          Al grabar, elige la <strong>pestaña</strong> o <strong>pantalla</strong> de la junta y activa <strong>“Compartir audio”</strong>.
          No se graba la pantalla.
        </p>
      )}
      {props.bridge?.speakers && props.paired && (
        <VoiceEnroll registered={Boolean(props.bridge.voiceprint)} onChange={props.onBridgeChanged} />
      )}
      <div class="grid">
        <label>
          Resumen
          <select value={templateId} onChange={(e) => setTemplateId(e.currentTarget.value)}>
            {TEMPLATES.map((t) => (
              <option value={t.id} title={t.descripcion}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Micrófono
          <select value={micId} onChange={(e) => setMicId(e.currentTarget.value)}>
            <option value="default">Predeterminado del sistema</option>
            {mics
              .filter((m) => m.deviceId !== "default" && m.deviceId)
              .map((m) => (
                <option value={m.deviceId}>{m.label}</option>
              ))}
          </select>
        </label>
      </div>
      <details>
        <summary>Instrucciones extra para el resumen</summary>
        <textarea maxLength={1000} rows={2} placeholder="Ej. enfócate en riesgos y fechas" value={extra} onInput={(e) => setExtra(e.currentTarget.value)} />
      </details>
      <p class="consent">
        🔔 Avisa a los participantes que se transcribe.{" "}
        <button class="link" onClick={() => void navigator.clipboard.writeText(CONSENT_TEXT)}>
          Copiar aviso para el chat
        </button>
      </p>
      {error && <p class="error" role="alert">{error}</p>}
      <button
        class="record"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await setSetting("prefs:v2", { mode, templateId, otherAudio });
            await props.onStart({
              mode,
              templateId,
              otherAudio: useNative ? "bridge" : "share",
              ...(micId !== "default" ? { micId } : {}),
              ...(extra.trim() ? { extraInstructions: extra.trim() } : {}),
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo iniciar la grabación.");
          } finally {
            setBusy(false);
          }
        }}
      >
        ● Grabar
      </button>
    </section>
  );
}

function Level({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.round(Math.sqrt(value) * 160));
  return (
    <div class="level" aria-label={`Nivel ${label}`}>
      <span>{label}</span>
      <div class="bar">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Live({ recorder, onStopped }: { recorder: Recorder; onStopped: (id: string) => void }) {
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [levels, setLevels] = useState<[number, number]>([0, 0]);
  const [bridge, setBridge] = useState<{ status: BridgeStatus; pending: number }>({ status: "connecting", pending: 0 });
  const [lag, setLag] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [important, setImportant] = useState(false);
  const [note, setNote] = useState("");
  const [stopping, setStopping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [autoStopIn, setAutoStopIn] = useState<number | null>(null);
  const detector = useRef(new CallEndDetector());

  const stopNow = async () => {
    if (stopping) return;
    setStopping(true);
    setAutoStopIn(null);
    await recorder.stop();
    onStopped(recorder.meetingId);
    void processOutbox();
  };

  // En línea: detener solo cuando termina la llamada, con 15 s para arrepentirse (ADR-0012).
  useEffect(() => {
    if (recorder.mode !== "online") return;
    const id = setInterval(async () => {
      if (autoStopIn !== null || stopping) return;
      const apps = await activeCallApps();
      const now = recorder.elapsedMs();
      if (detector.current.update(now, apps, recorder.lastOtherSoundMs, recorder.shareEnded)) setAutoStopIn(15);
    }, 3000);
    return () => clearInterval(id);
  }, [recorder, autoStopIn, stopping]);

  useEffect(() => {
    if (autoStopIn === null) return;
    if (autoStopIn <= 0) {
      void stopNow();
      return;
    }
    const t = setTimeout(() => setAutoStopIn((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [autoStopIn]);

  useEffect(() => {
    const l: LiveListener = {
      segment: (s) => setSegments((prev) => [...prev, s].sort((a, b) => a.startMs - b.startMs)),
      levels: setLevels,
      bridge: (status, pending) => setBridge({ status, pending }),
      lag: (q) => setLag(q),
      warning: (w) => setWarnings((p) => [...p.slice(-2), w]),
    };
    listeners.add(l);
    const id = setInterval(() => setElapsed(recorder.elapsedMs()), 500);
    return () => {
      listeners.delete(l);
      clearInterval(id);
    };
  }, [recorder]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [segments.length]);

  const mode = recorder.mode;
  return (
    <section class="rec-card live">
      <div class="row spread">
        <span class="rec">{paused ? "⏸ En pausa" : "● Grabando"}</span>
        <span class="rec-timer">{formatTimestamp(elapsed)}</span>
      </div>
      <Level label="Yo" value={levels[0]} />
      {mode === "online" && <Level label="Otros" value={levels[1]} />}
      <p class="muted" aria-live="polite">
        {bridge.status === "ready" && (bridge.pending > 0 ? `Transcribiendo… (${bridge.pending} en cola)` : "Whisper al día")}
        {bridge.status === "connecting" && "Conectando con Whisper…"}
        {bridge.status === "offline" && `Puente apagado: el audio se guarda y se transcribirá después (${bridge.pending} pendientes).`}
        {bridge.status === "unauthorized" && "El puente no está emparejado: el audio se guarda y se transcribirá al emparejar."}
        {lag !== null && lag > 15 && ` · Whisper va ${Math.round(lag)} s atrás`}
      </p>
      {elapsed > 5000 && !recorder.heardAudio && (
        <p class="warn-text" role="alert">
          No está llegando audio del micrófono. Revisa el permiso del navegador o elige otro micrófono.
        </p>
      )}
      {warnings.map((w) => (
        <p class="warn-text">{w}</p>
      ))}
      {autoStopIn !== null && !stopping && (
        <p class="warn-text" role="alert">
          La junta terminó. Guardando la nota en {autoStopIn} s…{" "}
          <button
            class="link"
            onClick={() => {
              detector.current.reset(recorder.elapsedMs());
              setAutoStopIn(null);
            }}
          >
            Seguir grabando
          </button>
        </p>
      )}
      <div class="transcript" ref={listRef} aria-live="polite">
        {segments.length === 0 && <p class="muted">La transcripción aparecerá aquí frase por frase.</p>}
        {segments.map((s) => (
          <p>
            <span class="ts">{formatTimestamp(s.startMs)}</span> <strong>{speakerLabel(s, mode)}:</strong> {s.text}
          </p>
        ))}
      </div>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) recorder.addNote(note.trim());
          setNote("");
        }}
      >
        <input placeholder="Nota rápida (Enter)" value={note} onInput={(e) => setNote(e.currentTarget.value)} maxLength={1000} aria-label="Nota rápida" />
        <label class="check">
          <input
            type="checkbox"
            checked={important}
            onChange={(e) => {
              setImportant(e.currentTarget.checked);
              recorder.setImportant(e.currentTarget.checked);
            }}
          />
          Importante
        </label>
      </form>
      <div class="row">
        <button
          onClick={async () => {
            if (paused) await recorder.resume();
            else await recorder.pause();
            setPaused(!paused);
          }}
        >
          {paused ? "Reanudar" : "Pausar"}
        </button>
        <button
          class="stop"
          disabled={stopping}
          onClick={() => void stopNow()}
        >
          {stopping ? "Terminando de transcribir…" : "■ Detener y guardar nota"}
        </button>
      </div>
    </section>
  );
}

const STEP_LABEL: Record<string, string> = {
  queued: "En cola",
  processing: "Procesando",
  saved: "Guardada",
  partially_saved: "Guardada sin resumen",
  failed: "Falló",
  recording: "Interrumpida",
  finalizing: "Finalizando",
};

function Review({ meetingId, onDone, onOpenNote }: { meetingId: string; onDone: () => void; onOpenNote: (id: string) => void }) {
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null);
  const [progress, setProgress] = useState<string>("En cola…");

  const reload = () => void getMeeting(meetingId).then((m) => m && setMeeting(m));
  useEffect(() => {
    reload();
    const id = setInterval(reload, 1500);
    return () => clearInterval(id);
  }, [meetingId]);

  const onEvent = (e: NoteEvent) => {
    if (e.event === "summarizing") setProgress("Claude está resumiendo…");
    if (e.event === "saving") setProgress("Guardando la nota…");
  };
  useEffect(() => {
    void (async () => {
      // Si quedó audio sin transcribir (puente apagado), se transcribe antes de enviar.
      if ((await getPendingAudio(meetingId)).length > 0) {
        setProgress("Transcribiendo audio pendiente con Whisper…");
        await transcribePending(meetingId, (n) => setProgress(`Transcribiendo audio pendiente… (${n} en cola)`));
      }
      await processOutbox((id, e) => id === meetingId && onEvent(e));
      reload();
    })();
  }, [meetingId]);

  if (!meeting) return <section class="rec-card">Cargando…</section>;
  const r = meeting.result;
  return (
    <section class="rec-card">
      <h2 class="h3">{r?.title ?? "Procesando la junta"}</h2>
      <p class="muted">
        {STEP_LABEL[meeting.state] ?? meeting.state}
        {(meeting.state === "queued" || meeting.state === "processing") && ` · ${progress}`}
      </p>
      {meeting.error && meeting.state !== "saved" && (
        <p class="error" role="alert">
          {meeting.error.detail}
        </p>
      )}
      {r && (
        <>
          <p>
            Etiqueta: <strong>{r.tag || "—"}</strong>
            {r.tagConfidence < 0.6 && <span class="pill warn"> ¿correcta?</span>}
            {r.actionItems.length > 0 && ` · ${r.actionItems.length} acuerdos listos para pasar a tareas`}
          </p>
          <div class="row">
            <button class="btn primary" onClick={() => onOpenNote(r.noteId)}>
              Abrir la nota →
            </button>
          </div>
        </>
      )}
      <div class="row">
        {meeting.state === "failed" && meeting.error?.type !== "empty_transcript" && (
          <button class="btn" onClick={() => void retryMeeting(meetingId).then(reload)}>
            Reintentar
          </button>
        )}
        <button class="btn" onClick={async () => downloadText(`junta-${meeting.startedAt.slice(0, 10)}.md`, meetingToMarkdown(meeting, await getSegments(meetingId)))}>
          Descargar Markdown
        </button>
        <button class="btn" onClick={onDone}>
          Listo
        </button>
      </div>
    </section>
  );
}

function History({ items, onOpen, onChange }: { items: MeetingRecord[]; onOpen: (id: string) => void; onChange: () => void }) {
  if (items.length === 0) return null;
  return (
    <section class="rec-card">
      <h2 class="h3">Grabaciones recientes en este navegador</h2>
      <ul class="history">
        {items.map((m) => (
          <li>
            <button class="link" onClick={() => onOpen(m.id)}>
              {m.result?.title ?? new Date(m.startedAt).toLocaleString("es-MX")}
            </button>
            <span class={`pill ${m.state === "saved" ? "ok" : m.state === "failed" ? "bad" : "warn"}`}>{STEP_LABEL[m.state] ?? m.state}</span>
            {m.result && <span class="muted">{m.result.tag}</span>}
          </li>
        ))}
      </ul>
      <button
        class="link danger"
        onClick={async () => {
          if (confirm("¿Borrar el historial y el audio pendiente de este navegador? Las notas guardadas en Tracky no se tocan.")) {
            await deleteEverything();
            onChange();
          }
        }}
      >
        Borrar datos locales
      </button>
    </section>
  );
}
