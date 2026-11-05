// Estado de la app y acceso a Supabase (RLS). Cambios optimistas: la UI responde en < 100 ms
// (constitución V) y Supabase se concilia después. Las capturas sin conexión van a una cola local.
import { BASE_COINS, localDate, type TaskSize, type TaskStatus } from "@tracky/shared";
import { getSetting, setSetting } from "../storage/db.js";
import { setVocabulary } from "../session/vocabulary.js";
import { supabase } from "../supabase.js";

export interface Task {
  id: string;
  client_id: string | null;
  text: string;
  action: string | null;
  notes: string | null;
  person_id: string | null;
  status: TaskStatus;
  due: string | null;
  blocking: boolean;
  follow_up: string | null;
  waiting_on: string | null;
  size: TaskSize;
  energy: "low" | "medium" | "high" | null;
  estimate_min: number | null;
  actual_min: number | null;
  tomorrow: boolean;
  is_frog: boolean;
  source: "manual" | "meeting" | "assistant";
  note_id: string | null;
  parent_id: string | null;
  sort: number;
  created_at: string;
  done_at: string | null;
  /** Solo en cliente: aún no confirmada por Supabase. */
  pending?: boolean;
}

export interface Person {
  id: string;
  name: string;
  color: number;
}

export interface Tag {
  id: string;
  name: string;
  description: string;
  signals: string[];
  is_fallback: boolean;
  color: number;
  sort: number;
}

export interface Wallet {
  balance: number;
  lifetime: number;
  earned_today: number;
  streak: number;
  level: { level: number; floor: number; next: number };
  daily_cap: number;
}

export interface Reward {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  minutes: number | null;
  active: boolean;
  sort: number;
}

export interface Profile {
  user_id: string;
  display_name: string | null;
  timezone: string;
  settings: { vocabulary?: string[]; sound?: boolean; activeRedemption?: { name: string; ends_at: string } };
}

export interface CompleteResult {
  coins: number;
  breakdown: {
    size?: TaskSize;
    base?: number;
    frog?: boolean;
    quick?: boolean;
    streak_days?: number;
    streak_pct?: number;
    start_bonus?: number;
    chest?: number;
    capped?: boolean;
    already_paid?: boolean;
    step?: boolean;
  };
  wallet: Wallet;
}

type Listener = () => void;

interface State {
  ready: boolean;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  tasks: Task[];
  people: Person[];
  tags: Tag[];
  rewards: Reward[];
  wallet: Wallet | null;
  error: string | null;
}

export const state: State = {
  ready: false,
  userId: null,
  email: null,
  profile: null,
  tasks: [],
  people: [],
  tags: [],
  rewards: [],
  wallet: null,
  error: null,
};

const listeners = new Set<Listener>();
let version = 0;
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getVersion(): number {
  return version;
}
function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function setError(msg: string | null) {
  state.error = msg;
  emit();
}

export function today(): string {
  return localDate(new Date(), state.profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export function timeZone(): string {
  return state.profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const TASK_COLS =
  "id,client_id,text,action,notes,person_id,status,due,blocking,follow_up,waiting_on,size,energy,estimate_min,actual_min,tomorrow,is_frog,source,note_id,parent_id,sort,created_at,done_at";

function fail(e: { message: string } | null): void {
  if (e) throw new Error(e.message);
}

export async function loadAll(userId: string, email: string | null): Promise<void> {
  state.userId = userId;
  state.email = email;
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [profile, tasks, people, tags, rewards] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("tasks").select(TASK_COLS).or(`status.neq.done,done_at.gte.${since}`).order("sort").limit(2000),
    supabase.from("people").select("id,name,color").order("name"),
    supabase.from("tags").select("id,name,description,signals,is_fallback,color,sort").order("sort").order("name"),
    supabase.from("rewards").select("id,name,emoji,cost,minutes,active,sort").order("sort"),
  ]);
  fail(profile.error);
  fail(tasks.error);
  state.profile = (profile.data as Profile | null) ?? { user_id: userId, display_name: null, timezone: timeZone(), settings: {} };
  state.tasks = (tasks.data ?? []) as Task[];
  state.people = (people.data ?? []) as Person[];
  state.tags = (tags.data ?? []) as Tag[];
  state.rewards = (rewards.data ?? []) as Reward[];
  setVocabulary([...state.tags.filter((t) => !t.is_fallback).map((t) => t.name), ...(state.profile.settings.vocabulary ?? [])]);
  await refreshWallet();
  await rollTomorrow();
  state.ready = true;
  emit();
  void flushCaptureQueue();
}

export async function refreshWallet(): Promise<void> {
  const { data, error } = await supabase.rpc("my_wallet");
  if (!error) {
    state.wallet = data as Wallet;
    emit();
  }
}

// ---------------------------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------------------------
function uuid(): string {
  return crypto.randomUUID();
}

function localTask(fields: Partial<Task> & { text: string }): Task {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    client_id: uuid(),
    action: null,
    notes: null,
    person_id: null,
    status: "inbox",
    due: null,
    blocking: false,
    follow_up: null,
    waiting_on: null,
    size: "S",
    energy: null,
    estimate_min: null,
    actual_min: null,
    tomorrow: false,
    is_frog: false,
    source: "manual",
    note_id: null,
    parent_id: null,
    sort: Date.now(),
    created_at: now,
    done_at: null,
    ...fields,
  };
}

const QUEUE_KEY = "capture-queue:v1";

async function insertTask(t: Task): Promise<void> {
  const { pending: _p, ...row } = t;
  const { error } = await supabase.from("tasks").upsert(row, { onConflict: "user_id,client_id", ignoreDuplicates: true });
  fail(error);
}

/** Guarda una tarea al instante (optimista). Si no hay red, queda en la cola local (constitución IV). */
export async function createTask(fields: Partial<Task> & { text: string }): Promise<Task> {
  const t = { ...localTask(fields), pending: true };
  state.tasks = [...state.tasks, t];
  emit();
  try {
    await insertTask(t);
    t.pending = false;
  } catch {
    const q = ((await getSetting<Task[]>(QUEUE_KEY)) ?? []).concat(t);
    await setSetting(QUEUE_KEY, q);
  }
  emit();
  return t;
}

export async function flushCaptureQueue(): Promise<void> {
  const q = (await getSetting<Task[]>(QUEUE_KEY)) ?? [];
  if (!q.length) return;
  const left: Task[] = [];
  for (const t of q) {
    try {
      await insertTask(t);
      const local = state.tasks.find((x) => x.id === t.id);
      if (local) local.pending = false;
    } catch {
      left.push(t);
    }
  }
  await setSetting(QUEUE_KEY, left);
  emit();
}
if (typeof window !== "undefined") window.addEventListener("online", () => void flushCaptureQueue());

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const before = { ...t };
  Object.assign(t, patch);
  state.tasks = [...state.tasks];
  emit();
  const { pending: _p, ...clean } = patch;
  const { error } = await supabase.from("tasks").update(clean).eq("id", id);
  if (error) {
    Object.assign(t, before);
    state.tasks = [...state.tasks];
    setError("No se pudo guardar el cambio. Intenta de nuevo.");
  }
}

export async function deleteTask(id: string): Promise<void> {
  const prev = state.tasks;
  state.tasks = state.tasks.filter((t) => t.id !== id && t.parent_id !== id);
  emit();
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) {
    state.tasks = prev;
    setError("No se pudo borrar.");
  }
}

/** Terminar: la celebración ocurre antes (optimista); aquí se cobran las monedas en el servidor. */
export async function completeTask(id: string): Promise<CompleteResult | null> {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return null;
  const prevStatus = t.status;
  t.status = "done";
  t.done_at = new Date().toISOString();
  t.tomorrow = false;
  state.tasks = [...state.tasks];
  emit();
  if (t.pending) await flushCaptureQueue();
  const { data, error } = await supabase.rpc("complete_task", { p_task_id: id, p_key: `complete:${id}:${Date.now()}` });
  if (error) {
    t.status = prevStatus;
    t.done_at = null;
    state.tasks = [...state.tasks];
    setError("No se pudo terminar la tarea. Revisa tu conexión.");
    return null;
  }
  const r = data as CompleteResult;
  state.wallet = r.wallet;
  emit();
  return r;
}

export async function uncompleteTask(id: string): Promise<number> {
  const { data, error } = await supabase.rpc("uncomplete_task", { p_task_id: id });
  if (error) {
    setError("No se pudo deshacer.");
    return 0;
  }
  const r = data as { reverted: number; wallet: Wallet };
  const { data: row } = await supabase.from("tasks").select(TASK_COLS).eq("id", id).maybeSingle();
  if (row) state.tasks = state.tasks.map((t) => (t.id === id ? (row as Task) : t));
  state.wallet = r.wallet;
  emit();
  return r.reverted;
}

/** Las estrellas de "Cerrar el día" pasan solas a Ahora al día siguiente (FR-109). */
async function rollTomorrow(): Promise<void> {
  const last = await getSetting<string>("tomorrow-rolled");
  const d = today();
  if (last === d) return;
  const stars = state.tasks.filter((t) => t.tomorrow && t.status !== "done");
  const closedOn = await getSetting<string>("closed-on");
  if (stars.length && closedOn && closedOn < d) {
    for (const t of stars) await updateTask(t.id, { status: "now", tomorrow: false });
  }
  await setSetting("tomorrow-rolled", d);
}

export function estimatedCoins(size: TaskSize): number {
  return BASE_COINS[size];
}

// ---------------------------------------------------------------------------------------------
// Personas, etiquetas, perfil, recompensas
// ---------------------------------------------------------------------------------------------
export async function ensurePerson(name: string): Promise<Person | null> {
  const clean = name.trim();
  if (!clean) return null;
  const existing = state.people.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const color = state.people.length % 6;
  const { data, error } = await supabase.from("people").insert({ name: clean, color }).select("id,name,color").single();
  if (error || !data) {
    setError("No se pudo guardar la persona.");
    return null;
  }
  state.people = [...state.people, data as Person].sort((a, b) => a.name.localeCompare(b.name));
  emit();
  return data as Person;
}

export async function updatePerson(id: string, patch: Partial<Person>): Promise<void> {
  const { error } = await supabase.from("people").update(patch).eq("id", id);
  if (error) return setError("No se pudo guardar.");
  state.people = state.people.map((p) => (p.id === id ? { ...p, ...patch } : p));
  emit();
}

export async function saveTag(tag: Partial<Tag> & { name: string }): Promise<void> {
  const { data, error } = tag.id
    ? await supabase.from("tags").update(tag).eq("id", tag.id).select().single()
    : await supabase.from("tags").insert(tag).select().single();
  if (error) return setError(error.message.includes("duplicate") ? "Ya existe una etiqueta con ese nombre." : "No se pudo guardar la etiqueta.");
  state.tags = tag.id ? state.tags.map((t) => (t.id === tag.id ? (data as Tag) : t)) : [...state.tags, data as Tag];
  emit();
}

export async function deleteTag(id: string): Promise<void> {
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) return setError("No se pudo borrar la etiqueta.");
  state.tags = state.tags.filter((t) => t.id !== id);
  emit();
}

export async function saveProfile(patch: Partial<Profile>): Promise<void> {
  if (!state.profile) return;
  const { error } = await supabase.from("profiles").update(patch).eq("user_id", state.profile.user_id);
  if (error) return setError("No se pudo guardar el perfil.");
  state.profile = { ...state.profile, ...patch };
  emit();
}

export async function saveReward(r: Partial<Reward> & { name: string; cost: number }): Promise<void> {
  const { data, error } = r.id
    ? await supabase.from("rewards").update(r).eq("id", r.id).select().single()
    : await supabase.from("rewards").insert({ ...r, sort: state.rewards.length + 1 }).select().single();
  if (error) return setError("No se pudo guardar la recompensa (costo mínimo 10).");
  state.rewards = r.id ? state.rewards.map((x) => (x.id === r.id ? (data as Reward) : x)) : [...state.rewards, data as Reward];
  emit();
}

export async function redeem(reward: Reward): Promise<{ ends_at: string | null } | string> {
  const { data, error } = await supabase.rpc("redeem_reward", { p_reward_id: reward.id, p_key: `redeem:${reward.id}:${Date.now()}` });
  if (error) return /Saldo insuficiente/.test(error.message) ? "Aún no te alcanza. ¡Cada tarea suma!" : "No se pudo canjear.";
  const r = data as { ends_at: string | null; wallet: Wallet };
  state.wallet = r.wallet;
  emit();
  return { ends_at: r.ends_at };
}
