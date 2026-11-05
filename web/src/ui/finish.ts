// "Terminar tarea" (spec 002 FR-110 + spec 003): celebrar al instante, cobrar en el servidor,
// mostrar el desglose y ofrecer deshacer durante 10 s.
import { completeTask, type CompleteResult, state, type Task, uncompleteTask } from "../data/store.js";
import { celebrate, ding, levelFor } from "./celebrate.js";
import { showReward, toast } from "./common.js";

const CHEERS = ["¡Listo!", "¡Una menos!", "¡Bien hecho!", "¡Eso!", "¡Avanzando!", "¡Así se hace!"];

export function explain(r: CompleteResult): string {
  const b = r.breakdown;
  if (b.already_paid) return "Esta tarea ya se había cobrado.";
  if (b.capped && r.coins === 0) return "Llegaste al tope de hoy: ¡date un descanso, te lo ganaste!";
  if (b.step) return "Paso terminado";
  const parts: string[] = [];
  if (b.base) parts.push(`${b.base} base${b.quick ? " (rápida)" : ""}`);
  if (b.frog) parts.push("×2 sapo 🐸");
  if (b.streak_pct) parts.push(`+${Math.round(b.streak_pct * 100)} % racha 🔥`);
  if (b.start_bonus) parts.push(`+${b.start_bonus} arranque`);
  if (b.chest) parts.push(`+${b.chest} cofre sorpresa 🎁`);
  if (b.capped) parts.push("(tope diario)");
  return parts.join(" · ");
}

export async function finishTask(task: Task, from?: Element | null): Promise<void> {
  const sound = Boolean(state.profile?.settings.sound);
  const level = task.parent_id ? "small" : levelFor(task.size, task.is_frog);
  celebrate(level, from); // < 100 ms (constitución V.3): antes de esperar al servidor
  ding(sound, level === "party");
  const r = await completeTask(task.id);
  if (!r) return;
  if (r.coins > 0 || r.breakdown.capped) {
    showReward({ amount: r.coins, why: explain(r), party: level === "party" || (r.breakdown.chest ?? 0) > 0 });
    document.querySelector(".coins")?.classList.remove("bump");
    requestAnimationFrame(() => document.querySelector(".coins")?.classList.add("bump"));
  }
  if ((r.breakdown.chest ?? 0) > 0) setTimeout(() => celebrate("party"), 400);
  const cheer = CHEERS[Math.floor(Math.random() * CHEERS.length)]!;
  toast(
    `${cheer} ${task.parent_id ? "" : "Hecho hoy crece."}`,
    {
      label: "Deshacer",
      run: () =>
        void uncompleteTask(task.id).then((n) => toast(n > 0 ? `Deshecho: se regresaron ${n} 🪙` : "Deshecho: la tarea volvió a su lugar")),
    },
    10_000,
  );
  // Si era el último paso, ofrecer terminar la tarea madre (FR-106 de spec 002).
  if (task.parent_id) {
    const siblings = state.tasks.filter((t) => t.parent_id === task.parent_id);
    const parent = state.tasks.find((t) => t.id === task.parent_id);
    if (parent && parent.status !== "done" && siblings.every((s) => s.status === "done")) {
      setTimeout(
        () => toast(`Terminaste todos los pasos de "${parent.text}".`, { label: "Terminarla", run: () => void finishTask(parent) }, 10_000),
        2800,
      );
    }
  }
}
