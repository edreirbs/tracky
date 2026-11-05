import { beforeEach, describe, expect, it } from "vitest";
import { type Db, freshDb } from "./db.js";

type Json = Record<string, unknown>;
let db: Db;
let ana: string;
let beto: string;

async function addTask(user: string, fields: Json = {}): Promise<string> {
  return db.as(user, async () => {
    const cols = Object.keys({ text: "x", ...fields });
    const vals = Object.values({ text: "x", ...fields });
    const r = await db.query<{ id: string }>(
      `insert into public.tasks (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
      vals,
    );
    return r.rows[0]!.id;
  });
}

/** Hace la tarea "vieja" para que no aplique la regla anti-trampa de < 2 min (R7). */
async function age(taskId: string, minutes = 10) {
  await db.exec(`alter table public.tasks disable trigger tasks_guard`);
  await db.query(`update public.tasks set created_at = now() - make_interval(mins => $2) where id = $1`, [taskId, minutes]);
  await db.exec(`alter table public.tasks enable trigger tasks_guard`);
}

async function complete(user: string, taskId: string, key = `k-${taskId}`): Promise<Json> {
  return db.as(user, async () => (await db.query<{ r: Json }>("select public.complete_task($1, $2) as r", [taskId, key])).rows[0]!.r);
}

async function noChest(user: string) {
  await db.query(`update public.coin_rules set rules = jsonb_set(rules, '{chest_every}', '1000000') where user_id = $1`, [user]);
}

beforeEach(async () => {
  db = await freshDb();
  ana = await db.createUser("ana@example.com");
  beto = await db.createUser("beto@example.com");
  await noChest(ana);
  await noChest(beto);
});

describe("alta de usuarios", () => {
  it("rechaza correos fuera de la lista", async () => {
    await expect(db.query("insert into auth.users (email) values ('intruso@example.com')")).rejects.toThrow(/no autorizado/);
  });
  it("crea perfil, reglas y recompensas por defecto", async () => {
    const rewards = await db.query<{ cost: number }>("select cost from public.rewards where user_id = $1 order by sort", [ana]);
    expect(rewards.rows.map((r) => r.cost)).toEqual([30, 55, 100]);
  });
});

describe("RLS", () => {
  it("un usuario no ve ni modifica tareas de otro", async () => {
    const t = await addTask(ana, { text: "secreto de Ana" });
    const seen = await db.as(beto, () => db.query("select * from public.tasks"));
    expect(seen.rows).toHaveLength(0);
    await db.as(beto, () => db.query("update public.tasks set text = 'hackeado' where id = $1", [t]));
    const r = await db.query<{ text: string }>("select text from public.tasks where id = $1", [t]);
    expect(r.rows[0]!.text).toBe("secreto de Ana");
  });
  it("no se puede insertar a nombre de otro usuario", async () => {
    await expect(addTask(beto, { user_id: ana })).rejects.toThrow(/row-level security/);
  });
  it("el cliente no puede escribir monedas directo", async () => {
    await expect(
      db.as(ana, () =>
        db.query("insert into public.coin_ledger (user_id, amount, kind, idempotency_key, local_day) values ($1, 999, 'adjust', 'x', current_date)", [ana]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("no se puede marcar terminada sin complete_task", async () => {
    const t = await addTask(ana);
    await expect(db.as(ana, () => db.query("update public.tasks set status = 'done' where id = $1", [t]))).rejects.toThrow(/complete_task/);
  });
  it("anon no puede leer nada", async () => {
    await db.exec("set role anon");
    await expect(db.query("select * from public.tasks")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});

describe("economía (spec 003)", () => {
  it("paga la base por tamaño + arranque del día (R1, R3)", async () => {
    const t = await addTask(ana, { size: "M", status: "now" });
    await age(t);
    const r = await complete(ana, t);
    expect(r.coins).toBe(20 + 5);
    expect((r.breakdown as Json).start_bonus).toBe(5);
    const second = await addTask(ana, { size: "S" });
    await age(second);
    expect((await complete(ana, second)).coins).toBe(10);
  });

  it("el sapo vale doble una vez al día (R2)", async () => {
    const a = await addTask(ana, { size: "L", is_frog: true });
    const b = await addTask(ana, { size: "L", is_frog: true });
    await age(a);
    await age(b);
    expect((await complete(ana, a)).coins).toBe(80 + 5);
    expect((await complete(ana, b)).coins).toBe(40);
  });

  it("anti-trampa: creada y terminada en < 2 min vale XS sin bonos (R7)", async () => {
    const t = await addTask(ana, { size: "L", is_frog: true });
    const r = await complete(ana, t);
    expect(r.coins).toBe(5);
    expect((r.breakdown as Json).quick).toBe(true);
  });

  it("los acuerdos de reunión no cuentan como trampa", async () => {
    const t = await addTask(ana, { size: "M", source: "meeting" });
    expect((await complete(ana, t)).coins).toBe(20 + 5);
  });

  it("es idempotente con la misma llave y no paga dos veces la misma tarea", async () => {
    const t = await addTask(ana, { size: "S" });
    await age(t);
    const a = await complete(ana, t, "llave-1");
    const b = await complete(ana, t, "llave-1");
    expect(b.repeated).toBe(true);
    expect(b.coins).toBe(a.coins);
    const w = await db.as(ana, async () => (await db.query<{ w: Json }>("select public.my_wallet() as w")).rows[0]!.w);
    expect(w.balance).toBe(15);
  });

  it("deshacer revierte exactamente y volver a terminar vuelve a pagar (R9)", async () => {
    const t = await addTask(ana, { size: "M" });
    await age(t);
    await complete(ana, t, "a");
    const u = await db.as(ana, async () => (await db.query<{ r: Json }>("select public.uncomplete_task($1) as r", [t])).rows[0]!.r);
    expect(u.reverted).toBe(25);
    expect((u.wallet as Json).balance).toBe(0);
    const status = await db.query<{ status: string }>("select status from public.tasks where id = $1", [t]);
    expect(status.rows[0]!.status).toBe("inbox");
    expect((await complete(ana, t, "b")).coins).toBe(25);
  });

  it("reabrir después de 24 h no devuelve monedas ni permite cobrar otra vez", async () => {
    const t = await addTask(ana, { size: "M" });
    await age(t);
    await complete(ana, t, "a");
    await db.query("update public.coin_ledger set created_at = now() - interval '2 days' where task_id = $1", [t]);
    await db.as(ana, () => db.query("select public.uncomplete_task($1)", [t]));
    const again = await complete(ana, t, "b");
    expect(again.coins).toBe(0);
    expect((again.breakdown as Json).already_paid).toBe(true);
  });

  it("respeta el tope diario (R8)", async () => {
    await db.query(`update public.coin_rules set rules = jsonb_set(rules, '{daily_cap}', '30') where user_id = $1`, [ana]);
    const a = await addTask(ana, { size: "M" });
    const b = await addTask(ana, { size: "M" });
    await age(a);
    await age(b);
    expect((await complete(ana, a)).coins).toBe(25);
    const r = await complete(ana, b);
    expect(r.coins).toBe(5);
    expect((r.breakdown as Json).capped).toBe(true);
  });

  it("racha: +10 % por día seguido con tope de 50 % (R4)", async () => {
    // Días anteriores activos: 7 días seguidos hasta ayer.
    for (let d = 1; d <= 7; d++) {
      await db.query(
        `insert into public.coin_ledger (user_id, amount, kind, idempotency_key, local_day) values ($1, 10, 'task', $2, public.tracky_today($1) - $3::int)`,
        [ana, `hist-${d}`, d],
      );
    }
    const t = await addTask(ana, { size: "L" });
    await age(t);
    const r = await complete(ana, t);
    expect((r.breakdown as Json).streak_days).toBe(7);
    expect(r.coins).toBe(Math.round(40 * 1.5) + 5);
  });

  it("racha: un día de gracia no la rompe", async () => {
    for (const d of [1, 3, 4]) {
      await db.query(
        `insert into public.coin_ledger (user_id, amount, kind, idempotency_key, local_day) values ($1, 10, 'task', $2, public.tracky_today($1) - $3::int)`,
        [ana, `hist-${d}`, d],
      );
    }
    const streak = await db.query<{ s: number }>("select public.tracky_streak($1) as s", [ana]);
    expect(streak.rows[0]!.s).toBe(3);
  });

  it("pasos pagan 2 y máximo 10 por tarea (R6)", async () => {
    const parent = await addTask(ana, { size: "L" });
    const steps: string[] = [];
    for (let i = 0; i < 11; i++) steps.push(await addTask(ana, { parent_id: parent, text: `paso ${i}` }));
    const paid: number[] = [];
    for (const s of steps) paid.push((await complete(ana, s)).coins as number);
    expect(paid.slice(0, 10).every((c) => c === 2)).toBe(true);
    expect(paid[10]).toBe(0);
  });

  it("canjear valida saldo y descuenta (spec 003 § 3)", async () => {
    const reward = (await db.query<{ id: string }>("select id from public.rewards where user_id = $1 and cost = 30", [ana])).rows[0]!.id;
    await expect(db.as(ana, () => db.query("select public.redeem_reward($1, 'r1')", [reward]))).rejects.toThrow(/Saldo insuficiente/);
    const t = await addTask(ana, { size: "L" });
    await age(t);
    await complete(ana, t); // 45
    const r = await db.as(ana, async () => (await db.query<{ r: Json }>("select public.redeem_reward($1, 'r2') as r", [reward])).rows[0]!.r);
    expect((r.wallet as Json).balance).toBe(15);
    expect(r.ends_at).toBeTruthy();
    const again = await db.as(ana, async () => (await db.query<{ r: Json }>("select public.redeem_reward($1, 'r2') as r", [reward])).rows[0]!.r);
    expect(again.repeated).toBe(true);
    expect((again.wallet as Json).balance).toBe(15);
  });

  it("niveles cosméticos por monedas de por vida", async () => {
    const lvl = await db.query<{ l: Json }>("select public.tracky_level(350) as l");
    expect(lvl.rows[0]!.l).toEqual({ level: 3, floor: 300, next: 700 });
  });
});

describe("búsqueda", () => {
  it("encuentra notas, tareas y contactos propios", async () => {
    await db.as(ana, async () => {
      await db.query("insert into public.notes (title, body) values ('Presupuesto del aula', 'Revisamos proyectores')");
      await db.query("insert into public.tasks (text) values ('Cotizar proyectores nuevos')");
      await db.query("insert into public.contacts (name, company) values ('Luis Pérez', 'Proyectores SA')");
    });
    await db.as(beto, () => db.query("insert into public.tasks (text) values ('proyectores de Beto')"));
    const r = await db.as(ana, () => db.query<{ kind: string }>("select kind from public.search_everything('proyectores')"));
    expect(r.rows.map((x) => x.kind).sort()).toEqual(["contact", "memo", "task"]);
  });
});
