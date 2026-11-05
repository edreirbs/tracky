import { describe, expect, it } from "vitest";
import { ClaudeOutput, CLAUDE_OUTPUT_JSON_SCHEMA, CreateNoteRequest } from "./schemas.js";
import { dedupeEcho, formatTimestamp, toTurns, turnsToPlainText } from "./transcript.js";

describe("formatTimestamp", () => {
  it("formatea minutos y horas", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(61_500)).toBe("01:01");
    expect(formatTimestamp(3_723_000)).toBe("1:02:03");
  });
});

describe("toTurns", () => {
  it("agrupa segmentos consecutivos del mismo hablante y ordena por tiempo", () => {
    const turns = toTurns(
      [
        { startMs: 5000, endMs: 7000, channel: 1, text: "Buenas tardes." },
        { startMs: 0, endMs: 2000, channel: 0, text: "Hola a todos." },
        { startMs: 2500, endMs: 4000, channel: 0, text: "Empezamos." },
        { startMs: 8000, endMs: 9000, channel: 1, text: "   " },
      ],
      "online",
    );
    expect(turns).toEqual([
      { startMs: 0, endMs: 4000, speaker: "Yo", text: "Hola a todos. Empezamos." },
      { startMs: 5000, endMs: 7000, speaker: "Otros", text: "Buenas tardes." },
    ]);
    expect(turnsToPlainText(turns)).toBe("[00:00] Yo: Hola a todos. Empezamos.\n[00:05] Otros: Buenas tardes.");
  });

  it("usa 'Participantes' en modo en persona", () => {
    expect(toTurns([{ startMs: 0, endMs: 1, channel: 0, text: "Hola" }], "in_person")[0]?.speaker).toBe("Participantes");
  });
});

describe("dedupeEcho", () => {
  it("descarta el eco del micrófono cuando coincide con el canal del sistema", () => {
    const out = dedupeEcho([
      { startMs: 1000, endMs: 3000, channel: 0, text: "El presupuesto del TECgpt sube." },
      { startMs: 1200, endMs: 3100, channel: 1, text: "El presupuesto de TECgpt sube" },
      { startMs: 9000, endMs: 9500, channel: 0, text: "De acuerdo." },
    ]);
    expect(out.map((s) => s.channel)).toEqual([1, 0]);
  });
});

describe("schemas", () => {
  it("el JSON Schema de Claude declara los mismos campos que el esquema zod", () => {
    expect([...CLAUDE_OUTPUT_JSON_SCHEMA.required].sort()).toEqual(Object.keys(ClaudeOutput.shape).sort());
  });

  it("rechaza campos desconocidos en la solicitud", () => {
    const base = {
      meetingId: "0193a5b2-7c1d-7e00-8000-000000000001",
      startedAt: "2026-11-04T16:00:00-06:00",
      durationSec: 60,
      mode: "online",
      templateId: "acta-junta",
      transcript: [],
    };
    expect(CreateNoteRequest.safeParse(base).success).toBe(true);
    expect(CreateNoteRequest.safeParse({ ...base, extraneo: "x" }).success).toBe(false);
  });
});

describe("limpieza de alucinaciones", () => {
  it("colapsa bucles y quita eco del prompt", async () => {
    const { cleanSegmentText, collapseRepeats } = await import("./transcript.js");
    expect(collapseRepeats("en el a long a long a long a long Toda la configuración")).toBe("en el a long Toda la configuración");
    expect(cleanSegmentText("Reunión de trabajo en español de la Universidad de México. Bueno, no sé")).toBe("Bueno, no sé");
    expect(cleanSegmentText("you")).toBe("");
    expect(cleanSegmentText("Sí, sí, de acuerdo.")).toBe("Sí, sí, de acuerdo.");
  });

  it("quita la misma frase repetida en segmentos seguidos", () => {
    const segs = [0, 1, 2, 3].map((i) => ({ startMs: i * 1000, endMs: i * 1000 + 900, channel: 0 as const, text: "It's not as if you can go to the school." }));
    const turns = toTurns(segs, "in_person");
    expect(turns).toHaveLength(1);
    expect(turns[0]!.text).toBe("It's not as if you can go to the school.");
  });
});

describe("nombres de participantes", () => {
  it("pone nombres a las voces y une turnos de la misma persona", async () => {
    const { applySpeakerNames } = await import("./transcript.js");
    const turns = [
      { startMs: 0, endMs: 1000, speaker: "Participante 1", text: "Hola, soy Ana." },
      { startMs: 1500, endMs: 2500, speaker: "Participante 3", text: "Sigo yo." },
      { startMs: 3000, endMs: 4000, speaker: "Participante 2", text: "Hola Ana." },
      { startMs: 4500, endMs: 5000, speaker: "Yo", text: "Bienvenidas." },
    ];
    const named = applySpeakerNames(turns, [
      { label: "Participante 1", name: "Ana López" },
      { label: "Participante 3", name: "Ana López" },
      { label: "Participante 2", name: null },
      { label: "Yo", name: "Otro" },
      { label: "Participante 4", name: "x\n".repeat(40) },
    ]);
    expect(named.map((t) => t.speaker)).toEqual(["Ana López", "Participante 2", "Yo"]);
    expect(named[0]!.text).toBe("Hola, soy Ana. Sigo yo.");
  });
});

describe("corrección de hablantes", () => {
  it("aplica solo correcciones válidas", async () => {
    const { applySpeakerFixes, turnsToPlainText } = await import("./transcript.js");
    const turns = [
      { startMs: 0, endMs: 1000, speaker: "Yo", text: "Hola." },
      { startMs: 2000, endMs: 3000, speaker: "Participante 1", text: "¿Me escuchan?" },
      { startMs: 4000, endMs: 5000, speaker: "Yo", text: "¿Me escuchan?" },
    ];
    expect(turnsToPlainText(turns, true).split("\n")[2]).toBe("[#3 00:04] Yo: ¿Me escuchan?");
    const fixed = applySpeakerFixes(turns, [
      { turn: 3, speaker: "Participante 1" },
      { turn: 9, speaker: "Otros" },
      { turn: 1, speaker: "Inventado" },
      { turn: 1.5, speaker: "Otros" },
    ]);
    expect(fixed.map((t) => t.speaker)).toEqual(["Yo", "Participante 1", "Participante 1"]);
    expect(turns[2]!.speaker).toBe("Yo");
  });
});
