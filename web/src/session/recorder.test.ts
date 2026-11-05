import { describe, expect, it } from "vitest";
import { silenceGap } from "./recorder.js";

describe("silenceGap", () => {
  it("rellena huecos largos del audio del sistema", () => {
    // 10 s esperados, 2 s recibidos, llega un bloque de 100 ms → faltan 7.9 s.
    expect(silenceGap(160_000, 32_000, 1600)).toBe(126_400);
  });
  it("ignora variaciones pequeñas y cuando va adelantado", () => {
    expect(silenceGap(16_000, 14_000, 1600)).toBe(0);
    expect(silenceGap(16_000, 20_000, 1600)).toBe(0);
  });
});
