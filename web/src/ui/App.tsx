// Armazón de Tracky: sesión, encabezado (monedas y racha), captura siempre arriba, pestañas,
// buscador Ctrl+K y Pregúntale a Tracky.
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "preact/hooks";
import { loadAll, state } from "../data/store.js";
import { configured, onSession, sendMagicLink } from "../supabase.js";
import { Archive } from "./archive/Archive.js";
import { type SearchHit, searchEverything } from "./archive/archive-data.js";
import { AskPanel } from "./ask/Ask.js";
import { Toasts, useStore } from "./common.js";
import { NotesView } from "./notes/Notes.js";
import { isRecording, RecordView } from "./record/Record.js";
import { Settings } from "./settings/Settings.js";
import { Board, WaitingView } from "./tasks/Board.js";
import { Capture } from "./tasks/Capture.js";
import { CloseDay, PeopleView } from "./tasks/People.js";
import { Process } from "./tasks/Process.js";
import { FreeTimeBanner, Wallet } from "./wallet/Wallet.js";

const TABS = [
  ["ahora", "Tablero"],
  ["procesar", "Procesar"],
  ["esperando", "Esperando de…"],
  ["personas", "Personas"],
  ["notas", "Notas"],
  ["grabar", "Grabar"],
  ["archivo", "Archivo"],
  ["monedas", "Monedas"],
  ["cierre", "Cerrar el día"],
  ["ajustes", "Ajustes"],
] as const;
type Tab = (typeof TABS)[number][0];

const SUBTITLE: Record<Tab, string> = {
  ahora: "Máximo 3 en Ahora. Lo demás existe, pero no grita.",
  procesar: "Una cosa a la vez. Tres preguntas y listo.",
  esperando: "Lo que depende de otros, con fecha para volver a preguntar.",
  personas: "Todo lo de cada persona, sin buscar.",
  notas: "Tus reuniones: resumen, acuerdos y transcripción.",
  grabar: "Graba cualquier junta. El audio nunca sale de tu computadora.",
  archivo: "Lo que no es tarea: contactos, datos e ideas.",
  monedas: "Cada tarea terminada suma. Canjéalas por tiempo libre sin culpa.",
  cierre: "Cinco minutos para dejar todo en su lugar.",
  ajustes: "Tu perfil, tus etiquetas y las conexiones.",
};

function readHash(): { tab: Tab; id: string | null } {
  const [tab, id] = window.location.hash.slice(1).split("/");
  return { tab: (TABS.some(([k]) => k === tab) ? tab : "ahora") as Tab, id: id ?? null };
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  useStore();

  useEffect(
    () =>
      onSession((s) => {
        setSession(s);
        if (s && state.userId !== s.user.id) {
          void loadAll(s.user.id, s.user.email ?? null).catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Error al cargar"));
        }
      }),
    [],
  );

  if (!configured) {
    return (
      <Gate title="Falta configurar">
        <p>Esta copia de Tracky no tiene Supabase configurado. Abre Claude Code en la app de escritorio y escribe "configura Tracky".</p>
      </Gate>
    );
  }
  if (session === undefined) return <Gate title="Tracky">Cargando…</Gate>;
  if (!session) return <Login />;
  if (loadError)
    return (
      <Gate title="Ups">
        <p class="lk-err">No pude cargar tus datos ({loadError}).</p>
        <button class="btn primary" onClick={() => location.reload()}>
          Reintentar
        </button>
      </Gate>
    );
  if (!state.ready) return <Gate title="Tracky">Cargando tus cosas…</Gate>;
  return <Shell />;
}

function Gate({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div class="lock">
      <div class="lock-card">
        <h2>
          <span class="lk-mark">{title}</span>
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>{children}</div>
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Gate title="Tracky">
      <p class="muted">Tu función ejecutiva externa: reuniones, tareas y monedas por tiempo libre.</p>
      {sent ? (
        <p>
          Te mandé un enlace a <strong>{email}</strong>. Ábrelo en este mismo navegador para entrar.
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            const r = await sendMagicLink(email);
            if (r) setErr(r);
            else setSent(true);
          }}
        >
          <label class="ql" for="email">
            Tu correo
          </label>
          <input id="email" class="field" type="email" required autoComplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
          <button class="btn primary big">Enviarme un enlace para entrar</button>
          {err && <p class="lk-err">{err}</p>}
        </form>
      )}
      <p class="lk-note">Sin contraseñas. Solo los correos autorizados en tu instancia pueden entrar.</p>
    </Gate>
  );
}

function Shell() {
  useStore();
  const [{ tab, id }, setRoute] = useState(readHash());
  const [ask, setAsk] = useState(false);
  const [cmdk, setCmdk] = useState(false);
  const go = (t: Tab, i: string | null = null) => {
    window.location.hash = i ? `${t}/${i}` : t;
  };

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdk(true);
      }
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const openRef = (kind: string, ref: string) => {
    if (kind === "note" || kind === "meeting" || kind === "memo") go("notas", ref);
    else if (kind === "contact") go("archivo");
    else go("ahora");
  };

  const w = state.wallet;
  const inbox = state.tasks.filter((t) => t.status === "inbox" && !t.parent_id).length;
  const waitingDue = state.tasks.filter((t) => t.status === "waiting" && t.follow_up && t.follow_up <= new Date().toISOString().slice(0, 10)).length;
  const rawDate = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);

  return (
    <div class="wrap">
      <header class="top">
        <div class="brand">
          <h1>
            <span>Tracky</span>
          </h1>
          <span class="today">{dateLabel}</span>
        </div>
        <div class="top-actions">
          {isRecording() && tab !== "grabar" && (
            <button class="pill bad" style={{ border: 0, cursor: "pointer" }} onClick={() => go("grabar")}>
              ● Grabando
            </button>
          )}
          <span class="streak" title="Racha">
            🔥 {w?.streak ?? 0}
          </span>
          <span class="lvl">Nivel {w?.level.level ?? 1}</span>
          <button class="coins" onClick={() => go("monedas")} aria-label={`${w?.balance ?? 0} monedas`}>
            <span class="coin" aria-hidden="true" />
            {w?.balance ?? 0}
          </button>
        </div>
      </header>

      <Capture onProcess={() => go("procesar")} />

      <nav class="tabs-scroll" aria-label="Secciones">
        <div class="tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button class="tab" role="tab" aria-selected={tab === k} onClick={() => go(k)}>
              {label}
              {k === "procesar" && inbox > 0 && <span class="badge">{inbox}</span>}
              {k === "esperando" && waitingDue > 0 && <span class="badge alert">{waitingDue}</span>}
            </button>
          ))}
        </div>
      </nav>

      {state.error && (
        <div class="banner follow" role="alert">
          <p>{state.error}</p>
          <button class="btn small" onClick={() => ((state.error = null), setRoute(readHash()))}>
            Ok
          </button>
        </div>
      )}

      <main>
        <section>
          <h2 class="h2">{TABS.find(([k]) => k === tab)![1]}</h2>
          <p class="sub">{SUBTITLE[tab]}</p>
        </section>
        {tab !== "monedas" && <FreeTimeBanner />}
        {tab === "ahora" && <Board onProcess={() => go("procesar")} />}
        {tab === "procesar" && <Process onDone={() => go("ahora")} />}
        {tab === "esperando" && <WaitingView />}
        {tab === "personas" && <PeopleView onOpenNote={(n) => go("notas", n)} />}
        {tab === "notas" && <NotesView openId={id} onOpen={(n) => go("notas", n)} />}
        {tab === "grabar" && <RecordView onOpenNote={(n) => go("notas", n)} />}
        {tab === "archivo" && <Archive />}
        {tab === "monedas" && <Wallet />}
        {tab === "cierre" && <CloseDay />}
        {tab === "ajustes" && <Settings />}
      </main>

      {!ask && (
        <button class="ask-fab" onClick={() => setAsk(true)}>
          💬 <span class="ask-label">Pregúntale a Tracky</span>
        </button>
      )}
      {ask && <AskPanel onClose={() => setAsk(false)} onOpen={openRef} />}
      {cmdk && <CommandK onClose={() => setCmdk(false)} onOpen={(k, i) => (openRef(k, i), setCmdk(false))} />}
      <Toasts />
    </div>
  );
}

function CommandK({ onClose, onOpen }: { onClose: () => void; onOpen: (kind: string, id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const id = setTimeout(() => void searchEverything(q).then(setHits), 250);
    return () => clearTimeout(id);
  }, [q]);
  const label = { meeting: "Reunión", memo: "Nota", task: "Tarea", contact: "Contacto" } as const;
  return (
    <div class="cmdk" role="dialog" aria-modal="true" aria-label="Buscar" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="box">
        <input class="field" autoFocus placeholder="Buscar tareas, notas, reuniones y contactos…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        <div class="list" style={{ boxShadow: "none" }}>
          {q && hits.length === 0 && <p class="empty-msg">Sin resultados.</p>}
          {hits.map((h) => (
            <button class="li" style={{ border: 0, background: "none", textAlign: "left", cursor: "pointer", width: "100%" }} onClick={() => onOpen(h.kind, h.id)}>
              <span class="tag">{label[h.kind]}</span>
              <div class="txt">
                <div class="t">{h.title}</div>
                {h.snippet && <div class="s">{h.snippet.slice(0, 140)}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
