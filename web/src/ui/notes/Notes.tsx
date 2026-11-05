// Notas de reunión (spec 001 US-3/US-4/US-5): lista tipo base de datos, detalle y acuerdos → tareas.
import { formatTimestamp, type TemplateId } from "@tracky/shared";
import { useEffect, useState } from "preact/hooks";
import { regenerateNote } from "../../api/client.js";
import { createTask, ensurePerson, state } from "../../data/store.js";
import { downloadText } from "../../export/markdown.js";
import { TEMPLATES } from "../../generated/templates.js";
import { getNote, listNotes, type NoteRow, patchNote, deleteNote, searchEverything } from "../archive/archive-data.js";
import { Markdown, toast, useStore } from "../common.js";

type Full = NonNullable<Awaited<ReturnType<typeof getNote>>>;

export function NotesView({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  useStore();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Set<string> | null>(null);
  const [tag, setTag] = useState("");
  const [onlyImportant, setOnlyImportant] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<"meeting" | "all">("meeting");
  const reload = () => void listNotes(kind, 500).then(setNotes);
  useEffect(reload, [kind]);
  useEffect(() => {
    if (!q.trim()) return setHits(null);
    const id = setTimeout(() => void searchEverything(q).then((r) => setHits(new Set(r.filter((h) => h.kind === "meeting" || h.kind === "memo").map((h) => h.id)))), 300);
    return () => clearTimeout(id);
  }, [q]);

  if (openId) return <NoteDetail id={openId} onBack={() => (onOpen(null), reload())} />;

  const rows = notes.filter(
    (n) =>
      (!hits || hits.has(n.id)) &&
      (!tag || n.tag_id === tag) &&
      (!onlyImportant || n.estado === "Importante") &&
      (!from || n.created_at.slice(0, 10) >= from) &&
      (!to || n.created_at.slice(0, 10) <= to),
  );
  const tagName = (id: string | null) => state.tags.find((t) => t.id === id)?.name ?? "—";

  return (
    <>
      <div class="searchbar">
        <input class="search-in" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Busca en títulos, resúmenes y transcripciones…" aria-label="Buscar notas" />
      </div>
      <div class="row" style={{ color: "var(--chalk)" }}>
        <select class="field" style={{ width: "auto" }} value={tag} onChange={(e) => setTag(e.currentTarget.value)} aria-label="Etiqueta">
          <option value="">Todas las etiquetas</option>
          {state.tags.map((t) => (
            <option value={t.id}>{t.name}</option>
          ))}
        </select>
        <label class="toggle small">
          <input type="checkbox" checked={onlyImportant} onChange={(e) => setOnlyImportant(e.currentTarget.checked)} /> Solo importantes
        </label>
        <label class="small">
          Desde <input type="date" class="field" style={{ width: "auto" }} value={from} onInput={(e) => setFrom(e.currentTarget.value)} />
        </label>
        <label class="small">
          Hasta <input type="date" class="field" style={{ width: "auto" }} value={to} onInput={(e) => setTo(e.currentTarget.value)} />
        </label>
        <label class="toggle small">
          <input type="checkbox" checked={kind === "all"} onChange={(e) => setKind(e.currentTarget.checked ? "all" : "meeting")} /> Incluir notas sueltas
        </label>
      </div>
      <div class="list">
        {rows.length === 0 && <p class="empty-msg">{notes.length ? "Nada coincide con los filtros." : "Aún no hay notas. Graba tu primera reunión en la pestaña Grabar."}</p>}
        {rows.map((n) => (
          <div class="li">
            <div class="txt">
              <button class="link t" style={{ color: "var(--paper-ink)", textDecoration: "none", textAlign: "left" }} onClick={() => onOpen(n.id)}>
                {n.kind === "memo" ? "📝 " : "🎙️ "}
                {n.title}
              </button>
              <div class="s">
                <span class="tag">{tagName(n.tag_id)}</span>
                {n.estado === "Importante" && <span class="tag due-today">Importante</span>}
                {n.status === "summary_failed" && <span class="tag">sin resumen</span>}
                <span>{new Date(n.started_at ?? n.created_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</span>
                {n.duration_s ? <span>{formatTimestamp(n.duration_s * 1000)}</span> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function NoteDetail({ id, onBack }: { id: string; onBack: () => void }) {
  useStore();
  const [n, setN] = useState<Full | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>("general");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const load = () =>
    void getNote(id).then((x) => {
      setN(x);
      if (x) {
        setTemplateId(x.template ?? "general");
        setPicked(new Set(x.action_items.map((_, i) => i)));
      }
    });
  useEffect(load, [id]);
  if (!n) return <p class="sub">Cargando…</p>;

  const update = async (patch: Partial<NoteRow>) => {
    await patchNote(n.id, patch);
    load();
  };

  const toMarkdown = () =>
    [
      `# ${n.title}`,
      "",
      `- Fecha: ${new Date(n.started_at ?? n.created_at).toLocaleString("es-MX")}`,
      `- Etiqueta: ${state.tags.find((t) => t.id === n.tag_id)?.name ?? "—"}`,
      "",
      n.summary_md ?? n.body ?? "",
      "",
      "## Transcripción",
      "",
      ...(n.transcript?.turns ?? []).map((t) => `**[${formatTimestamp(t.startMs)}] ${t.speaker}:** ${t.text}`),
    ].join("\n");

  return (
    <section class="box">
      <div class="row spread">
        <button class="btn small" onClick={onBack}>
          ← Notas
        </button>
        <div class="row">
          <button class="btn small" onClick={() => downloadText(`${n.title.slice(0, 60)}.md`, toMarkdown())}>
            Descargar Markdown
          </button>
          <button
            class="btn small danger"
            onClick={() => {
              if (confirm("¿Borrar esta nota? No se puede deshacer.")) void deleteNote(n.id).then(onBack);
            }}
          >
            Borrar
          </button>
        </div>
      </div>
      <div class="note-head">
        <input class="field" style={{ fontWeight: 800, fontSize: "1.2rem" }} value={n.title} maxLength={200} onChange={(e) => void update({ title: e.currentTarget.value || n.title })} aria-label="Título" />
        <div class="row">
          <select class="field" style={{ width: "auto" }} value={n.tag_id ?? ""} onChange={(e) => void update({ tag_id: e.currentTarget.value || null })} aria-label="Etiqueta">
            <option value="">(sin etiqueta)</option>
            {state.tags.map((t) => (
              <option value={t.id}>{t.name}</option>
            ))}
          </select>
          {(n.tag_confidence ?? 1) < 0.6 && n.kind === "meeting" && <span class="tag due-today">¿etiqueta correcta?</span>}
          {n.tag_alternatives.map((a) => {
            const t = state.tags.find((x) => x.name === a);
            return t ? (
              <button class="chip" onClick={() => void update({ tag_id: t.id })}>
                {a}
              </button>
            ) : null;
          })}
          <label class="toggle">
            <input type="checkbox" checked={n.estado === "Importante"} onChange={(e) => void update({ estado: e.currentTarget.checked ? "Importante" : "Normal" })} /> Importante
          </label>
        </div>
        <span class="small muted">
          {new Date(n.started_at ?? n.created_at).toLocaleString("es-MX", { dateStyle: "full", timeStyle: "short" })}
          {n.duration_s ? ` · ${formatTimestamp(n.duration_s * 1000)}` : ""}
          {n.model ? ` · ${n.model}` : ""}
        </span>
      </div>

      {n.kind === "memo" ? <div class="ficha-b">{n.body}</div> : n.summary_md ? <Markdown text={n.summary_md} /> : <p class="muted">Esta nota no tiene resumen todavía.</p>}

      {n.kind === "meeting" && (
        <div class="row">
          <select class="field" style={{ width: "auto" }} value={templateId} onChange={(e) => setTemplateId(e.currentTarget.value)} aria-label="Plantilla">
            {TEMPLATES.map((t) => (
              <option value={t.id}>{t.nombre}</option>
            ))}
          </select>
          <button
            class="btn small"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("Claude está resumiendo…");
              try {
                await regenerateNote(n.meeting_id ?? "", { templateId: templateId as TemplateId }, (e) => e.event === "saving" && setBusy("Guardando…"));
                load();
              } catch (e) {
                toast(e instanceof Error ? e.message : "No se pudo regenerar.");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy ?? (n.status === "summary_failed" ? "Generar resumen" : "Regenerar resumen")}
          </button>
        </div>
      )}

      {n.action_items.length > 0 && (
        <div class="wait-box">
          <h3 class="h3">Acuerdos → tareas</h3>
          {n.action_items.map((a, i) => (
            <label class="toggle">
              <input
                type="checkbox"
                checked={picked.has(i)}
                onChange={(e) => {
                  const s = new Set(picked);
                  if (e.currentTarget.checked) s.add(i);
                  else s.delete(i);
                  setPicked(s);
                }}
              />
              <span>
                {a.task}
                {a.owner ? ` — ${a.owner}` : ""}
                {a.due ? ` (${a.due})` : ""}
              </span>
            </label>
          ))}
          <div class="row">
            <button
              class="btn primary small"
              disabled={picked.size === 0}
              onClick={async () => {
                const items = n.action_items.filter((_, i) => picked.has(i));
                for (const a of items) {
                  const person = a.owner ? await ensurePerson(a.owner) : null;
                  await createTask({
                    text: a.task.slice(0, 500),
                    due: /^\d{4}-\d{2}-\d{2}/.test(a.due ?? "") ? a.due!.slice(0, 10) : null,
                    person_id: person?.id ?? null,
                    source: "meeting",
                    note_id: n.id,
                  });
                }
                toast(`${items.length} ${items.length === 1 ? "acuerdo pasó" : "acuerdos pasaron"} a la Bandeja.`);
              }}
            >
              Crear {picked.size} {picked.size === 1 ? "tarea" : "tareas"} en la Bandeja
            </button>
          </div>
        </div>
      )}

      {(n.transcript?.turns?.length ?? 0) > 0 && (
        <details class="transcript-box">
          <summary>Transcripción ({n.transcript!.turns!.length} turnos)</summary>
          {n.transcript!.turns!.map((t) => (
            <p class="turn">
              <span class="ts">{formatTimestamp(t.startMs)}</span>
              <strong>{t.speaker}:</strong> {t.text}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
