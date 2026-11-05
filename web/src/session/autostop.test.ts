import { describe, expect, it } from "vitest";
import { CallEndDetector } from "./autostop.js";

describe("CallEndDetector", () => {
  it("termina cuando Teams suelta el micrófono (con gracia)", () => {
    const d = new CallEndDetector();
    expect(d.update(10_000, ["Teams"], 10_000, false)).toBe(false);
    expect(d.update(60_000, ["Teams"], 59_000, false)).toBe(false);
    expect(d.update(66_000, [], 59_000, false)).toBe(false); // 6 s: aún en gracia
    expect(d.update(69_000, [], 59_000, false)).toBe(true);
  });

  it("si el puente no responde no concluye nada", () => {
    const d = new CallEndDetector();
    d.update(10_000, ["Zoom"], 0, false);
    expect(d.update(600_000, null, 0, false)).toBe(false);
  });

  it("respaldo: 5 min sin sonido de los demás (sin app de llamada)", () => {
    const d = new CallEndDetector();
    expect(d.update(200_000, [], 100_000, false)).toBe(false);
    expect(d.update(400_001, [], 100_000, false)).toBe(true);
    d.reset(400_001);
    expect(d.update(500_000, [], 100_000, false)).toBe(false);
  });

  it("dejar de compartir termina de inmediato", () => {
    expect(new CallEndDetector().update(1000, null, 0, true)).toBe(true);
  });
});
