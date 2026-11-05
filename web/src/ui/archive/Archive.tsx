// Archivo (FR-114): contactos y notas sueltas, con etiquetas libres y buscador.
import { useEffect, useState } from "preact/hooks";
import { state } from "../../data/store.js";
import { PersonTag, toast, useStore } from "../common.js";
import { type Contact, deleteContact, deleteNote, listContacts, listNotes, type NoteRow, saveContact, saveMemo } from "./archive-data.js";

type Kind = "all" | "contact" | "memo";

export function Archive() {
  useStore();
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const [label, setLabel] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [memos, setMemos] = useState<NoteRow[]>([]);
  const [editing, setEditing] = useState<{ kind: "contact"; c: Partial<Contact> } | { kind: "memo"; n: Partial<NoteRow> } | null>(null);
  const reload = () => {
    void listContacts().then(setContacts);
    void listNotes("memo").then(setMemos);
  };
  useEffect(reload, []);

  const term = q.trim().toLowerCase();
  const match = (s: Array<string | null | undefined>) => !term || s.some((x) => x?.toLowerCase().includes(term));
  const labels = [...new Set([...contacts.flatMap((c) => c.labels), ...memos.flatMap((m) => m.labels)])].sort();
  const cs = contacts.filter((c) => kind !== "memo" && match([c.name, c.company, c.email, c.phone, c.body]) && (!label || c.labels.includes(label)));
  const ms = memos.filter((m) => kind !== "contact" && match([m.title, m.body]) && (!label || m.labels.includes(label)));

  return (
    <>
      <div class="searchbar">
        <input class="search-in" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Nombre, empresa, teléfono, texto…" aria-label="Buscar en el Archivo" />
      </div>
      <div class="row spread">
        <div class="chips">
          {(
            [
              ["all", "Todo"],
              ["contact", "Contactos"],
              ["memo", "Notas"],
            ] as const
          ).map(([k, l]) => (
            <button class="chip" style={{ color: "var(--chalk)", borderColor: "var(--chalk-line)" }} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
          {labels.map((l) => (
            <button class="chip" style={{ color: "var(--chalk-dim)", borderColor: "var(--chalk-line)" }} aria-pressed={label === l} onClick={() => setLabel(label === l ? null : l)}>
              #{l}
            </button>
          ))}
        </div>
        <div class="row">
          <button class="btn hi small" onClick={() => setEditing({ kind: "contact", c: { name: "", labels: [] } })}>
            + Contacto
          </button>
          <button class="btn hi small" onClick={() => setEditing({ kind: "memo", n: { title: "", body: "", labels: [] } })}>
            + Nota
          </button>
        </div>
      </div>

      {editing?.kind === "contact" && <ContactForm c={editing.c} onClose={() => (setEditing(null), reload())} />}
      {editing?.kind === "memo" && <MemoForm n={editing.n} onClose={() => (setEditing(null), reload())} />}

      <div class="fichas">
        {cs.map((c) => (
          <article class="ficha" style={{ "--pc": c.person_id ? `var(--n${state.people.find((p) => p.id === c.person_id)?.color ?? 0})` : "var(--n3)" }}>
            <div class="ficha-h">
              <span class="kind">Contacto</span>
              {c.pinned && <span aria-label="Fijado">📌</span>}
            </div>
            <div class="ficha-t">{c.name}</div>
            {c.company && <div class="ficha-sub">{c.company}</div>}
            {c.phone && (
              <div class="kv">
                <span class="k">Tel</span>
                <span class="v">{c.phone}</span>
                <button class="btn tiny" onClick={() => void navigator.clipboard.writeText(c.phone ?? "").then(() => toast("Teléfono copiado."))}>
                  Copiar
                </button>
              </div>
            )}
            {c.email && (
              <div class="kv">
                <span class="k">Correo</span>
                <span class="v">{c.email}</span>
                <button class="btn tiny" onClick={() => void navigator.clipboard.writeText(c.email ?? "").then(() => toast("Correo copiado."))}>
                  Copiar
                </button>
              </div>
            )}
            {c.body && <div class="ficha-b">{c.body}</div>}
            <div class="ficha-a">
              <PersonTag id={c.person_id} />
              {c.labels.map((l) => (
                <span class="tag">#{l}</span>
              ))}
              <button class="btn tiny ghost" onClick={() => setEditing({ kind: "contact", c })}>
                Editar
              </button>
            </div>
          </article>
        ))}
        {ms.map((m) => (
          <article class="ficha" style={{ "--pc": "var(--n0)" }}>
            <div class="ficha-h">
              <span class="kind">Nota</span>
              {m.pinned && <span aria-label="Fijada">📌</span>}
            </div>
            <div class="ficha-t">{m.title}</div>
            {m.body && <div class="ficha-b">{m.body.length > 400 ? `${m.body.slice(0, 400)}…` : m.body}</div>}
            <div class="ficha-a">
              {m.labels.map((l) => (
                <span class="tag">#{l}</span>
              ))}
              <span class="small muted">{new Date(m.created_at).toLocaleDateString("es-MX")}</span>
              <button class="btn tiny ghost" onClick={() => setEditing({ kind: "memo", n: m })}>
                Editar
              </button>
            </div>
          </article>
        ))}
      </div>
      {cs.length === 0 && ms.length === 0 && <p class="col-empty">Nada por aquí todavía. Lo que no es tarea (teléfonos, datos, ideas) vive en el Archivo.</p>}
    </>
  );
}

function labelsOf(s: string): string[] {
  return [...new Set(s.split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean))].slice(0, 12);
}

function ContactForm({ c, onClose }: { c: Partial<Contact>; onClose: () => void }) {
  const [f, setF] = useState({ ...c, labelsText: (c.labels ?? []).join(", ") });
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form
      class="box"
      onSubmit={async (e) => {
        e.preventDefault();
        const { labelsText, ...rest } = f;
        const err = await saveContact({ ...rest, name: rest.name ?? "", labels: labelsOf(labelsText) });
        if (err) toast(err);
        else onClose();
      }}
    >
      <h3 class="h3">{c.id ? "Editar contacto" : "Nuevo contacto"}</h3>
      <div class="grid2">
        <div>
          <label class="ql">Nombre</label>
          <input class="field" required value={f.name ?? ""} onInput={(e) => set("name", e.currentTarget.value)} />
        </div>
        <div>
          <label class="ql">Empresa</label>
          <input class="field" value={f.company ?? ""} onInput={(e) => set("company", e.currentTarget.value || null)} />
        </div>
        <div>
          <label class="ql">Teléfono</label>
          <input class="field" value={f.phone ?? ""} onInput={(e) => set("phone", e.currentTarget.value || null)} />
        </div>
        <div>
          <label class="ql">Correo</label>
          <input class="field" type="email" value={f.email ?? ""} onInput={(e) => set("email", e.currentTarget.value || null)} />
        </div>
        <div>
          <label class="ql">De quién es (persona)</label>
          <select class="field" value={f.person_id ?? ""} onChange={(e) => set("person_id", e.currentTarget.value || null)}>
            <option value="">(nadie)</option>
            {state.people.map((p) => (
              <option value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label class="ql">Etiquetas (separadas por coma)</label>
          <input class="field" value={f.labelsText} onInput={(e) => set("labelsText", e.currentTarget.value)} />
        </div>
      </div>
      <label class="ql">Notas</label>
      <textarea class="field note-area" value={f.body ?? ""} onInput={(e) => set("body", e.currentTarget.value || null)} />
      <label class="toggle">
        <input type="checkbox" checked={Boolean(f.pinned)} onChange={(e) => set("pinned", e.currentTarget.checked)} /> Fijar arriba
      </label>
      <div class="row spread">
        {c.id ? (
          <button type="button" class="btn danger small" onClick={() => confirm("¿Borrar el contacto?") && void deleteContact(c.id!).then(onClose)}>
            Borrar
          </button>
        ) : (
          <span />
        )}
        <div class="row">
          <button type="button" class="btn" onClick={onClose}>
            Cancelar
          </button>
          <button class="btn primary">Guardar</button>
        </div>
      </div>
    </form>
  );
}

function MemoForm({ n, onClose }: { n: Partial<NoteRow>; onClose: () => void }) {
  const [title, setTitle] = useState(n.title ?? "");
  const [body, setBody] = useState(n.body ?? "");
  const [labels, setLabels] = useState((n.labels ?? []).join(", "));
  const [tagId, setTagId] = useState(n.tag_id ?? "");
  const [pinned, setPinned] = useState(Boolean(n.pinned));
  return (
    <form
      class="box"
      onSubmit={async (e) => {
        e.preventDefault();
        const err = await saveMemo({ ...(n.id ? { id: n.id } : {}), title: title.trim() || "Nota", body, labels: labelsOf(labels), tag_id: tagId || null, pinned });
        if (err) toast(err);
        else onClose();
      }}
    >
      <h3 class="h3">{n.id ? "Editar nota" : "Nueva nota"}</h3>
      <input class="field" required maxLength={200} placeholder="Título" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
      <textarea class="field note-area" placeholder="Escribe aquí…" value={body} onInput={(e) => setBody(e.currentTarget.value)} />
      <div class="grid2">
        <div>
          <label class="ql">Etiquetas libres (coma)</label>
          <input class="field" value={labels} onInput={(e) => setLabels(e.currentTarget.value)} />
        </div>
        <div>
          <label class="ql">Tema (catálogo)</label>
          <select class="field" value={tagId} onChange={(e) => setTagId(e.currentTarget.value)}>
            <option value="">(sin tema)</option>
            {state.tags.map((t) => (
              <option value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>
      <label class="toggle">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.currentTarget.checked)} /> Fijar arriba
      </label>
      <div class="row spread">
        {n.id ? (
          <button type="button" class="btn danger small" onClick={() => confirm("¿Borrar la nota?") && void deleteNote(n.id!).then(onClose)}>
            Borrar
          </button>
        ) : (
          <span />
        )}
        <div class="row">
          <button type="button" class="btn" onClick={onClose}>
            Cancelar
          </button>
          <button class="btn primary">Guardar</button>
        </div>
      </div>
    </form>
  );
}
