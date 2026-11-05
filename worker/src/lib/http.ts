import type { Problem } from "@tracky/shared";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly title: string,
    readonly retryable = false,
    readonly detail?: string,
  ) {
    super(title);
  }
}

export function problem(err: HttpError): Response {
  const body: Problem = {
    type: err.type,
    title: err.title,
    status: err.status,
    retryable: err.retryable,
    ...(err.detail ? { detail: err.detail } : {}),
  };
  return new Response(JSON.stringify(body), {
    status: err.status,
    headers: { "content-type": "application/problem+json" },
  });
}

/** Log estructurado SIN contenido: nunca transcripciones, resúmenes, audio ni tokens. */
export function logEvent(fields: Record<string, string | number | boolean | undefined>): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(fields));
}

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(buf);
}

export function base64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Backoff exponencial con jitter completo. */
export function backoffMs(attempt: number, baseMs = 500, maxMs = 15_000): number {
  return Math.random() * Math.min(maxMs, baseMs * 2 ** attempt);
}

/** HMAC-SHA256 en hex (para el secreto interno de las funciones en segundo plano). */
export async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
