import { BASE_COINS } from "@tracky/shared";
import { useState } from "preact/hooks";
import { deleteTask, ensurePerson, state, type Task, updateTask } from "../../data/store.js";

/** Editor de una tarea (hoja de papel sobre la pizarra). */
export function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const [f, setF] = useState({ ...task });
  const [newPerson, setNewPerson] = useState("");
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <div class="cmdk" role="dialog" aria-modal="true" aria-label="Editar tarea" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        class="box"
        onSubmit={async (e) => {
          e.preventDefault();
          let person_id = f.person_id;
          if (newPerson.trim()) person_id = (await ensurePerson(newPerson))?.id ?? person_id;
          const { id: _id, pending: _p, created_at: _c, done_at: _d, status: _s, client_id: _cl, ...patch } = { ...f, person_id };
          await updateTask(task.id, patch);
          onClose();
        }}
      >
        <h3 class="h3">Editar tarea</h3>
        <div class="q">
          <label for="ed-text">Qué es</label>
          <input id="ed-text" class="field" required maxLength={500} value={f.text} onInput={(e) => set("text", e.currentTarget.value)} />
        </div>
        <div class="q">
          <label for="ed-action">Siguiente acción física</label>
          <input id="ed-action" class="field" maxLength={500} placeholder="Ej. Escribirle a Luis para reservar la sala 3" value={f.action ?? ""} onInput={(e) => set("action", e.currentTarget.value || null)} />
        </div>
        <div class="grid2">
          <div>
            <label class="ql" for="ed-person">De quién</label>
            <select id="ed-person" class="field" value={f.person_id ?? ""} onChange={(e) => set("person_id", e.currentTarget.value || null)}>
              <option value="">(nadie)</option>
              {state.people.map((p) => (
                <option value={p.id}>{p.name}</option>
              ))}
            </select>
            <input class="field" placeholder="…o escribe una persona nueva" value={newPerson} onInput={(e) => setNewPerson(e.currentTarget.value)} />
          </div>
          <div>
            <label class="ql" for="ed-due">Para cuándo</label>
            <input id="ed-due" type="date" class="field" value={f.due ?? ""} onInput={(e) => set("due", e.currentTarget.value || null)} />
          </div>
          <div>
            <label class="ql" for="ed-size">Tamaño</label>
            <select id="ed-size" class="field" value={f.size} onChange={(e) => set("size", e.currentTarget.value as Task["size"])}>
              {(["XS", "S", "M", "L"] as const).map((s) => (
                <option value={s}>
                  {s} · {BASE_COINS[s]} 🪙 {s === "XS" ? "(< 5 min)" : s === "S" ? "(5–20 min)" : s === "M" ? "(20–60 min)" : "(> 1 h)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label class="ql" for="ed-est">Estimado (min)</label>
            <input id="ed-est" type="number" min={1} max={1440} class="field" value={f.estimate_min ?? ""} onInput={(e) => set("estimate_min", e.currentTarget.value ? Number(e.currentTarget.value) : null)} />
          </div>
          <div>
            <label class="ql" for="ed-energy">Energía que pide</label>
            <select id="ed-energy" class="field" value={f.energy ?? ""} onChange={(e) => set("energy", (e.currentTarget.value || null) as Task["energy"])}>
              <option value="">(sin definir)</option>
              <option value="low">Poca</option>
              <option value="medium">Media</option>
              <option value="high">Mucha</option>
            </select>
          </div>
          {task.status === "waiting" && (
            <div>
              <label class="ql" for="ed-fu">Volver a preguntar el</label>
              <input id="ed-fu" type="date" class="field" value={f.follow_up ?? ""} onInput={(e) => set("follow_up", e.currentTarget.value || null)} />
            </div>
          )}
        </div>
        <label class="toggle">
          <input type="checkbox" checked={f.blocking} onChange={(e) => set("blocking", e.currentTarget.checked)} /> Alguien me está esperando
        </label>
        <label class="toggle">
          <input type="checkbox" checked={f.is_frog} onChange={(e) => set("is_frog", e.currentTarget.checked)} /> 🐸 Es mi sapo del día (la que más me cuesta: vale doble)
        </label>
        <div class="q">
          <label for="ed-notes">Notas</label>
          <textarea id="ed-notes" class="field" maxLength={5000} value={f.notes ?? ""} onInput={(e) => set("notes", e.currentTarget.value || null)} />
        </div>
        <div class="row spread">
          <button
            type="button"
            class="btn danger small"
            onClick={() => {
              if (confirm("¿Borrar esta tarea? (No se pierden monedas.)")) void deleteTask(task.id).then(onClose);
            }}
          >
            Borrar
          </button>
          <div class="row">
            <button type="button" class="btn" onClick={onClose}>
              Cancelar
            </button>
            <button class="btn primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  );
}
