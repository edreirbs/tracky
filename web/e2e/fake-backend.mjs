// Supabase y API de Tracky simulados para pruebas E2E en Chromium (sin nube y sin datos reales).
// Supabase vive en https://fake.supabase.co (build con VITE_SUPABASE_URL apuntando ahí).

export const SUPABASE = "https://fake.supabase.co";
export const USER = { id: "11111111-1111-4111-8111-111111111111", email: "persona@example.com" };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, email: USER.email, exp, role: "authenticated", aud: "authenticated" })}.firma`;
  return {
    access_token,
    refresh_token: "refresh",
    expires_in: 3600,
    expires_at: exp,
    token_type: "bearer",
    user: { id: USER.id, aud: "authenticated", role: "authenticated", email: USER.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}

const BASE = { XS: 5, S: 10, M: 20, L: 40 };

export function makeDb() {
  const now = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const task = (id, text, extra = {}) => ({
    id, client_id: id, user_id: USER.id, text, action: null, notes: null, person_id: null, status: "next", prev_status: null, due: null, blocking: false,
    follow_up: null, waiting_on: null, size: "S", energy: null, estimate_min: null, actual_min: null, tomorrow: false, is_frog: false,
    source: "manual", note_id: null, parent_id: null, sort: 1, created_at: "2026-11-01T10:00:00Z", done_at: null, ...extra,
  });
  return {
    profiles: [{ user_id: USER.id, display_name: "Persona de prueba", timezone: "America/Mexico_City", settings: {} }],
    people: [
      { id: "p1", user_id: USER.id, name: "Laura", color: 0 },
      { id: "p2", user_id: USER.id, name: "Luis", color: 3 },
    ],
    tags: [
      { id: "t1", user_id: USER.id, name: "Proyecto Aula", description: "Remodelación del aula", signals: [], is_fallback: false, color: 0, sort: 1 },
      { id: "t2", user_id: USER.id, name: "Otros", description: "Todo lo demás", signals: [], is_fallback: true, color: 0, sort: 9 },
    ],
    rewards: [
      { id: "r1", user_id: USER.id, name: "15 min de tiempo libre", emoji: "☕", cost: 30, minutes: 15, active: true, sort: 1 },
      { id: "r2", user_id: USER.id, name: "1 h de tiempo libre", emoji: "🎮", cost: 100, minutes: 60, active: true, sort: 3 },
    ],
    tasks: [
      task("a0000000-0000-4000-8000-000000000001", "Enviar minuta al comité", { status: "now", size: "M", person_id: "p1", due: today, action: "Mandar la minuta por correo al comité" }),
      task("a0000000-0000-4000-8000-000000000002", "Reservar sala 3 para el jueves", { status: "next", person_id: "p2", blocking: true }),
      task("a0000000-0000-4000-8000-000000000003", "Revisar cotización de proyectores", { status: "next", size: "L", is_frog: true }),
      task("a0000000-0000-4000-8000-000000000004", "Firma de jurídico", { status: "waiting", waiting_on: "Jurídico", follow_up: today }),
      task("a0000000-0000-4000-8000-000000000005", "lo de la sala", { status: "inbox", created_at: now }),
    ],
    notes: [
      {
        id: "n0000000-0000-4000-8000-000000000001".replace("n", "b"), user_id: USER.id, kind: "meeting", meeting_id: "m1", title: "Proyecto Aula – Cotización de proyectores", tag_id: "t1",
        labels: [], estado: "Importante", status: "saved", pinned: false, body: null, summary_md: "## Resumen\nSe revisaron **tres cotizaciones** de proyectores.\n\n## Acuerdos\n- Pedir cotización final a Luis",
        key_points: [], decisions: ["Elegir proveedor el viernes"], action_items: [{ task: "Pedir cotización final", owner: "Luis", due: null }], next_steps: "• Pedir cotización final – Luis",
        transcript: { turns: [{ speaker: "Yo", startMs: 0, endMs: 2000, text: "Revisemos los proyectores." }] }, started_at: "2026-11-04T16:00:00Z", duration_s: 1800,
        mode: "online", template: "general", model: "claude-opus-5-5", tag_confidence: 0.9, tag_alternatives: [], created_at: "2026-11-04T16:30:00Z", updated_at: "2026-11-04T16:30:00Z",
      },
    ],
    contacts: [{ id: "c1", user_id: USER.id, name: "Luis Pérez", company: "Proyectores SA", phone: "55 1234 5678", email: "luis@example.com", person_id: "p2", labels: ["proveedor"], body: null, pinned: false, created_at: now }],
    coin_ledger: [],
    assistant_threads: [],
    wallet: { balance: 40, lifetime: 120, earned_today: 0, streak: 3, level: { level: 2, floor: 100, next: 300 }, daily_cap: 300 },
  };
}

function filterRows(rows, url) {
  let out = rows;
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "or", "on_conflict", "offset", "columns"].includes(k)) continue;
    if (v.startsWith("eq.")) out = out.filter((r) => String(r[k]) === decodeURIComponent(v.slice(3)));
    if (v.startsWith("ilike.")) {
      const term = decodeURIComponent(v.slice(6)).replace(/%/g, "").toLowerCase();
      out = out.filter((r) => String(r[k] ?? "").toLowerCase().includes(term));
    }
  }
  return out;
}

/** Instala rutas que simulan Supabase (REST + RPC) y la API de Tracky. */
export async function installFakeBackend(context, db, calls = []) {
  await context.addInitScript((session) => {
    localStorage.setItem("sb-fake-auth-token", JSON.stringify(session));
  }, fakeSession());

  await context.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const reply = (data, status = 200) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(single && Array.isArray(data) ? (data[0] ?? null) : data) });
    const path = url.pathname.replace("/rest/v1/", "");
    calls.push(`${req.method()} ${path}`);

    if (url.pathname.startsWith("/auth/v1/")) return reply({ id: db.profiles[0].user_id });

    if (path.startsWith("rpc/")) {
      const fn = path.slice(4);
      const args = req.postDataJSON() ?? {};
      if (fn === "my_wallet") return reply(db.wallet);
      if (fn === "complete_task") {
        const t = db.tasks.find((x) => x.id === args.p_task_id);
        if (!t) return reply({ message: "no" }, 404);
        t.prev_status = t.status;
        t.status = "done";
        t.done_at = new Date().toISOString();
        const base = t.parent_id ? 2 : BASE[t.size];
        const frog = t.is_frog && !t.parent_id;
        const start = db.wallet.earned_today === 0 ? 5 : 0;
        const coins = Math.round(base * (frog ? 2 : 1) * 1.3) + start;
        db.wallet = { ...db.wallet, balance: db.wallet.balance + coins, earned_today: db.wallet.earned_today + coins, lifetime: db.wallet.lifetime + coins };
        db.coin_ledger.unshift({ id: `l${db.coin_ledger.length}`, amount: coins, kind: "task", breakdown: { base, frog, streak_pct: 0.3, start_bonus: start }, created_at: t.done_at, task: { text: t.text } });
        return reply({ coins, breakdown: { size: t.size, base, frog, streak_days: 3, streak_pct: 0.3, start_bonus: start, chest: 0, capped: false }, wallet: db.wallet });
      }
      if (fn === "uncomplete_task") {
        const t = db.tasks.find((x) => x.id === args.p_task_id);
        const l = db.coin_ledger.find((x) => x.task?.text === t?.text);
        if (t) Object.assign(t, { status: t.prev_status ?? "next", done_at: null });
        db.wallet = { ...db.wallet, balance: db.wallet.balance - (l?.amount ?? 0) };
        return reply({ reverted: l?.amount ?? 0, wallet: db.wallet });
      }
      if (fn === "redeem_reward") {
        const r = db.rewards.find((x) => x.id === args.p_reward_id);
        if (db.wallet.balance < r.cost) return reply({ message: `Saldo insuficiente: tienes ${db.wallet.balance} y cuesta ${r.cost}`, hint: "saldo_insuficiente" }, 400);
        db.wallet = { ...db.wallet, balance: db.wallet.balance - r.cost };
        return reply({ ends_at: new Date(Date.now() + r.minutes * 60_000).toISOString(), wallet: db.wallet });
      }
      if (fn === "search_everything") {
        const q = String(args.p_query).toLowerCase();
        const hits = [
          ...db.tasks.filter((t) => t.text.toLowerCase().includes(q)).map((t) => ({ kind: "task", id: t.id, title: t.text, snippet: "", created_at: t.created_at })),
          ...db.notes.filter((n) => (n.title + (n.summary_md ?? "")).toLowerCase().includes(q)).map((n) => ({ kind: n.kind, id: n.id, title: n.title, snippet: n.summary_md ?? "", created_at: n.created_at })),
          ...db.contacts.filter((c) => (c.name + c.company).toLowerCase().includes(q)).map((c) => ({ kind: "contact", id: c.id, title: c.name, snippet: c.company, created_at: c.created_at })),
        ];
        return reply(hits);
      }
      return reply({ message: `rpc ${fn}` }, 404);
    }

    const table = db[path];
    if (!Array.isArray(table)) return reply([]);
    if (req.method() === "GET") {
      let rows = filterRows(table, url);
      if (path === "coin_ledger") rows = rows.slice(0, 40);
      return reply(rows);
    }
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      const list = Array.isArray(body) ? body : [body];
      const created = [];
      for (const row of list) {
        const existing = row.client_id && table.find((r) => r.client_id === row.client_id);
        if (existing) continue;
        const r = { id: row.id ?? crypto.randomUUID(), user_id: USER.id, created_at: new Date().toISOString(), labels: [], ...row };
        table.push(r);
        created.push(r);
      }
      return reply(created, 201);
    }
    if (req.method() === "PATCH") {
      const rows = filterRows(table, url);
      const patch = req.postDataJSON();
      rows.forEach((r) => Object.assign(r, patch));
      return reply(rows);
    }
    if (req.method() === "DELETE") {
      const rows = filterRows(table, url);
      db[path] = table.filter((r) => !rows.includes(r));
      return reply([]);
    }
    return reply({}, 405);
  });

  // El puente local (127.0.0.1) es real: no se simula.
  const isApp = (u) => u.origin !== SUPABASE && u.hostname !== "127.0.0.1";
  await context.route((u) => isApp(u) && u.pathname === "/health", (route) => route.fulfill({ json: { status: "ok", app: "tracky", claude: "ok", configured: { supabase: true, serviceRole: true, anthropic: true } } }));
  await context.route((u) => isApp(u) && u.pathname.startsWith("/v1/"), async (route) => {
    const url = new URL(route.request().url());
    calls.push(`API ${url.pathname}`);
    if (url.pathname === "/v1/tasks/parse") {
      return route.fulfill({
        json: { suggestion: { action: "Llamar a Laura para confirmar la sala 3", person: "Laura", due: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), size: "S", estimate_min: 10, energy: "low", blocking: true, two_minute: false, steps: [] } },
      });
    }
    if (url.pathname === "/v1/ask") {
      const n = db.notes[0];
      return route.fulfill({
        json: {
          answer: `Hoy te conviene **una sola cosa**: mandar la minuta al comité.\n\n- En [${n.title}](tracky://note/${n.id}) quedó pendiente pedir la cotización final a Luis.`,
          citations: [{ kind: "note", id: n.id, title: n.title }],
          proposals: [{ text: "Pedir cotización final a Luis", due: null, size: "S", status: "next", existing_task_id: null, reason: "Acuerdo de la reunión" }],
          usage: null,
        },
      });
    }
    return route.fulfill({ status: 404, json: { type: "not_found", title: "No", status: 404 } });
  });
}
