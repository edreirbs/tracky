import { describe, expect, it } from "vitest";
import { pollDelayMs } from "./client.js";

describe("pollDelayMs", () => {
  it("empieza en 1.5 s y se alarga hasta 5 s", () => {
    expect(pollDelayMs(0)).toBe(1500);
    expect(pollDelayMs(3)).toBe(3000);
    expect(pollDelayMs(50)).toBe(5000);
  });
});
