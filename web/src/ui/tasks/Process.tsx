// Procesar (spec 002 FR-105): una tarjeta a la vez, tres preguntas (GTD: aclarar + regla de 2 min).
import { addDays, BASE_COINS, MAX_NOW, nowIsFull } from "@tracky/shared";
import { useEffect, useState } from "preact/hooks";
import { createTask, deleteTask, ensurePerson, state, type Task, today, updateTask } from "../../data/store.js";
import { createContactFromTask, createMemoFromTask } from "../archive/archive-data.js";
import { DueTag, PersonTag, toast, useStore } from "../common.js";
import { finishTask } from "../finish.js";

export function Process({ onDone }: { onDone: () => void }) {
  useStore();
  const inbox = state.tasks.filter((t) => t.status === "inbox" && !t.parent_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const t = inbox[0];
  const total = inbox.length;
  if (!t) {
    return (
      <section class="proc">
        <h2 class="h3">Bandeja vacía ✨</h2>
        <p>Todo lo que capturaste ya tiene lugar. Tu cabeza puede descansar.</p>
        <div class="row">
          <button class="btn primary" onClick={onDone}>
            Ir al Tablero
          </button>
        </div>
      </section>
    );
  }
  return <Card key={t.id} t={t} left={total} />;
}

function Card({ t, left }: { t: Task; left: number }) {
  const [action, setAction] = useState(t.action ?? "");
  const [personName, setPersonName] = useState(state.people.find((p) => p.id === t.person_id)?.name ?? "");
  const [due, setDue] = useState(t.due ?? "");
  const [size, setSize] = useState(t.size);
  const [twoMin, setTwoMin] = useState<number | null>(null);
  const [waitMode, setWaitMode] = useState(false);
  const [waitingOn, setWaitingOn] = useState("");
  const [followUp, setFollowUp] = useState(addDays(today(), 2));
  const d = today();

  // Las sugerencias de Claude pueden llegar después: se reflejan si la persona no ha escrito.
  useEffect(() => {
    if (!action && t.action) setAction(t.action);
    if (!personName && t.person_id) setPersonName(state.people.find((p) => p.id === t.person_id)?.name ?? "");
    if (!due && t.due) setDue(t.due);
    setSize(t.size);
  }, [t.action, t.person_id, t.due, t.size]);

  useEffect(() => {
    if (twoMin === null) return;
    const id = setInterval(() => setTwoMin((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(id);
  }, [twoMin !== null]);

  async function commit(status: Task["status"], extra: Partial<Task> = {}) {
    const person = personName.trim() ? await ensurePerson(personName) : null;
    await updateTask(t.id, {
      action: action.trim() || null,
      person_id: person?.id ?? null,
      due: due || null,
      size,
      status,
      sort: Date.now(),
      ...extra,
    });
  }

  return (
    <section class="proc" aria-live="polite">
      <div class="row spread">
        <span class="progress" style={{ color: "var(--paper-muted)" }}>
          Quedan {left} en la Bandeja
        </span>
        <span class="coin-tag">vale {BASE_COINS[size]} 🪙</span>
      </div>
      <div>
        <div class="proc-text">{t.text}</div>
        <div class="row" style={{ marginTop: "8px" }}>
          <PersonTag id={t.person_id} />
          <DueTag due={t.due} />
        </div>
      </div>

      <div class="q">
        <label for="p-action">1. ¿Cuál es la siguiente acción física?</label>
        <span class="help">Algo que puedas ver hacer: "Escribirle a Luis para reservar la sala 3", no "lo de la sala".</span>
        <input id="p-action" class="field" value={action} maxLength={500} placeholder={t.text} onInput={(e) => setAction(e.currentTarget.value)} />
      </div>

      <div class="q">
        <span class="ql">2. ¿Toma menos de 2 minutos?</span>
        {twoMin === null ? (
          <div class="row">
            <button class="btn hi" onClick={() => setTwoMin(120)}>
              ⚡ Sí: hazla ya
            </button>
            <span class="help">Si sí, hazla ahora y táchala. Si no, sigue a la pregunta 3.</span>
          </div>
        ) : (
          <div class="wait-box">
            <div class="timer-txt">
              <b>
                {Math.floor(twoMin / 60)}:{String(twoMin % 60).padStart(2, "0")}
              </b>
              <span>{twoMin === 0 ? "Se acabó el tiempo. Está bien: termínala o ponla en Siguientes." : "Hazla ahora…"}</span>
            </div>
            <div class="row">
              <button
                class="btn good"
                onClick={async (e) => {
                  const el = e.currentTarget;
                  await commit("next", { size: "XS", estimate_min: 2 });
                  await finishTask({ ...t, size: "XS" }, el);
                }}
              >
                ✓ Hecha
              </button>
              <button class="btn small ghost" onClick={() => setTwoMin(null)}>
                Mejor no
              </button>
            </div>
          </div>
        )}
      </div>

      <div class="q">
        <span class="ql">3. ¿De quién es y para cuándo?</span>
        <div class="grid2">
          <div>
            <label class="help" for="p-person">
              Persona (opcional)
            </label>
            <input id="p-person" class="field" list="people-list" value={personName} onInput={(e) => setPersonName(e.currentTarget.value)} placeholder="Ej. Laura" />
            <datalist id="people-list">
              {state.people.map((p) => (
                <option value={p.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label class="help" for="p-due">
              Fecha (opcional)
            </label>
            <input id="p-due" type="date" class="field" value={due} onInput={(e) => setDue(e.currentTarget.value)} />
            <div class="chips">
              <button class="chip" type="button" onClick={() => setDue(d)}>
                Hoy
              </button>
              <button class="chip" type="button" onClick={() => setDue(addDays(d, 1))}>
                Mañana
              </button>
              <button class="chip" type="button" onClick={() => setDue("")}>
                Sin fecha
              </button>
            </div>
          </div>
          <div>
            <span class="help">Tamaño</span>
            <div class="chips">
              {(["XS", "S", "M", "L"] as const).map((s) => (
                <button class="chip" type="button" aria-pressed={size === s} onClick={() => setSize(s)}>
                  {s} · {BASE_COINS[s]}🪙
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {waitMode && (
        <div class="wait-box">
          <label class="ql" for="p-won">
            ¿A quién le toca? (esperando de…)
          </label>
          <input id="p-won" class="field" value={waitingOn} onInput={(e) => setWaitingOn(e.currentTarget.value)} placeholder="Ej. Jurídico" />
          <label class="ql" for="p-fu">
            ¿Cuándo vuelvo a preguntar?
          </label>
          <input id="p-fu" type="date" class="field" value={followUp} onInput={(e) => setFollowUp(e.currentTarget.value)} />
          <button class="btn primary" onClick={() => void commit("waiting", { waiting_on: waitingOn.trim() || personName.trim() || null, follow_up: followUp || null })}>
            Guardar en Esperando
          </button>
        </div>
      )}

      <div class="divider" />
      <div class="row">
        <button
          class="btn primary"
          onClick={() => {
            if (nowIsFull(state.tasks.filter((x) => !x.parent_id))) {
              toast(`Ahora ya tiene ${MAX_NOW}: la dejé en Siguientes.`);
              void commit("next");
            } else void commit("now");
          }}
        >
          → Ahora
        </button>
        <button class="btn" onClick={() => void commit("next")}>
          Siguientes
        </button>
        <button class="btn" onClick={() => setWaitMode(true)}>
          Esperando de…
        </button>
        <button
          class="btn ghost"
          title="No es tarea: guárdalo como nota en el Archivo"
          onClick={async () => {
            await createMemoFromTask(t);
            await deleteTask(t.id);
            toast("Guardado en Archivo como nota.");
          }}
        >
          Es una nota
        </button>
        <button
          class="btn ghost"
          title="No es tarea: guárdalo como contacto en el Archivo"
          onClick={async () => {
            await createContactFromTask(t);
            await deleteTask(t.id);
            toast("Guardado en Archivo como contacto.");
          }}
        >
          Es un contacto
        </button>
        <button
          class="btn ghost danger"
          onClick={() => {
            void deleteTask(t.id);
            toast("Borrada. Una cosa menos en la cabeza.", { label: "Deshacer", run: () => void createTask({ text: t.text }) });
          }}
        >
          Borrar
        </button>
      </div>
    </section>
  );
}
