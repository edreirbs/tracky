// Datos del Archivo (spec 002 FR-114/115): contactos, notas sueltas y búsqueda.
import type { Task } from "../../data/store.js";
import { supabase } from "../../supabase.js";

export interface Contact {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  person_id: string | null;
  labels: string[];
  body: string | null;
  pinned: boolean;
  created_at: string;
}

export interface NoteRow {
  id: string;
  kind: "meeting" | "memo";
  meeting_id: string | null;
  title: string;
  tag_id: string | null;
  labels: string[];
  estado: "Normal" | "Importante";
  status: "saved" | "summary_failed";
  pinned: boolean;
  body: string | null;
  summary_md: string | null;
  key_points: string[];
  decisions: string[];
  action_items: Array<{ task: string; owner: string | null; due: string | null }>;
  next_steps: string | null;
  started_at: string | null;
  duration_s: number | null;
  mode: "online" | "in_person" | null;
  template: string | null;
  model: string | null;
  tag_confidence: number | null;
  tag_alternatives: string[];
  created_at: string;
  updated_at: string;
}

export interface SearchHit {
  kind: "meeting" | "memo" | "task" | "contact";
  id: string;
  title: string;
  snippet: string;
  created_at: string;
}

export const NOTE_LIST_COLS = "id,kind,meeting_id,title,tag_id,labels,estado,status,pinned,body,summary_md,next_steps,started_at,duration_s,created_at,updated_at";
export const NOTE_FULL_COLS = `${NOTE_LIST_COLS},key_points,decisions,action_items,mode,template,model,tag_confidence,tag_alternatives`;

export async function searchEverything(q: string): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  const { data } = await supabase.rpc("search_everything", { p_query: q, p_limit: 30 });
  return (data ?? []) as SearchHit[];
}

export async function listContacts(): Promise<Contact[]> {
  const { data } = await supabase.from("contacts").select("*").order("pinned", { ascending: false }).order("name");
  return (data ?? []) as Contact[];
}

export async function saveContact(c: Partial<Contact> & { name: string }): Promise<string | null> {
  const { search: _s, ...row } = c as Partial<Contact> & { name: string; search?: unknown };
  const { error } = c.id ? await supabase.from("contacts").update(row).eq("id", c.id) : await supabase.from("contacts").insert(row);
  return error ? "No se pudo guardar el contacto." : null;
}

export async function deleteContact(id: string): Promise<void> {
  await supabase.from("contacts").delete().eq("id", id);
}

export async function listNotes(kind: "meeting" | "memo" | "all", limit = 200): Promise<NoteRow[]> {
  let q = supabase.from("notes").select(NOTE_LIST_COLS).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
  if (kind !== "all") q = q.eq("kind", kind);
  const { data } = await q;
  return (data ?? []) as NoteRow[];
}

export async function getNote(id: string): Promise<(NoteRow & { transcript: { turns?: Array<{ speaker: string; startMs: number; text: string }> } | null }) | null> {
  const { data } = await supabase.from("notes").select(`${NOTE_FULL_COLS},transcript`).eq("id", id).maybeSingle();
  return data as never;
}

export async function saveMemo(n: { id?: string; title: string; body: string; labels: string[]; tag_id: string | null; pinned?: boolean }): Promise<string | null> {
  const row = { kind: "memo", ...n };
  const { error } = n.id ? await supabase.from("notes").update(row).eq("id", n.id) : await supabase.from("notes").insert(row);
  return error ? "No se pudo guardar la nota." : null;
}

export async function patchNote(id: string, patch: Partial<NoteRow>): Promise<void> {
  await supabase.from("notes").update(patch).eq("id", id);
}

export async function deleteNote(id: string): Promise<void> {
  await supabase.from("notes").delete().eq("id", id);
}

export async function createMemoFromTask(t: Task): Promise<void> {
  await saveMemo({ title: t.text.slice(0, 200), body: [t.action, t.notes].filter(Boolean).join("\n\n"), labels: [], tag_id: null });
}

export async function createContactFromTask(t: Task): Promise<void> {
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(t.text)?.[0] ?? null;
  const phone = /(\+?\d[\d\s-]{7,}\d)/.exec(t.text)?.[0]?.trim() ?? null;
  const name = t.text.replace(email ?? "", "").replace(phone ?? "", "").trim() || t.text;
  await saveContact({ name: name.slice(0, 120), email, phone, person_id: t.person_id, labels: [], body: t.notes });
}
