// Pregúntale a Tracky (spec 004): chat en lenguaje natural sobre tareas, notas y monedas.
import type { AskResponse, AskTurn, ProposedTask } from "@tracky/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { askTracky } from "../../api/client.js";
import { createTask, state, timeZone, today, updateTask } from "../../data/store.js";
import { supabase } from "../../supabase.js";
import { Markdown, toast } from "../common.js";

interface Msg {
  role: "user" | "assistant";
  text: string;
  proposals?: ProposedTask[];
  accepted?: boolean;
}

const QUICK = ["¿Qué hago ahora? Tengo 20 minutos.", "¿Qué quedó pendiente de mis reuniones de esta semana?", "¿Cómo va mi semana?", "¿Qué le debo a cada persona?"];

export function AskPanel({ onClose, onOpen }: { onClose: () => void; onOpen: (kind: string, id: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => log.current?.scrollTo({ top: log.current.scrollHeight }), [msgs.length, busy]);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const history: AskTurn[] = msgs.slice(-10).map((m) => ({ role: m.role, text: m.text.slice(0, 8000) }));
    const next = [...msgs, { role: "user" as const, text }];
    setMsgs(next);
    setQ("");
    setBusy(true);
    try {
      const r: AskResponse = await askTracky({ question: text, history, today: today(), timeZone: timeZone() });
      const all = [...next, { role: "assistant" as const, text: r.answer, proposals: r.proposals }];
      setMsgs(all);
      // Guardar el hilo (solo texto; RLS).
      const messages = all.map(({ role, text: t }) => ({ role, text: t }));
      if (threadId) await supabase.from("assistant_threads").update({ messages }).eq("id", threadId);
      else {
        const { data } = await supabase.from("assistant_threads").insert({ title: text.slice(0, 120), messages }).select("id").single();
        if (data) setThreadId((data as { id: string }).id);
      }
    } catch (e) {
      setMsgs([...next, { role: "assistant", text: e instanceof Error ? `No pude responder: ${e.message}` : "No pude responder." }]);
    } finally {
      setBusy(false);
    }
  }

  async function accept(i: number) {
    const m = msgs[i];
    if (!m?.proposals) return;
    for (const p of m.proposals) {
      if (p.existing_task_id && state.tasks.some((t) => t.id === p.existing_task_id)) {
        await updateTask(p.existing_task_id, { status: p.status, due: p.due, size: p.size });
      } else {
        await createTask({ text: p.text, due: p.due, size: p.size, status: p.status, source: "assistant" });
      }
    }
    setMsgs(msgs.map((x, j) => (j === i ? { ...x, accepted: true } : x)));
    toast("Listo: tareas guardadas.");
  }

  return (
    <div class="ask-panel" role="dialog" aria-label="Pregúntale a Tracky">
      <div class="ask-head">
        <h2>Pregúntale a Tracky</h2>
        <button class="btn small" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      </div>
      <div class="ask-log" ref={log} aria-live="polite">
        {msgs.length === 0 && (
          <p class="muted small">
            Pregunta lo que sea sobre tus tareas, reuniones, notas o monedas. Tracky busca en tus datos y te cita de dónde sacó cada cosa.
          </p>
        )}
        {msgs.map((m, i) => (
          <div class={`msg ${m.role === "user" ? "user" : "bot"}`}>
            {m.role === "user" ? m.text : <Markdown text={m.text} onLink={(k, id) => (onOpen(k, id), onClose())} />}
            {m.proposals && m.proposals.length > 0 && (
              <div class="proposal">
                <strong class="small">¿Lo hago?</strong>
                {m.proposals.map((p) => (
                  <span class="small">
                    • {p.existing_task_id ? "Mover" : "Crear"}: {p.text}
                    {p.due ? ` (${p.due})` : ""} → {p.status === "now" ? "Ahora" : p.status === "next" ? "Siguientes" : p.status === "waiting" ? "Esperando" : "Bandeja"}
                  </span>
                ))}
                {m.accepted ? (
                  <span class="ok-line small">Hecho ✓</span>
                ) : (
                  <div class="row">
                    <button class="btn tiny primary" onClick={() => void accept(i)}>
                      Sí, hazlo
                    </button>
                    <button class="btn tiny" onClick={() => setMsgs(msgs.map((x, j) => (j === i ? { ...x, proposals: [] } : x)))}>
                      No
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div class="msg bot">
            <span class="thinking">Buscando en tus cosas</span>
          </div>
        )}
      </div>
      {msgs.length === 0 && (
        <div class="ask-quick">
          {QUICK.map((x) => (
            <button class="chip" onClick={() => void send(x)}>
              {x}
            </button>
          ))}
        </div>
      )}
      <form
        class="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(q);
        }}
      >
        <textarea
          ref={input}
          class="field"
          value={q}
          maxLength={2000}
          placeholder="Ej. ¿Qué acordamos con Ana sobre el presupuesto?"
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(q);
            }
          }}
        />
        <button class="btn primary" disabled={busy || !q.trim()}>
          Preguntar
        </button>
      </form>
    </div>
  );
}
