import { describe, expect, it } from "vitest";
import { echoScore, echoScoreAt, SystemRing } from "./echo.js";

const SR = 16_000;

/** "Voz" sintética: ruido modulado por sílabas aleatorias (envolvente irregular). */
function speech(seconds: number, seed: number): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const out = new Float32Array(seconds * SR);
  let gain = 0;
  for (let i = 0; i < out.length; i++) {
    if (i % 1600 === 0) gain = rnd() < 0.35 ? 0 : 0.05 + rnd() * 0.3;
    out[i] = (rnd() - 0.5) * gain;
  }
  return out;
}

function delayed(x: Float32Array, samples: number, gain: number, noiseSeed: number): Float32Array {
  const noise = speech(x.length / SR, noiseSeed);
  return x.map((_, i) => (i >= samples ? x[i - samples]! * gain : 0) + noise[i]! * 0.01);
}

describe("echoScore", () => {
  it("detecta eco retrasado y atenuado", () => {
    const sys = speech(6, 1);
    const ring = new SystemRing(30);
    ring.push(sys);
    const mic = delayed(sys, 3200, 0.2, 9).slice(SR * 2, SR * 4); // 2 s de micrófono, eco con 200 ms de retraso
    expect(echoScoreAt(ring, mic, SR * 2)).toBeGreaterThan(0.7);
  });

  it("voz propia distinta del sistema: puntaje bajo", () => {
    const ring = new SystemRing(30);
    ring.push(speech(6, 1));
    expect(echoScoreAt(ring, speech(2, 42), SR * 2)).toBeLessThan(0.5);
  });

  it("bocinas calladas: no es eco", () => {
    const ring = new SystemRing(30);
    ring.push(new Float32Array(SR * 6));
    expect(echoScoreAt(ring, speech(2, 3), SR * 2)).toBe(0);
    expect(echoScore(new Float32Array(100), new Float32Array(100))).toBe(0);
  });
});
