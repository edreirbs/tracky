// Cargador de tareas (spec 002 § 3): capturar es más fácil que olvidar.
// Enter guarda al instante en la Bandeja; Claude sugiere después (chips que no bloquean).
import { BASE_COINS, type TaskSuggestion } from "@tracky/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { parseTask } from "../../api/client.js";
import { createTask, ensurePerson, state, type Task, timeZone, today, updateTask } from "../../data/store.js";
import { fmtDate, toast } from "../common.js";

interface Applied {
  task: Task;
  suggestion: TaskSuggestion | null;
  loading: boolean;
  /** Campos que se aplicaron (para poder quitarlos con un clic). */
  on: Record<string, boolean>;
  before: Partial<Task>;
}

const MENTION = /(^|\s)@([\p{L}][\p{L}.-]*)/u;

export function Capture({ onProcess }: { onProcess: () => void }) {
  const [text, setText] = useState("");
  const [last, setLast] = useState<Applied | null>(null);
  const [multi, setMulti] = useState<string[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Atajo global: N o / enfocan la captura desde cualquier pestaña (salvo al escribir en otro campo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "n" || e.key === "N" || e.key === "/")) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function save(raw: string) {
    let clean = raw.trim();
    if (!clean) return;
    let personId: string | null = null;
    const m = MENTION.exec(clean);
    if (m) {
      personId = (await ensurePerson(m[2]!))?.id ?? null;
      clean = clean.replace(MENTION, "$1").replace(/\s+/g, " ").trim() || clean;
    }
    const task = await createTask({ text: clean.slice(0, 500), person_id: personId });
    const applied: Applied = { task, suggestion: null, loading: true, on: {}, before: {} };
    setLast(applied);
    try {
      const s = await parseTask({ text: clean, today: today(), timeZone: timeZone(), people: state.people.map((p) => p.name) });
      await applySuggestion(applied, s);
    } catch {
      setLast((l) => (l?.task.id === task.id ? { ...l, loading: false } : l));
    }
  }

  async function applySuggestion(a: Applied, s: TaskSuggestion) {
    const current = state.tasks.find((t) => t.id === a.task.id);
    // Solo se aplica si la persona no tocó la tarea mientras tanto.
    if (!current || current.status !== "inbox") return;
    const patch: Partial<Task> = {};
    const on: Record<string, boolean> = {};
    const before: Partial<Task> = {};
    const set = <K extends keyof Task>(chip: string | null, field: K, value: Task[K]) => {
      before[field] = current[field];
      patch[field] = value;
      if (chip) on[chip] = true;
    };
    if (s.action && s.action !== current.text) set("action", "action", s.action);
    if (s.person && !current.person_id) {
      const p = await ensurePerson(s.person);
      if (p) set("person", "person_id", p.id);
    }
    if (s.due && !current.due) set("due", "due", s.due);
    if (s.size !== current.size) set("size", "size", s.size);
    if (s.estimate_min) set(null, "estimate_min", s.estimate_min);
    if (s.energy) set(null, "energy", s.energy);
    if (s.blocking && !current.blocking) set("blocking", "blocking", true);
    if (Object.keys(patch).length) await updateTask(current.id, patch);
    setLast((l) => (l?.task.id === a.task.id ? { ...l, suggestion: s, loading: false, on, before } : l));
  }

  async function toggle(key: string, field: keyof Task, value: unknown) {
    if (!last) return;
    const isOn = last.on[key];
    await updateTask(last.task.id, { [field]: isOn ? (last.before[field] ?? null) : value } as Partial<Task>);
    setLast({ ...last, on: { ...last.on, [key]: !isOn } });
  }

  async function addSteps() {
    if (!last?.suggestion?.steps.length) return;
    for (const [i, s] of last.suggestion.steps.entries()) await createTask({ text: s, parent_id: last.task.id, sort: i, status: "next" });
    setLast({ ...last, on: { ...last.on, steps: true } });
    toast(`Se agregaron ${last.suggestion.steps.length} pasos (2 🪙 cada uno).`);
  }

  const s = last?.suggestion;
  const inboxCount = state.tasks.filter((t) => t.status === "inbox" && !t.parent_id).length;
  return (
    <div class="capture-wrap">
      <form
        class="capture"
        onSubmit={(e) => {
          e.preventDefault();
          const v = text;
          setText("");
          void save(v);
        }}
      >
        <label class="sr-only" for="capture">
          ¿Qué tienes en mente?
        </label>
        <input
          id="capture"
          ref={input}
          value={text}
          maxLength={500}
          autoComplete="off"
          placeholder="¿Qué tienes en mente?  (Enter guarda · @persona)"
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
          onPaste={(e) => {
            const lines = (e.clipboardData?.getData("text") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            if (lines.length > 1) {
              e.preventDefault();
              setMulti(lines.slice(0, 50));
            }
          }}
        />
        <span class="coins-est" aria-hidden="true">
          ~{BASE_COINS[s?.size ?? "S"]}🪙
        </span>
        <button class="btn primary small" disabled={!text.trim()}>
          Guardar
        </button>
      </form>
      <div class="capture-hint">
        {multi ? (
          <>
            <span>Pegaste {multi.length} líneas.</span>
            <button
              class="btn tiny"
              onClick={() => {
                multi.forEach((l) => void createTask({ text: l.slice(0, 500) }));
                toast(`${multi.length} tareas en la Bandeja.`);
                setMulti(null);
              }}
            >
              Crear una tarea por línea
            </button>
            <button class="btn tiny ghost" onClick={() => (setText(multi.join(" ")), setMulti(null))}>
              Pegar como una sola
            </button>
          </>
        ) : last ? (
          <div class="sugg" aria-live="polite">
            <span class="lbl">
              Guardada en Bandeja{last.loading ? <span class="thinking"> · sugiriendo</span> : s ? " · sugerencias:" : "."}
            </span>
            {s?.person && (
              <button class={`chip ${last.on.person ? "on" : ""}`} aria-pressed={Boolean(last.on.person)} onClick={() => void toggle("person", "person_id", state.people.find((p) => p.name === s.person)?.id ?? null)}>
                👤 {s.person}
              </button>
            )}
            {s?.due && (
              <button class={`chip ${last.on.due ? "on" : ""}`} aria-pressed={Boolean(last.on.due)} onClick={() => void toggle("due", "due", s.due)}>
                📅 {fmtDate(s.due)}
              </button>
            )}
            {s && (
              <button class={`chip ${last.on.size ? "on" : ""}`} aria-pressed={Boolean(last.on.size)} onClick={() => void toggle("size", "size", s.size)}>
                {s.size}
                {s.estimate_min ? ` · ~${s.estimate_min} min` : ""} · {BASE_COINS[s.size]}🪙
              </button>
            )}
            {s?.blocking && (
              <button class={`chip ${last.on.blocking ? "on" : ""}`} aria-pressed={Boolean(last.on.blocking)} onClick={() => void toggle("blocking", "blocking", true)}>
                ⏰ me esperan
              </button>
            )}
            {s?.action && (
              <button class={`chip ${last.on.action ? "on" : ""}`} aria-pressed={Boolean(last.on.action)} title={s.action} onClick={() => void toggle("action", "action", s.action)}>
                ▶ {s.action.length > 38 ? `${s.action.slice(0, 38)}…` : s.action}
              </button>
            )}
            {s?.two_minute && <span class="lbl">· ¡menos de 2 min! hazla ya</span>}
            {s && s.steps.length > 0 && !last.on.steps && (
              <button class="chip" onClick={() => void addSteps()}>
                + {s.steps.length} pasos
              </button>
            )}
            {inboxCount > 0 && (
              <button class="btn tiny" onClick={onProcess}>
                Procesar Bandeja ({inboxCount})
              </button>
            )}
          </div>
        ) : (
          <>
            <span>
              <kbd>N</kbd> captura desde cualquier lado
            </span>
            <span>
              <kbd>Enter</kbd> guarda
            </span>
            <span>
              <kbd>Ctrl</kbd>+<kbd>K</kbd> busca
            </span>
            {inboxCount > 0 && (
              <button class="btn tiny" style={{ color: "var(--chalk)", borderColor: "var(--chalk-line)" }} onClick={onProcess}>
                Procesar Bandeja ({inboxCount})
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
