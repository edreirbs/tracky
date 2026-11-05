// Ajustes: perfil, etiquetas (FR-010 / FR-409), sonido, estado del puente y de Claude.
import { useEffect, useState } from "preact/hooks";
import { health } from "../../api/client.js";
import { bridgeHealth } from "../../bridge/client.js";
import { deleteTag, saveProfile, saveTag, state, type Tag } from "../../data/store.js";
import { setVocabulary } from "../../session/vocabulary.js";
import { supabase } from "../../supabase.js";
import { toast, useStore } from "../common.js";

export function Settings() {
  useStore();
  const p = state.profile;
  const [name, setName] = useState(p?.display_name ?? "");
  const [tz, setTz] = useState(p?.timezone ?? "America/Mexico_City");
  const [vocab, setVocab] = useState((p?.settings.vocabulary ?? []).join(", "));
  const [claude, setClaude] = useState<string>("…");
  const [bridge, setBridge] = useState<string>("…");
  const [editing, setEditing] = useState<Partial<Tag> | null>(null);

  useEffect(() => {
    void health(true).then((h) => setClaude(!h ? "sin conexión" : h.claude === "ok" ? "✅ conectado" : h.claude === "missing" ? "⚠️ falta la llave en Netlify" : "⚠️ la llave no es válida"));
    void bridgeHealth().then((b) => setBridge(b ? `✅ ${b.engine} · ${b.model.split("/").pop()}` : "⚠️ apagado"));
  }, []);

  return (
    <div class="cards2">
      <section class="box">
        <h3 class="h3">Tu perfil</h3>
        <label class="ql">Tu nombre (así te nombra el resumen cuando hablas tú)</label>
        <input class="field" value={name} maxLength={80} onInput={(e) => setName(e.currentTarget.value)} />
        <label class="ql">Zona horaria</label>
        <input class="field" value={tz} onInput={(e) => setTz(e.currentTarget.value)} />
        <label class="ql">Vocabulario para Whisper (nombres propios, siglas; separados por coma)</label>
        <input class="field" value={vocab} onInput={(e) => setVocab(e.currentTarget.value)} />
        <label class="toggle">
          <input type="checkbox" checked={Boolean(p?.settings.sound)} onChange={(e) => void saveProfile({ settings: { ...p!.settings, sound: e.currentTarget.checked } })} /> Sonido al terminar
          tareas
        </label>
        <div class="row">
          <button
            class="btn primary"
            onClick={async () => {
              const words = vocab.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 20);
              await saveProfile({ display_name: name.trim() || null, timezone: tz.trim() || "America/Mexico_City", settings: { ...p!.settings, vocabulary: words } });
              setVocabulary([...state.tags.map((t) => t.name), ...words]);
              toast("Perfil guardado.");
            }}
          >
            Guardar perfil
          </button>
        </div>
        <p class="small muted">Sesión: {state.email}</p>
        <button class="btn small" onClick={() => void supabase.auth.signOut()}>
          Cerrar sesión
        </button>
      </section>

      <section class="box">
        <h3 class="h3">Etiquetas de tus notas</h3>
        <p class="small muted">Claude elige una de estas para cada reunión, guiándose por la descripción. Nunca crea etiquetas solo.</p>
        <div class="list" style={{ boxShadow: "none", border: "1px solid var(--paper-line)" }}>
          {state.tags.length === 0 && <p class="empty-msg">Sin etiquetas. Agrega al menos dos y una de respaldo ("Otros").</p>}
          {state.tags.map((t) => (
            <div class="li">
              <div class="txt">
                <div class="t">
                  {t.name} {t.is_fallback && <span class="tag">respaldo</span>}
                </div>
                <div class="s">{t.description || "(sin descripción)"}</div>
              </div>
              <button class="btn tiny" onClick={() => setEditing(t)}>
                Editar
              </button>
            </div>
          ))}
        </div>
        {editing ? (
          <form
            class="wait-box"
            onSubmit={async (e) => {
              e.preventDefault();
              await saveTag({ ...editing, name: (editing.name ?? "").trim(), signals: editing.signals ?? [] });
              setVocabulary([...state.tags.map((t) => t.name), ...(p?.settings.vocabulary ?? [])]);
              setEditing(null);
            }}
          >
            <label class="ql">Nombre</label>
            <input class="field" required maxLength={60} value={editing.name ?? ""} onInput={(e) => setEditing({ ...editing, name: e.currentTarget.value })} />
            <label class="ql">Descripción (cuándo usarla)</label>
            <textarea class="field" maxLength={600} value={editing.description ?? ""} onInput={(e) => setEditing({ ...editing, description: e.currentTarget.value })} />
            <label class="ql">Señales (palabras clave, coma)</label>
            <input class="field" value={(editing.signals ?? []).join(", ")} onInput={(e) => setEditing({ ...editing, signals: e.currentTarget.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <label class="toggle">
              <input type="checkbox" checked={Boolean(editing.is_fallback)} onChange={(e) => setEditing({ ...editing, is_fallback: e.currentTarget.checked })} /> Es la de respaldo (cuando nada encaja)
            </label>
            <div class="row">
              <button class="btn primary small">Guardar</button>
              <button type="button" class="btn small" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              {editing.id && (
                <button type="button" class="btn small danger" onClick={() => confirm("¿Borrar la etiqueta? Las notas quedan sin etiqueta.") && void deleteTag(editing.id!).then(() => setEditing(null))}>
                  Borrar
                </button>
              )}
            </div>
          </form>
        ) : (
          <button class="btn small hi" onClick={() => setEditing({ name: "", description: "", signals: [], sort: state.tags.length + 1 })}>
            + Etiqueta
          </button>
        )}
      </section>

      <section class="box">
        <h3 class="h3">Conexiones</h3>
        <p>
          Claude: <strong>{claude}</strong>
        </p>
        <p>
          Whisper en tu computadora: <strong>{bridge}</strong>
        </p>
        <p class="small muted">
          ¿Algo no funciona? Abre Claude Code en la app de escritorio, en la carpeta de Tracky, y escribe <code>/tracky-doctor</code>: lo diagnostica y lo arregla.
        </p>
      </section>
    </div>
  );
}
