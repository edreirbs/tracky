// Tablero (spec 002 US-3): Ahora (máx. 3 post-its) · Siguientes · Esperando · Hecho hoy.
import { addDays, localDate, MAX_NOW, sortNext, sortWaiting, VISIBLE_PER_COLUMN } from "@tracky/shared";
import { useEffect, useState } from "preact/hooks";
import { createTask, state, type Task, timeZone, today, updateTask } from "../../data/store.js";
import { getSetting, setSetting } from "../../storage/db.js";
import { fmtDate, noteColor, PersonTag, TaskMeta, toast, useStore } from "../common.js";
import { finishTask } from "../finish.js";
import { TaskEditor } from "./Editor.js";

// ---------------------------------------------------------------------------------------------
// Temporizador visual (FR-107): una tarea a la vez; si se pasa, "está bien".
// ---------------------------------------------------------------------------------------------
interface Timer {
  id: string;
  est: number;
  startedAt: number;
}
let timer: Timer | null = null;
const timerListeners = new Set<() => void>();
void getSetting<Timer>("timer").then((t) => {
  timer = t ?? null;
  timerListeners.forEach((l) => l());
});
function setTimer(t: Timer | null) {
  timer = t;
  void setSetting("timer", t);
  timerListeners.forEach((l) => l());
}
export function stopTimerFor(taskId: string): number | null {
  if (timer?.id !== taskId) return null;
  const mins = Math.max(1, Math.round((Date.now() - timer.startedAt) / 60_000));
  setTimer(null);
  return mins;
}

function TimerBar({ t }: { t: Task }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((x) => x + 1);
    timerListeners.add(l);
    const id = setInterval(l, 1000);
    return () => {
      timerListeners.delete(l);
      clearInterval(id);
    };
  }, []);
  if (timer?.id !== t.id) {
    const est = t.estimate_min ?? (t.size === "XS" ? 5 : t.size === "S" ? 15 : t.size === "M" ? 40 : 90);
    return (
      <div class="row">
        <span class="est-label">Estimado: {est} min</span>
        <button class="btn tiny" onClick={() => setTimer({ id: t.id, est, startedAt: Date.now() })}>
          ▶ Empezar
        </button>
      </div>
    );
  }
  const elapsed = (Date.now() - timer.startedAt) / 60_000;
  const over = elapsed > timer.est;
  const pct = Math.min(100, (elapsed / timer.est) * 100);
  return (
    <div class="timer" aria-live="off">
      <div class={`bar ${over ? "over" : ""}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <div class="timer-txt">
        <b>
          {Math.floor(elapsed)}:{String(Math.floor((elapsed % 1) * 60)).padStart(2, "0")}
        </b>
        <span>{over ? "Te pasaste del estimado. Está bien: sigue o haz una pausa." : `de ${timer.est} min`}</span>
        <button class="btn tiny ghost" onClick={() => setTimer(null)}>
          Detener
        </button>
      </div>
    </div>
  );
}

async function finishWithTimer(t: Task, el: Element | null) {
  const actual = stopTimerFor(t.id);
  if (actual !== null) await updateTask(t.id, { actual_min: actual, estimate_min: t.estimate_min ?? timer?.est ?? null });
  await finishTask(t, el);
}

// ---------------------------------------------------------------------------------------------
// Post-its
// ---------------------------------------------------------------------------------------------
function Steps({ t }: { t: Task }) {
  const steps = state.tasks.filter((s) => s.parent_id === t.id).sort((a, b) => a.sort - b.sort);
  const [adding, setAdding] = useState("");
  return (
    <div class="steps-mini">
      {steps.map((s) => (
        <label class="toggle small">
          <input
            type="checkbox"
            checked={s.status === "done"}
            disabled={s.status === "done"}
            onChange={(e) => void finishTask(s, e.currentTarget)}
          />
          <span style={s.status === "done" ? { textDecoration: "line-through", opacity: 0.6 } : {}}>{s.text}</span>
        </label>
      ))}
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (adding.trim()) void createTask({ text: adding.trim(), parent_id: t.id, status: "next", sort: steps.length });
          setAdding("");
        }}
      >
        <input class="field" style={{ padding: "5px 8px", fontSize: ".82rem" }} placeholder="+ paso" value={adding} onInput={(e) => setAdding(e.currentTarget.value)} />
      </form>
    </div>
  );
}

function Slot({ t, n, onEdit }: { t: Task; n: number; onEdit: (t: Task) => void }) {
  const [showSteps, setShowSteps] = useState(state.tasks.some((s) => s.parent_id === t.id));
  return (
    <article class={`slot ${timer?.id === t.id ? "running" : ""}`} style={{ "--note": noteColor(t) }}>
      <span class="num">
        AHORA · {n}/{MAX_NOW}
      </span>
      <div class="act">{t.action || t.text}</div>
      {t.action && t.action !== t.text && <div class="orig">{t.text}</div>}
      <div class="meta">
        <TaskMeta t={t} />
      </div>
      {showSteps ? <Steps t={t} /> : null}
      <div class="slot-foot">
        <TimerBar t={t} />
        <div class="row">
          <button class="btn good" onClick={(e) => void finishWithTimer(t, e.currentTarget)}>
            ✓ Terminar
          </button>
          <button class="btn small" onClick={() => void updateTask(t.id, { status: "next" })} title="Regresar a Siguientes">
            Bajar
          </button>
          {!showSteps && (
            <button class="btn small ghost" onClick={() => setShowSteps(true)}>
              Pasos
            </button>
          )}
          <button class="btn small ghost" onClick={() => onEdit(t)} aria-label="Editar">
            ✎
          </button>
        </div>
      </div>
    </article>
  );
}

function Mini({ t, onEdit, onNow }: { t: Task; onEdit: (t: Task) => void; onNow?: (t: Task) => void }) {
  return (
    <article class="mini" style={{ "--note": noteColor(t) }}>
      <div class="mini-t">{t.action || t.text}</div>
      <div class="mini-s">
        <TaskMeta t={t} />
        {t.status === "waiting" && t.follow_up && <span class="tag">preguntar {fmtDate(t.follow_up)}</span>}
      </div>
      <div class="mini-a">
        {onNow && (
          <button class="btn tiny" onClick={() => onNow(t)}>
            → Ahora
          </button>
        )}
        <button class="btn tiny good" onClick={(e) => void finishTask(t, e.currentTarget)} aria-label="Terminar">
          ✓
        </button>
        <button class="btn tiny ghost" onClick={() => onEdit(t)} aria-label="Editar">
          ✎
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// Tablero
// ---------------------------------------------------------------------------------------------
export function Board({ onProcess }: { onProcess: () => void }) {
  useStore();
  const [editing, setEditing] = useState<Task | null>(null);
  const [choosing, setChoosing] = useState<Task | null>(null);
  const [allNext, setAllNext] = useState(false);
  const [allWait, setAllWait] = useState(false);
  const [lowEnergy, setLowEnergy] = useState(false);
  const d = today();
  const top = state.tasks.filter((t) => !t.parent_id);
  const now = top.filter((t) => t.status === "now").sort((a, b) => a.sort - b.sort);
  let next = sortNext(top.filter((t) => t.status === "next"), d);
  if (lowEnergy) next = next.filter((t) => (t.size === "XS" || t.size === "S") && t.energy !== "high");
  const waiting = sortWaiting(top.filter((t) => t.status === "waiting"), d);
  const done = top.filter((t) => t.status === "done" && t.done_at && localDate(new Date(t.done_at), timeZone()) === d);
  const inbox = top.filter((t) => t.status === "inbox");
  const followUps = waiting.filter((t) => t.follow_up && t.follow_up <= d);
  const earlier = top.filter((t) => t.due && t.due < d && ["now", "next", "inbox"].includes(t.status));

  const toNow = (t: Task) => {
    if (now.length >= MAX_NOW) setChoosing(t);
    else void updateTask(t.id, { status: "now", sort: Date.now() });
  };

  return (
    <>
      <div class="banners">
        {inbox.length > 0 && (
          <div class="banner ex">
            <p>
              Tienes <strong>{inbox.length}</strong> {inbox.length === 1 ? "cosa" : "cosas"} en la Bandeja sin decidir.
            </p>
            <button class="btn small primary" onClick={onProcess}>
              Procesar una a la vez
            </button>
          </div>
        )}
        {followUps.map((t) => (
          <div class="banner follow">
            <p>
              ¿Ya te respondió{t.waiting_on ? ` ${t.waiting_on}` : ""}? <strong>{t.text}</strong>
            </p>
            <div class="row">
              <button class="btn small good" onClick={(e) => void finishTask(t, e.currentTarget)}>
                Sí, ya quedó
              </button>
              <button class="btn small" onClick={() => void updateTask(t.id, { follow_up: addDays(d, 2) })}>
                Recordar en 2 días
              </button>
            </div>
          </div>
        ))}
        {earlier.length > 0 && (
          <div class="banner">
            <p>
              {earlier.length === 1 ? "Una tarea era" : `${earlier.length} tareas eran`} para antes. ¿La{earlier.length === 1 ? "" : "s"} movemos?
            </p>
            <div class="row">
              <button class="btn small" onClick={() => earlier.forEach((t) => void updateTask(t.id, { due: d }))}>
                A hoy
              </button>
              <button class="btn small" onClick={() => earlier.forEach((t) => void updateTask(t.id, { due: addDays(d, 1) }))}>
                A mañana
              </button>
              <button class="btn small ghost" onClick={() => earlier.forEach((t) => void updateTask(t.id, { due: null }))}>
                Algún día
              </button>
            </div>
          </div>
        )}
      </div>

      {choosing && (
        <div class="banner ex" role="alert">
          <p>
            Ahora ya tiene {MAX_NOW} (es el máximo para poder arrancar). ¿Cuál baja a Siguientes para hacerle lugar a "<strong>{choosing.text}</strong>"?
          </p>
          <div class="row">
            {now.map((t) => (
              <button
                class="btn small"
                onClick={() => {
                  void updateTask(t.id, { status: "next" });
                  void updateTask(choosing.id, { status: "now", sort: Date.now() });
                  setChoosing(null);
                }}
              >
                {(t.action || t.text).slice(0, 30)}
              </button>
            ))}
            <button class="btn small ghost" onClick={() => setChoosing(null)}>
              Mejor no
            </button>
          </div>
        </div>
      )}

      <div class="board">
        <div class="col">
          <div class="col-h">
            <h2 class="marker">Ahora</h2>
            <span class="col-c">
              {now.length} de {MAX_NOW}
            </span>
          </div>
          <div class="slots">
            {now.map((t, i) => (
              <Slot t={t} n={i + 1} onEdit={setEditing} />
            ))}
            {Array.from({ length: MAX_NOW - now.length }, (_, i) => (
              <div class="slot empty">
                <span class="num">
                  AHORA · {now.length + i + 1}/{MAX_NOW}
                </span>
                <p class="muted">{i === 0 ? (next.length ? "Elige algo de Siguientes con → Ahora." : "Captura algo arriba o procesa la Bandeja.") : "Espacio libre (está bien así)."}</p>
              </div>
            ))}
          </div>

          <section class="done-strip">
            <div class="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 class="marker sm">Hecho hoy</h3>
              <span class="win-count">{done.length}</span>
            </div>
            <div class="wins">
              {done.length === 0 && <p class="col-empty">Lo que termines hoy aparecerá aquí. Cada tarea cuenta.</p>}
              {done.map((t) => (
                <span class="win" title={t.text}>
                  {t.action || t.text}
                </span>
              ))}
            </div>
          </section>
        </div>

        <div class="col col-side">
          <section>
            <div class="col-h">
              <h3 class="marker sm">Siguientes</h3>
              <span class="col-c">{next.length}</span>
            </div>
            <div class="chips board-chips">
              <button class="chip" style={{ color: "var(--chalk)", borderColor: "var(--chalk-line)" }} aria-pressed={lowEnergy} onClick={() => setLowEnergy(!lowEnergy)}>
                🔋 Tengo poca energía
              </button>
            </div>
            {next.length === 0 ? (
              <p class="col-empty">{lowEnergy ? "No hay tareas ligeras ahora. ¡Descansar también cuenta!" : "Nada en Siguientes."}</p>
            ) : (
              <div class="minis">
                {(allNext ? next : next.slice(0, VISIBLE_PER_COLUMN)).map((t) => (
                  <Mini t={t} onEdit={setEditing} onNow={toNow} />
                ))}
              </div>
            )}
            {next.length > VISIBLE_PER_COLUMN && (
              <button class="more" onClick={() => setAllNext(!allNext)}>
                {allNext ? "Ver menos" : `Ver todos (${next.length})`}
              </button>
            )}
          </section>
          <section>
            <div class="col-h">
              <h3 class="marker sm">Esperando de…</h3>
              <span class="col-c">{waiting.length}</span>
            </div>
            {waiting.length === 0 ? (
              <p class="col-empty">Nadie te debe nada por ahora.</p>
            ) : (
              <div class="minis">
                {(allWait ? waiting : waiting.slice(0, VISIBLE_PER_COLUMN)).map((t) => (
                  <Mini t={t} onEdit={setEditing} />
                ))}
              </div>
            )}
            {waiting.length > VISIBLE_PER_COLUMN && (
              <button class="more" onClick={() => setAllWait(!allWait)}>
                {allWait ? "Ver menos" : `Ver todos (${waiting.length})`}
              </button>
            )}
          </section>
        </div>
      </div>
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Lista simple de Esperando, por persona (vista propia). */
export function WaitingView() {
  useStore();
  const [editing, setEditing] = useState<Task | null>(null);
  const d = today();
  const waiting = sortWaiting(state.tasks.filter((t) => t.status === "waiting" && !t.parent_id), d);
  return (
    <>
      <div class="list">
        {waiting.length === 0 && <p class="empty-msg">Nada en espera. Cuando delegues algo, mándalo aquí con fecha para volver a preguntar.</p>}
        {waiting.map((t) => (
          <div class="li">
            <div class="txt">
              <div class="t">{t.text}</div>
              <div class="s">
                <PersonTag id={t.person_id} />
                {t.waiting_on && <span>esperando a {t.waiting_on}</span>}
                {t.follow_up && <span class={t.follow_up <= d ? "tag due-today" : "tag"}>preguntar {fmtDate(t.follow_up)}</span>}
              </div>
            </div>
            <button class="btn small good" onClick={(e) => void finishTask(t, e.currentTarget)}>
              Ya quedó
            </button>
            <button class="btn small" onClick={() => void updateTask(t.id, { follow_up: addDays(d, 2) })}>
              +2 días
            </button>
            <button class="btn small ghost" onClick={() => void updateTask(t.id, { status: "next" })}>
              Lo hago yo
            </button>
            <button class="btn small ghost" onClick={() => setEditing(t)} aria-label="Editar">
              ✎
            </button>
          </div>
        ))}
      </div>
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export function toastMoved(status: string) {
  toast(status === "now" ? "A Ahora." : status === "next" ? "A Siguientes." : status === "waiting" ? "A Esperando." : "Guardado.");
}
