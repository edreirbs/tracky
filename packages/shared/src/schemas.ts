import { z } from "zod";

/** Plantillas de resumen disponibles (ver prompts/templates/). */
export const TEMPLATE_IDS = ["general", "acta-junta", "ejecutivo", "seguimiento-proyecto", "one-on-one", "clase-taller"] as const;
export const TemplateId = z.enum(TEMPLATE_IDS);
export type TemplateId = z.infer<typeof TemplateId>;

export const MAX_SEGMENTS = 20_000;
export const MAX_SEGMENT_TEXT = 4_000;

/** 0 = micrófono ("Yo"), 1 = audio del sistema ("Otros"). */
export const Channel = z.union([z.literal(0), z.literal(1)]);
export type Channel = z.infer<typeof Channel>;

export const TranscriptSegment = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    channel: Channel,
    speaker: z.string().max(40).optional(),
    text: z.string().max(MAX_SEGMENT_TEXT),
  })
  .strict();
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const ManualNote = z.object({ atMs: z.number().int().nonnegative(), text: z.string().min(1).max(1000) }).strict();
export type ManualNote = z.infer<typeof ManualNote>;

export const MeetingMode = z.enum(["online", "in_person"]);
export type MeetingMode = z.infer<typeof MeetingMode>;

export const PlatformHint = z.enum(["teams", "zoom", "meet", "other"]).nullable();

export const TranscriptionInfo = z
  .object({ engine: z.string().max(40), model: z.string().max(120), device: z.string().max(20).optional() })
  .strict();

export const CreateNoteRequest = z
  .object({
    meetingId: z.uuid(),
    startedAt: z.iso.datetime({ offset: true }),
    durationSec: z.number().int().nonnegative().max(6 * 3600),
    mode: MeetingMode,
    platformHint: PlatformHint.default(null),
    templateId: TemplateId,
    extraInstructions: z.string().max(1000).optional(),
    markedImportant: z.boolean().default(false),
    manualNotes: z.array(ManualNote).max(200).default([]),
    transcription: TranscriptionInfo.optional(),
    transcript: z.array(TranscriptSegment).max(MAX_SEGMENTS),
  })
  .strict();
export type CreateNoteRequest = z.infer<typeof CreateNoteRequest>;
export type CreateNoteInput = z.input<typeof CreateNoteRequest>;

export const Estado = z.enum(["Normal", "Importante"]);
export type Estado = z.infer<typeof Estado>;

/** Solo regenerar el resumen pasa por la API; etiqueta y estado se editan directo en Supabase (RLS). */
export const PatchNoteRequest = z.object({ templateId: TemplateId, extraInstructions: z.string().max(1000).optional() }).strict();
export type PatchNoteRequest = z.infer<typeof PatchNoteRequest>;

/** Salida estructurada de Claude (contracts/claude-output.md). */
export const ActionItem = z
  .object({ task: z.string(), owner: z.string().nullable(), due: z.string().nullable() })
  .strict();
export type ActionItem = z.infer<typeof ActionItem>;

/** Nombre inferido para una voz "Participante N" (null si la transcripción no lo deja claro). */
export const SpeakerName = z.object({ label: z.string(), name: z.string().nullable(), evidence: z.string() }).strict();
export type SpeakerName = z.infer<typeof SpeakerName>;

export const ClaudeOutput = z
  .object({
    title: z.string(),
    tag: z.string(),
    tag_confidence: z.number(),
    tag_alternatives: z.array(z.string()),
    tag_rationale: z.string(),
    estado: Estado,
    estado_rationale: z.string(),
    summary_markdown: z.string(),
    key_points: z.array(z.string()),
    decisions: z.array(z.string()),
    action_items: z.array(ActionItem),
    next_steps_short: z.string(),
    language: z.string(),
    speaker_names: z.array(SpeakerName),
    speaker_fixes: z.array(z.object({ turn: z.number(), speaker: z.string() }).strict()),
  })
  .strict();
export type ClaudeOutput = z.infer<typeof ClaudeOutput>;

/** JSON Schema equivalente para `output_config.format` (debe coincidir con ClaudeOutput). */
export const CLAUDE_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "tag",
    "tag_confidence",
    "tag_alternatives",
    "tag_rationale",
    "estado",
    "estado_rationale",
    "summary_markdown",
    "key_points",
    "decisions",
    "action_items",
    "next_steps_short",
    "language",
    "speaker_names",
    "speaker_fixes",
  ],
  properties: {
    title: { type: "string", description: "≤120 caracteres, estilo '<Tema> – <foco>'" },
    tag: { type: "string", description: "Exactamente una opción de <tag_catalog>" },
    tag_confidence: { type: "number", description: "0 a 1" },
    tag_alternatives: {
      type: "array",
      items: { type: "string" },
      description: "Hasta 2 etiquetas alternativas plausibles del catálogo, de más a menos probable",
    },
    tag_rationale: { type: "string", description: "Una frase" },
    estado: { type: "string", enum: ["Normal", "Importante"] },
    estado_rationale: { type: "string" },
    summary_markdown: { type: "string", description: "Resumen según la plantilla elegida" },
    key_points: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    action_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task", "owner", "due"],
        properties: {
          task: { type: "string" },
          owner: { type: ["string", "null"] },
          due: { type: ["string", "null"], description: "ISO 8601 si se mencionó; si no, null" },
        },
      },
    },
    next_steps_short: { type: "string", description: "≤600 caracteres, viñetas" },
    language: { type: "string", description: "Idioma dominante, p. ej. es-MX" },
    speaker_names: {
      type: "array",
      description: "Una entrada por cada etiqueta 'Participante N' de la transcripción",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "name", "evidence"],
        properties: {
          label: { type: "string", description: "Exactamente la etiqueta, p. ej. 'Participante 2'" },
          name: { type: ["string", "null"], description: "Nombre solo si la transcripción lo deja claro; si no, null" },
          evidence: { type: "string", description: "Pista breve usada, o cadena vacía" },
        },
      },
    },
    speaker_fixes: {
      type: "array",
      description: "Turnos con hablante claramente mal atribuido (#número de la transcripción). Vacío si no hay.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["turn", "speaker"],
        properties: {
          turn: { type: "integer", description: "Número del turno (#N)" },
          speaker: { type: "string", description: "Hablante correcto: una etiqueta que ya aparece en la transcripción, u 'Otros'" },
        },
      },
    },
  },
} as const;

export const Usage = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
});
export type Usage = z.infer<typeof Usage>;

export const NoteResult = z.object({
  noteId: z.uuid(),
  title: z.string(),
  tag: z.string(),
  tagConfidence: z.number(),
  tagAlternatives: z.array(z.string()).default([]),
  estado: Estado,
  templateId: TemplateId,
  model: z.string().nullable(),
  usage: Usage.nullable(),
  summaryPending: z.boolean().default(false),
  actionItems: z.array(z.object({ task: z.string(), owner: z.string().nullable(), due: z.string().nullable() })).default([]),
});
export type NoteResult = z.infer<typeof NoteResult>;

/** Eventos NDJSON de POST /v1/notes y PATCH /v1/notes/:id. */
export const NoteEvent = z.discriminatedUnion("event", [
  z.object({ event: z.literal("accepted"), meetingId: z.string() }),
  z.object({ event: z.literal("summarizing") }),
  z.object({ event: z.literal("saving") }),
  z.object({ event: z.literal("done"), result: NoteResult }),
  z.object({ event: z.literal("partial"), result: NoteResult, error: z.object({ type: z.string(), detail: z.string().optional() }) }),
  z.object({ event: z.literal("error"), error: z.object({ type: z.string(), detail: z.string().optional(), retryable: z.boolean() }) }),
]);
export type NoteEvent = z.infer<typeof NoteEvent>;


/** Problem Details (RFC 9457). */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  retryable: z.boolean().optional(),
});
export type Problem = z.infer<typeof Problem>;
