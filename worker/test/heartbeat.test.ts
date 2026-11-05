import { describe, expect, it } from "vitest";
import { heartbeat } from "../src/heartbeat.js";

describe("latido diario", () => {
  it("llama a rpc/tracky_heartbeat con la publishable key", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify("2026-11-06T09:17:00Z"), { status: 200 });
    }) as typeof fetch;
    const ok = await heartbeat({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" }, fetchImpl);
    expect(ok).toBe(true);
    expect(calls[0]!.url).toBe("https://p.supabase.co/rest/v1/rpc/tracky_heartbeat");
    expect(calls[0]!.auth).toBe("Bearer sb_publishable_x");
  });

  it("no truena si Supabase falla o no está configurado", async () => {
    const failing = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    expect(await heartbeat({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_PUBLISHABLE_KEY: "k" }, failing)).toBe(false);
    expect(await heartbeat({ SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "" })).toBe(false);
  });
});
