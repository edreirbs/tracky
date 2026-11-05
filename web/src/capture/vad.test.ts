import { describe, expect, it } from "vitest";
import { floatToInt16, SAMPLE_RATE, type SpeechChunk, VadSegmenter } from "./vad.js";

const BLOCK = 1600;
const silence = () => new Float32Array(BLOCK).map(() => (Math.random() - 0.5) * 0.0005);
const voice = (i: number) => new Float32Array(BLOCK).map((_, k) => 0.3 * Math.sin((2 * Math.PI * 220 * (i * BLOCK + k)) / SAMPLE_RATE));

function feed(seq: Array<"s" | "v">) {
  const chunks: SpeechChunk[] = [];
  const vad = new VadSegmenter((c) => chunks.push(c));
  seq.forEach((t, i) => vad.push(t === "s" ? silence() : voice(i)));
  vad.flush();
  return chunks;
}

describe("VadSegmenter", () => {
  it("detecta una frase y la corta tras el silencio", () => {
    const chunks = feed([...Array(20).fill("s"), ...Array(20).fill("v"), ...Array(15).fill("s")]);
    expect(chunks).toHaveLength(1);
    // Empieza ~2 s (con pre-roll de 300 ms) y dura ~2 s de voz + silencio de cola.
    expect(chunks[0]!.startMs).toBeGreaterThanOrEqual(1600);
    expect(chunks[0]!.startMs).toBeLessThanOrEqual(2000);
    expect(chunks[0]!.pcm.length / SAMPLE_RATE).toBeGreaterThan(2);
  });

  it("descarta ruidos muy cortos", () => {
    expect(feed([...Array(20).fill("s"), "v", ...Array(15).fill("s")])).toHaveLength(0);
  });

  it("corta frases largas a 15 s", () => {
    const chunks = feed([...Array(10).fill("s"), ...Array(200).fill("v")]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.pcm.length / SAMPLE_RATE <= 15.5)).toBe(true);
  });
});

describe("floatToInt16", () => {
  it("satura y convierte", () => {
    expect(Array.from(floatToInt16(new Float32Array([0, 1, -1, 2])))).toEqual([0, 32767, -32768, 32767]);
  });
});

describe("VadSegmenter: ruido", () => {
  it("descarta fragmentos con poca voz (ruido intermitente)", () => {
    // Un bloque "fuerte" seguido de mucho silencio de cola no llega al 35 % de voz.
    const chunks: SpeechChunk[] = [];
    const vad = new VadSegmenter((c) => chunks.push(c), { hangoverMs: 3000, minSpeechMs: 100 });
    [...Array(20).fill("s"), "v", ...Array(40).fill("s")].forEach((t, i) => vad.push(t === "s" ? silence() : voice(i)));
    vad.flush();
    expect(chunks).toHaveLength(0);
  });
});
