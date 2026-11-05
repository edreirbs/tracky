// Sugerencias del cargador de tareas (spec 002 FR-104): chips opcionales, nunca bloquean la captura.
import type Anthropic from "@anthropic-ai/sdk";
import { type ParseTaskRequest, TASK_SUGGESTION_JSON_SCHEMA, TaskSuggestion } from "@tracky/shared";
import { TASK_PARSE_PROMPT } from "../generated/prompts.js";
import { HttpError } from "../lib/http.js";

export function buildParseMessage(req: ParseTaskRequest): string {
  const weekday = new Date(`${req.today}T12:00:00Z`).toLocaleDateString("es-MX", { weekday: "long", timeZone: "UTC" });
  const people = req.people.length ? req.people.map((p) => `- ${p}`).join("\n") : "(ninguna registrada)";
  return [
    `<context>\nHoy: ${req.today} (${weekday})\nZona horaria: ${req.timeZone}\n</context>`,
    `<known_people>\n${people}\n</known_people>`,
    `<task_text>\n${req.text}\n</task_text>`,
  ].join("\n\n");
}

export async function parseTask(client: Anthropic, model: string, req: ParseTaskRequest): Promise<TaskSuggestion> {
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: TASK_SUGGESTION_JSON_SCHEMA } },
    system: [{ type: "text", text: TASK_PARSE_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildParseMessage(req) }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new HttpError(422, "llm_refusal", "Claude no generó sugerencias");
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  let parsed: ReturnType<typeof TaskSuggestion.safeParse>;
  try {
    parsed = TaskSuggestion.safeParse(JSON.parse(text));
  } catch {
    throw new HttpError(502, "upstream_llm_error", "Claude no devolvió sugerencias válidas", true);
  }
  if (!parsed.success) throw new HttpError(502, "upstream_llm_error", "Claude no devolvió sugerencias válidas", true);
  // La persona solo se sugiere si es conocida o aparece literalmente en el texto.
  const s = parsed.data;
  const known = req.people.find((p) => p.toLowerCase() === s.person?.toLowerCase());
  const literal = s.person && req.text.toLowerCase().includes(s.person.toLowerCase());
  return { ...s, person: known ?? (literal ? s.person : null), steps: s.size === "L" ? s.steps : [] };
}
