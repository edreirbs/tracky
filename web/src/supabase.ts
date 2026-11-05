import { createClient, type Session } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";

export const configured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

export const supabase = createClient(SUPABASE_URL || "https://no-configurado.supabase.co", SUPABASE_PUBLISHABLE_KEY || "x", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Token con al menos 20 min de vida (el resumen en segundo plano puede tardar hasta 15). */
export async function freshAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) return null;
  if ((s.expires_at ?? 0) * 1000 - Date.now() > 20 * 60_000) return s.access_token;
  const { data: r } = await supabase.auth.refreshSession();
  return r.session?.access_token ?? s.access_token;
}

export async function sendMagicLink(email: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: window.location.origin + window.location.pathname, shouldCreateUser: true },
  });
  if (!error) return null;
  return /not authorized|no autorizado|Database error/i.test(error.message)
    ? "Este correo no está autorizado en esta instancia de Tracky."
    : error.message;
}

export function onSession(cb: (s: Session | null) => void): () => void {
  void supabase.auth.getSession().then(({ data }) => cb(data.session));
  const { data } = supabase.auth.onAuthStateChange((_e, s) => cb(s));
  return () => data.subscription.unsubscribe();
}
