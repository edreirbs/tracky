import { describe, expect, it } from "vitest";
import { encodeFrame, HEADER_BYTES } from "./protocol.js";

describe("encodeFrame", () => {
  it("coincide con el formato del puente (struct <IB3xQ + PCM16 LE)", () => {
    const buf = encodeFrame(7, 1, 123456, new Int16Array([1, -2, 32767]));
    const v = new DataView(buf);
    expect(v.getUint32(0, true)).toBe(7);
    expect(v.getUint8(4)).toBe(1);
    expect(v.getBigUint64(8, true)).toBe(123456n);
    expect(buf.byteLength).toBe(HEADER_BYTES + 6);
    expect(v.getInt16(HEADER_BYTES + 2, true)).toBe(-2);
  });
});

describe("pcm16ToFloat", () => {
  it("convierte PCM16 LE del puente a float32", async () => {
    const { pcm16ToFloat } = await import("./protocol.js");
    const buf = new ArrayBuffer(6);
    const v = new DataView(buf);
    v.setInt16(0, 16384, true);
    v.setInt16(2, -32768, true);
    v.setInt16(4, 0, true);
    expect(Array.from(pcm16ToFloat(buf))).toEqual([0.5, -1, 0]);
  });
});
