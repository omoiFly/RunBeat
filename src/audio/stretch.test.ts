import { describe, expect, it } from "vitest";
import { stretchChannel } from "./stretch";

describe("overlap-add stretch fallback", () => {
  it("returns the requested duration while retaining zero crossings", () => {
    const rate = 8_000;
    const input = Float32Array.from({ length: rate }, (_, index) => Math.sin(2 * Math.PI * 220 * index / rate));
    const output = stretchChannel(input, { timeRatio: 1.1, windowSize: 512, analysisHop: 128 });
    expect(output.length).toBe(Math.round(input.length * 1.1));
    const crossings = (signal: Float32Array) => signal.reduce((count, value, index) => count + (index > 0 && value >= 0 && signal[index - 1] < 0 ? 1 : 0), 0);
    expect(crossings(output) / 1.1).toBeCloseTo(crossings(input), -1);
  });
});
