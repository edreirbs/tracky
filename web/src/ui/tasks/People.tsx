// Personas (FR-108) y Cerrar el día (FR-109).
import { estimateFactor, localDate } from "@tracky/shared";
import { useEffect, useState } from "preact/hooks";
import { ensurePerson, state, type Task, timeZone, today, updatePerson, updateTask } from "../../data/store.js";
import { getSetting, setSetting } from "../../storage/db.js";
import { supabase } from "../../supabase.js";
import { DueTag, toast, useStore } from "../common.js";
import { finishTask } from "../finish.js";

const STATUS_LABEL: Record<string, string> = { inbox: "Bandeja", now: "Ahora", next: "Siguientes", waiting: "Esperando" };

export function PeopleView({ onOpenNote }: { onOpenNote: (id: string) => void }) {
  useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState<Array<{ id: string; title: string; created_at: string }>>([]);
  const open = state.tasks.filter((t) => !t.parent_id && t.status !== "done" && t.status !== "archived");
  const person = state.people.find((p) => p.id === sel);

  useEffect(() => {
    if (!person) return setNotes([]);
    void supabase
      .from("notes")
      .select("id,title,created_at")
      .ilike("transcript_text", `%${person.name.replace(/[%_,()]/g, "")}%`)
      .order("created_at", { ascending: false })
      .limit(8)
      .then(({ data }) => setNotes(data ?? []));
  }, [sel]);

  return (
    <>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void ensurePerson(name).then(() => setName(""));
        }}
      >
        <input class="field" style={{ maxWidth: "320px" }} placeholder="Agregar persona (jefe, cliente, equipo…)" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <button class="btn" style={{ color: "var(--chalk)", borderColor: "var(--chalk-line)" }}>
          Agregar
        </button>
      </form>
      <div class="people">
        {state.people.map((p) => {
          const mine = open.filter((t) => t.person_id === p.id);
          return (
            <button class="pcard" style={{ "--pc": `var(--n${p.color})` }} aria-pressed={sel === p.id} onClick={() => setSel(sel === p.id ? null : p.id)}>
              <span class="pn">
                <span class="dot" style={{ background: `var(--p${p.color})` }} />
                {p.name}
              </span>
              <span class="counts">
                <span>
                  <b>{mine.filter((t) => t.status === "now").length}</b> ahora
                </span>
                <span>
                  <b>{mine.filter((t) => t.status === "next" || t.status === "inbox").length}</b> pendientes
                </span>
                <span>
                  <b>{mine.filter((t) => t.status === "waiting").length}</b> esperando
                </span>
              </span>
            </button>
          );
        })}
        {state.people.length === 0 && <p class="col-empty">Agrega a las personas con quienes trabajas: cada una tiene su color de post-it.</p>}
      </div>
      {person && (
        <section class="box">
          <div class="row spread">
            <h3 class="h3">Todo lo de {person.name}</h3>
            <div class="row">
              <span class="small muted">Color:</span>
              {[0, 1, 2, 3, 4, 5].map((c) => (
                <button class="star" style={{ background: `var(--n${c})`, width: "26px", height: "26px" }} aria-pressed={person.color === c} aria-label={`Color ${c + 1}`} onClick={() => void updatePerson(person.id, { color: c })} />
              ))}
            </div>
          </div>
          <div class="list" style={{ boxShadow: "none", border: "1px solid var(--paper-line)" }}>
            {open.filter((t) => t.person_id === person.id).length === 0 && <p class="empty-msg">Nada pendiente con {person.name}.</p>}
            {open
              .filter((t) => t.person_id === person.id)
              .map((t) => (
                <div class="li">
                  <div class="txt">
                    <div class="t">{t.action || t.text}</div>
                    <div class="s">
                      <span class="tag">{STATUS_LABEL[t.status]}</span>
                      <DueTag due={t.due} />
                    </div>
                  </div>
                  <button class="btn small good" onClick={(e) => void finishTask(t, e.currentTarget)}>
                    ✓
                  </button>
                </div>
              ))}
          </div>
          {notes.length > 0 && (
            <>
              <h4 class="h3" style={{ fontSize: ".95rem" }}>
                Reuniones donde se mencionó
              </h4>
              <div class="chips">
                {notes.map((n) => (
                  <button class="chip" onClick={() => onOpenNote(n.id)}>
                    {n.title}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}

export function CloseDay() {
  useStore();
  const [closedOn, setClosedOn] = useState<string | null>(null);
  const d = today();
  useEffect(() => void getSetting<string>("closed-on").then((x) => setClosedOn(x ?? null)), []);
  const top = state.tasks.filter((t) => !t.parent_id);
  const done = top.filter((t) => t.status === "done" && t.done_at && localDate(new Date(t.done_at), timeZone()) === d);
  const open = top.filter((t) => ["now", "next", "inbox"].includes(t.status));
  const stars = top.filter((t) => t.tomorrow && t.status !== "done");
  const factor = estimateFactor(top.filter((t) => t.status === "done"));
  const earned = state.wallet?.earned_today ?? 0;

  const toggleStar = (t: Task) => {
    if (!t.tomorrow && stars.length >= 3) return toast("Máximo 3 estrellas: lo demás puede esperar.");
    void updateTask(t.id, { tomorrow: !t.tomorrow });
  };

  return (
    <div class="steps">
      <div class="step">
        <div class="step-h">
          <span class="step-n">1</span>
          <h3 class="h3">Mira lo que lograste</h3>
        </div>
        <div class="wallet-hero">
          <div class="insight">
            <span class="big">{done.length}</span> tareas terminadas hoy
          </div>
          <div class="insight">
            <span class="big">+{earned} 🪙</span> ganadas hoy · racha {state.wallet?.streak ?? 0} 🔥
          </div>
          {factor !== null && (
            <div class="insight">
              <span class="big">{factor}×</span> {factor > 1 ? `tardas ${factor} veces lo que calculas: súmale ese margen a tus estimados.` : "calculas bien tus tiempos."}
            </div>
          )}
        </div>
        <div class="wins">
          {done.map((t) => (
            <span class="win">{t.action || t.text}</span>
          ))}
        </div>
      </div>
      <div class="step">
        <div class="step-h">
          <span class="step-n">2</span>
          <h3 class="h3">Elige hasta 3 estrellas para mañana</h3>
        </div>
        <p class="muted small">Aparecerán solas en Ahora cuando abras Tracky mañana.</p>
        <div class="list" style={{ boxShadow: "none", border: "1px solid var(--paper-line)" }}>
          {open.length === 0 && <p class="empty-msg">No hay pendientes abiertos. ¡Qué bien!</p>}
          {open.map((t) => (
            <div class="li">
              <button class="star" aria-pressed={t.tomorrow} aria-label="Estrella para mañana" onClick={() => toggleStar(t)}>
                ★
              </button>
              <div class="txt">
                <div class="t">{t.action || t.text}</div>
                <div class="s">
                  <DueTag due={t.due} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div class="step">
        <div class="step-h">
          <span class="step-n">3</span>
          <h3 class="h3">Cierra el ciclo</h3>
        </div>
        <p class="muted small">Lo que no terminaste no se pierde: sigue en Siguientes. No te lo lleves a casa.</p>
        <div class="row">
          <button
            class="btn primary big"
            onClick={() => {
              void setSetting("closed-on", d).then(() => setClosedOn(d));
              toast("Día cerrado. Hasta mañana. 🌙");
            }}
          >
            Cerrar el día
          </button>
          {closedOn === d && <span class="ok-line">Día cerrado. Hasta mañana.</span>}
        </div>
      </div>
    </div>
  );
}
