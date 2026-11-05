// Monedas (spec 003): saldo, racha, nivel, canjes por tiempo libre e historial con desglose.
import { useEffect, useState } from "preact/hooks";
import { redeem, type Reward, saveProfile, saveReward, state } from "../../data/store.js";
import { supabase } from "../../supabase.js";
import { celebrate } from "../celebrate.js";
import { toast, useStore } from "../common.js";
import { explain } from "../finish.js";

interface LedgerRow {
  id: string;
  amount: number;
  kind: string;
  breakdown: Record<string, unknown>;
  created_at: string;
  task: { text: string } | null;
}

export function FreeTimeBanner() {
  useStore();
  const [, tick] = useState(0);
  const active = state.profile?.settings.activeRedemption;
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!active) return null;
  const left = new Date(active.ends_at).getTime() - Date.now();
  const clear = () => void saveProfile({ settings: { ...state.profile!.settings, activeRedemption: undefined } });
  if (left <= 0) {
    return (
      <div class="free-timer">
        <span>Terminó tu tiempo libre ({active.name}). ¿Listo para la siguiente? 💪</span>
        <button class="btn small" style={{ color: "#fff", borderColor: "#fff" }} onClick={clear}>
          Ok
        </button>
      </div>
    );
  }
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <div class="free-timer" role="timer">
      <span>🌿 Tiempo libre: disfrútalo, te lo ganaste.</span>
      <b>
        {m}:{String(s).padStart(2, "0")}
      </b>
      <button class="btn small" style={{ color: "#fff", borderColor: "#fff" }} onClick={clear}>
        Terminar antes
      </button>
    </div>
  );
}

export function Wallet() {
  useStore();
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [editing, setEditing] = useState<Partial<Reward> | null>(null);
  const w = state.wallet;
  const load = () =>
    void supabase
      .from("coin_ledger")
      .select("id,amount,kind,breakdown,created_at,task:tasks(text)")
      .order("created_at", { ascending: false })
      .limit(40)
      .then(({ data }) => setLedger((data ?? []) as unknown as LedgerRow[]));
  useEffect(load, [state.wallet?.balance]);

  const lvl = w?.level;
  const pct = lvl ? Math.round(((w.lifetime - lvl.floor) / Math.max(1, lvl.next - lvl.floor)) * 100) : 0;

  return (
    <>
      <FreeTimeBanner />
      <div class="wallet-hero">
        <div class="insight">
          <span class="big">{w?.balance ?? 0} 🪙</span>
          saldo para canjear
        </div>
        <div class="insight">
          <span class="big">{w?.streak ?? 0} 🔥</span>
          {w?.streak ? "días seguidos (un día de gracia por semana)" : "¡Empieza tu racha hoy!"}
        </div>
        <div class="insight">
          <span class="big">Nivel {lvl?.level ?? 1}</span>
          {lvl ? `${w!.lifetime} de ${lvl.next} para el siguiente (${pct} %)` : ""}
        </div>
        <div class="insight">
          <span class="big">+{w?.earned_today ?? 0}</span>
          ganadas hoy (tope {w?.daily_cap ?? 300})
        </div>
      </div>

      <section>
        <div class="section-head">
          <h3 class="marker sm">Canjear por tiempo libre</h3>
          <button class="btn small hi" onClick={() => setEditing({ name: "", emoji: "🎁", cost: 50, minutes: null })}>
            + Recompensa propia
          </button>
        </div>
        {editing && (
          <form
            class="box"
            onSubmit={async (e) => {
              e.preventDefault();
              await saveReward({ ...editing, name: editing.name ?? "", cost: editing.cost ?? 50 } as Reward);
              setEditing(null);
            }}
          >
            <div class="grid2">
              <div>
                <label class="ql">Qué es</label>
                <input class="field" required maxLength={80} placeholder="Ej. Ver un episodio" value={editing.name ?? ""} onInput={(e) => setEditing({ ...editing, name: e.currentTarget.value })} />
              </div>
              <div>
                <label class="ql">Emoji</label>
                <input class="field" maxLength={4} value={editing.emoji ?? "🎁"} onInput={(e) => setEditing({ ...editing, emoji: e.currentTarget.value })} />
              </div>
              <div>
                <label class="ql">Costo (mín. 10)</label>
                <input class="field" type="number" min={10} required value={editing.cost ?? 50} onInput={(e) => setEditing({ ...editing, cost: Number(e.currentTarget.value) })} />
              </div>
              <div>
                <label class="ql">Minutos (opcional, inicia temporizador)</label>
                <input class="field" type="number" min={1} max={1440} value={editing.minutes ?? ""} onInput={(e) => setEditing({ ...editing, minutes: e.currentTarget.value ? Number(e.currentTarget.value) : null })} />
              </div>
            </div>
            <div class="row">
              <button type="button" class="btn" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button class="btn primary">Guardar</button>
              {editing.id && (
                <button type="button" class="btn ghost" onClick={() => void saveReward({ ...(editing as Reward), active: false }).then(() => setEditing(null))}>
                  Ocultar
                </button>
              )}
            </div>
          </form>
        )}
        <div class="rewards">
          {state.rewards
            .filter((r) => r.active)
            .map((r) => {
              const can = (w?.balance ?? 0) >= r.cost;
              return (
                <article class="reward">
                  <span class="em">{r.emoji}</span>
                  <strong>{r.name}</strong>
                  <span class="cost">{r.cost} 🪙</span>
                  <div class="row">
                    <button
                      class="btn primary small"
                      disabled={!can}
                      title={can ? "" : `Te faltan ${r.cost - (w?.balance ?? 0)} 🪙`}
                      onClick={async (e) => {
                        const el = e.currentTarget;
                        const res = await redeem(r);
                        if (typeof res === "string") return toast(res);
                        celebrate("big", el);
                        if (res.ends_at) await saveProfile({ settings: { ...state.profile!.settings, activeRedemption: { name: r.name, ends_at: res.ends_at } } });
                        toast(`¡Canjeado! ${r.emoji} Disfrútalo sin culpa.`);
                      }}
                    >
                      Canjear
                    </button>
                    {!can && <span class="small muted">faltan {r.cost - (w?.balance ?? 0)}</span>}
                    <button class="btn tiny ghost" onClick={() => setEditing(r)} aria-label="Editar">
                      ✎
                    </button>
                  </div>
                </article>
              );
            })}
        </div>
      </section>

      <section class="box">
        <h3 class="h3">Cómo se ganan monedas</h3>
        <ul class="small" style={{ margin: 0, paddingLeft: "18px" }}>
          <li>Por tamaño: XS 5 · S 10 · M 20 · L 40. Los pasos de una tarea valen 2.</li>
          <li>🐸 Sapo del día (la que más te cuesta): vale doble, una vez al día.</li>
          <li>☀️ Arranque: +5 por la primera tarea del día.</li>
          <li>🔥 Racha: +10 % por día seguido, hasta +50 %. Tienes un día de gracia por semana.</li>
          <li>🎁 Cofre sorpresa: de vez en cuando, +5 a +15.</li>
          <li>Si capturas y terminas algo en menos de 2 min, vale como XS. Tope diario: {w?.daily_cap ?? 300}.</li>
          <li>Nunca pierdes monedas por no hacer algo. Deshacer (24 h) regresa exactamente lo ganado.</li>
        </ul>
      </section>

      <section>
        <h3 class="marker sm">Historial</h3>
        <div class="list ledger">
          {ledger.length === 0 && <p class="empty-msg">Aquí verás cada moneda que ganes y canjees.</p>}
          {ledger.map((l) => (
            <div class="li">
              <span class={`amt ${l.amount >= 0 ? "pos" : "neg"}`}>
                {l.amount >= 0 ? "+" : ""}
                {l.amount}
              </span>
              <div class="txt">
                <div class="t">
                  {l.kind === "redeem" ? `Canje: ${String(l.breakdown.name ?? "")}` : l.kind === "undo" ? "Deshecho" : (l.task?.text ?? "Tarea")}
                </div>
                <div class="s">
                  {(l.kind === "task" || l.kind === "step") && <span>{explain({ coins: l.amount, breakdown: l.breakdown, wallet: w! } as never)}</span>}
                  <span>{new Date(l.created_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
