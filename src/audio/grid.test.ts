import { describe, expect, it } from "vitest";
import { beatSample, equalPowerGains, transitionDurationSeconds } from "./grid";

describe("master grid", () => {
  it("uses absolute rounding without cumulative drift", () => {
    const last = beatSample(10_000, 44_100, 180);
    expect(last).toBe(Math.round(10_000 * 44_100 / 3));
  });

  it("treats an MVP bar as four master steps", () => {
    expect(transitionDurationSeconds(8, 180)).toBeCloseTo(10.6666667, 6);
  });

  it("creates an equal-power midpoint", () => {
    const [outgoing, incoming] = equalPowerGains(0.5);
    expect(outgoing ** 2 + incoming ** 2).toBeCloseTo(1, 6);
  });
});
