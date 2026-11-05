// POST /v1/tasks/parse (spec 002) y POST /v1/ask (spec 004).
import { AskRequest, ParseTaskRequest } from "@tracky/shared";
import { Hono } from "hono";
import { ask } from "../claude/ask.js";
import { parseTask } from "../claude/parse-task.js";
import { type AppEnv, effortOf } from "../env.js";
import { HttpError, logEvent, problem } from "../lib/http.js";
import type { DepsFactory } from "./notes.js";

export function assistRoutes(depsFactory: DepsFactory) {
  const r = new Hono<AppEnv>();

  r.post("/tasks/parse", async (c) => {
    const parsed = ParseTaskRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(new HttpError(400, "validation_error", "Solicitud inválida"));
    const suggestion = await parseTask(depsFactory(c.env).anthropic, c.env.CLAUDE_FAST_MODEL, parsed.data);
    return c.json({ suggestion });
  });

  r.post("/ask", async (c) => {
    const parsed = AskRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(new HttpError(400, "validation_error", "Solicitud inválida"));
    const deps = depsFactory(c.env);
    const t0 = Date.now();
    const res = await ask(deps.anthropic, c.env.CLAUDE_MODEL, effortOf(c.env), deps.asUser(c.get("userToken")), parsed.data);
    logEvent({
      evt: "ask",
      ms: Date.now() - t0,
      inputTokens: res.usage?.inputTokens,
      cacheReadTokens: res.usage?.cacheReadTokens,
      outputTokens: res.usage?.outputTokens,
      citations: res.citations.length,
      proposals: res.proposals.length,
    });
    return c.json(res);
  });

  return r;
}
