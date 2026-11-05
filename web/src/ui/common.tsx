import { addDays, BASE_COINS } from "@tracky/shared";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getVersion, type Person, state, subscribe, type Task, today } from "../data/store.js";

/** Re-render cuando cambia el estado global. */
export function useStore(): number {
  const [v, setV] = useState(getVersion());
  useEffect(() => subscribe(() => setV(getVersion())), []);
  return v;
}

// ---------------------------------------------------------------------------------------------
// Avisos (toast) y recompensa
// ---------------------------------------------------------------------------------------------
type ToastMsg = { text: string; action?: { label: string; run: () => void }; ms?: number };
type RewardMsg = { amount: number; why: string; party: boolean };
const toastListeners = new Set<(t: ToastMsg | null) => void>();
const rewardListeners = new Set<(r: RewardMsg | null) => void>();

export function toast(text: string, action?: ToastMsg["action"], ms = 3000): void {
  toastListeners.forEach((l) => l({ text, ...(action ? { action } : {}), ms }));
}
export function showReward(r: RewardMsg): void {
  rewardListeners.forEach((l) => l(r));
}

export function Toasts() {
  const [t, setT] = useState<ToastMsg | null>(null);
  const [r, setR] = useState<RewardMsg | null>(null);
  useEffect(() => {
    let tt: ReturnType<typeof setTimeout> | undefined;
    let rt: ReturnType<typeof setTimeout> | undefined;
    const onT = (m: ToastMsg | null) => {
      setT(m);
      clearTimeout(tt);
      if (m) tt = setTimeout(() => setT(null), m.ms ?? 3000);
    };
    const onR = (m: RewardMsg | null) => {
      setR(m);
      clearTimeout(rt);
      if (m) rt = setTimeout(() => setR(null), 2600);
    };
    toastListeners.add(onT);
    rewardListeners.add(onR);
    return () => {
      toastListeners.delete(onT);
      rewardListeners.delete(onR);
    };
  }, []);
  return (
    <>
      <div class={`toast ${t ? "show" : ""}`} role="status" aria-live="polite">
        {t?.text}
        {t?.action && (
          <button
            class="btn tiny undo"
            onClick={() => {
              t.action?.run();
              setT(null);
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
      {r && (
        <div class={`reward-pop ${r.party ? "party" : ""}`} aria-live="assertive">
          <div class="amt">+{r.amount} 🪙</div>
          <div class="why">{r.why}</div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Fechas y etiquetas
// ---------------------------------------------------------------------------------------------
export function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = today();
  if (iso === d) return "hoy";
  if (iso === addDays(d, 1)) return "mañana";
  if (iso === addDays(d, -1)) return "ayer";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function personOf(id: string | null): Person | undefined {
  return id ? state.people.find((p) => p.id === id) : undefined;
}

export function noteColor(t: Pick<Task, "person_id">): string {
  const p = personOf(t.person_id);
  return p ? `var(--n${p.color})` : "var(--n-none)";
}

export function PersonTag({ id }: { id: string | null }) {
  const p = personOf(id);
  if (!p) return null;
  return (
    <span class="tag person">
      <span class="dot" style={{ background: `var(--p${p.color})` }} />
      {p.name}
    </span>
  );
}

/** Nunca "vencida" en rojo (FR-113): se dice "era para…" con tono neutro. */
export function DueTag({ due }: { due: string | null }) {
  if (!due) return null;
  const d = today();
  if (due < d) return <span class="tag">era para {fmtDate(due)}</span>;
  if (due === d) return <span class="tag due-today">hoy</span>;
  return <span class="tag">📅 {fmtDate(due)}</span>;
}

export function TaskMeta({ t }: { t: Task }) {
  return (
    <>
      <PersonTag id={t.person_id} />
      <DueTag due={t.due} />
      {t.blocking && <span class="tag block">me esperan</span>}
      {t.is_frog && <span class="frog">🐸 sapo</span>}
      <span class="coin-tag" title="Monedas base">
        {t.size} · {BASE_COINS[t.size]}🪙
      </span>
      {t.pending && <span class="tag" title="Se guardará al volver la conexión">⏳</span>}
    </>
  );
}

export function Section({ title, sub, children, right }: { title: string; sub?: string; children?: ComponentChildren; right?: ComponentChildren }) {
  return (
    <section>
      <div class="section-head">
        <div>
          <h2 class="h2">{title}</h2>
          {sub && <p class="sub">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Markdown mínimo y seguro (sin innerHTML): encabezados, viñetas, negritas y enlaces de cita. */
export function Markdown({ text, onLink }: { text: string; onLink?: (kind: string, id: string) => void }) {
  const lines = text.split("\n");
  const out: preact.JSX.Element[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul>{list.map((l) => <li>{inline(l, onLink)}</li>)}</ul>);
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]!.replace(/^\[[ xX]\]\s*/, ""));
      continue;
    }
    flush();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) out.push(h[1]!.length <= 2 ? <h2>{inline(h[2]!, onLink)}</h2> : <h3>{inline(h[2]!, onLink)}</h3>);
    else if (line.trim()) out.push(<p>{inline(line, onLink)}</p>);
  }
  flush();
  return <div class="md">{out}</div>;
}

function inline(text: string, onLink?: (kind: string, id: string) => void): Array<string | preact.JSX.Element> {
  const parts: Array<string | preact.JSX.Element> = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(tracky:\/\/(note|task|contact)\/([0-9a-f-]{36})\)|\[([^\]]+)\]\((?:[^)]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong>{m[1]}</strong>);
    else if (m[2])
      parts.push(
        <button class="cite" onClick={() => onLink?.(m[3]!, m[4]!)}>
          {m[2]}
        </button>,
      );
    else if (m[5]) parts.push(m[5]); // enlaces externos: solo el texto
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
