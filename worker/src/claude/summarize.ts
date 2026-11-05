import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_OUTPUT_JSON_SCHEMA, ClaudeOutput, formatTimestamp, type ManualNote, type Usage } from "@tracky/shared";
import type { Effort } from "../env.js";
import { SYSTEM_PROMPT, TEMPLATES } from "../generated/prompts.js";
import { HttpError } from "../lib/http.js";

/** ~150k tokens de transcripción; arriba de esto haría falta map-reduce (fuera de alcance v1). */
export const MAX_TRANSCRIPT_CHARS = 600_000;

export interface SummarizeInput {
  transcriptText: string;
  templateId: string;
  extraInstructions?: string | undefined;
  manualNotes: ManualNote[];
  markedImportant: boolean;
  startedAt: string;
  durationSec: number;
  mode: "online" | "in_person";
  platformHint: string | null;
  tags: TagInfo[];
  /** Nombre de la persona usuaria ("Yo"), si lo configuró. */
  ownerName?: string | null | undefined;
}

/** Etiqueta del catálogo del usuario (tabla tags; la define la configuración inicial). */
export interface TagInfo {
  name: string;
  description: string;
  signals: string[];
  is_fallback: boolean;
}

export function fallbackTag(tags: readonly TagInfo[]): string {
  return tags.find((t) => t.is_fallback)?.name ?? tags.find((t) => t.name === "Otros")?.name ?? tags[0]?.name ?? "Otros";
}

export interface SummarizeResult {
  output: ClaudeOutput;
  model: string;
  usage: Usage;
}

/** Catálogo del usuario con descripciones. Orden estable (caché del prompt). */
export function buildTagCatalog(tags: readonly TagInfo[]): string {
  return tags
    .map((t) => {
      const desc = t.description.trim() ? `: ${t.description.trim()}` : "";
      const signals = t.signals.length ? ` Señales: ${t.signals.join(", ")}.` : "";
      return `- ${t.name}${desc}${signals}`;
    })
    .join("\n");
}

export function buildSystem(templateId: string, tags: readonly TagInfo[]): string {
  const template = TEMPLATES[templateId];
  if (!template) throw new HttpError(400, "validation_error", `Plantilla desconocida: ${templateId}`);
  return [
    SYSTEM_PROMPT,
    `## Reglas de clasificación
1. Elige una sola etiqueta: el proyecto o tema que ocupó más tiempo o generó las decisiones principales.
2. Prefiere la etiqueta más específica.
3. Si nada encaja con confianza ≥ 0.6, usa "${fallbackTag(tags)}".
4. Nunca inventes etiquetas fuera del catálogo.`,
    `<tag_catalog>\n${buildTagCatalog(tags)}\n</tag_catalog>`,
    `<template name="${template.nombre}">\n${template.body}\n</template>`,
  ].join("\n\n");
}

export function buildUserMessage(i: SummarizeInput): string {
  const meta = [
    `Fecha de inicio: ${i.startedAt}`,
    `Duración: ${formatTimestamp(i.durationSec * 1000)}`,
    `Modalidad: ${i.mode === "online" ? `en línea${i.platformHint ? ` (${i.platformHint})` : ""}` : "en persona"}`,
    `Persona usuaria ("Yo"): ${i.ownerName?.trim() || "(sin nombre)"}`,
    `Marcada como importante por la persona usuaria: ${i.markedImportant ? "sí" : "no"}`,
  ].join("\n");
  const notes = i.manualNotes.length
    ? i.manualNotes.map((n) => `- [${formatTimestamp(n.atMs)}] ${n.text}`).join("\n")
    : "(ninguna)";
  const parts = [
    `<meeting_metadata>\n${meta}\n</meeting_metadata>`,
    `<manual_notes>\n${notes}\n</manual_notes>`,
    `<transcript>\n${i.transcriptText}\n</transcript>`,
  ];
  if (i.extraInstructions?.trim()) {
    parts.push(`<extra_instructions de="persona usuaria">\n${i.extraInstructions.trim()}\n</extra_instructions>`);
  }
  parts.push("Genera la nota de esta reunión.");
  return parts.join("\n\n");
}

export async function summarize(
  client: Anthropic,
  model: string,
  effort: Effort,
  input: SummarizeInput,
): Promise<SummarizeResult> {
  if (input.transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    throw new HttpError(413, "transcript_too_long", "La transcripción excede el máximo para un solo resumen");
  }
  const system = buildSystem(input.templateId, input.tags);
  const user = buildUserMessage(input);

  let maxTokens = 32_000;
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort, format: { type: "json_schema", schema: CLAUDE_OUTPUT_JSON_SCHEMA } },
      // Prefijo estable (instrucciones + catálogo + plantilla) → se cachea entre juntas.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: user }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new HttpError(422, "llm_refusal", "Claude no generó el resumen para este contenido");
    }
    if (message.stop_reason === "max_tokens") {
      maxTokens = 64_000;
      continue;
    }

    const text = message.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    let parsed: ReturnType<typeof ClaudeOutput.safeParse>;
    try {
      parsed = ClaudeOutput.safeParse(JSON.parse(text));
    } catch {
      continue;
    }
    if (!parsed.success) continue;

    const u = message.usage;
    return {
      output: parsed.data,
      model: message.model,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  }
  throw new HttpError(502, "upstream_llm_error", "Claude no devolvió una salida válida", true);
}

/** Aplica las reglas del contrato: etiqueta dentro del catálogo, confianza, alternativas válidas. */
export function normalizeTag(
  output: ClaudeOutput,
  tags: readonly TagInfo[],
): { tag: string; confidence: number; alternatives: string[] } {
  const valid = new Set(tags.map((t) => t.name));
  const alternatives = output.tag_alternatives.filter((t) => valid.has(t) && t !== output.tag).slice(0, 2);
  if (!valid.has(output.tag)) return { tag: fallbackTag(tags), confidence: 0, alternatives };
  return { tag: output.tag, confidence: Math.max(0, Math.min(1, output.tag_confidence)), alternatives };
}
