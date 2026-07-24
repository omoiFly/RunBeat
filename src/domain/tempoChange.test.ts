import { describe, expect, it } from "vitest";
import {
  isTempoChangeWithinRange,
  tempoChangePerceptualCost,
  tempoChangeQuality,
  tempoChangeRange
} from "./tempoChange";

describe("direction-aware tempo change policy", () => {
  it.each([
    [4, 4, 6],
    [6, 6, 10],
    [10, 10, 15],
    [15, 15, 20],
    [20, 20, 30]
  ])("maps the %s preset to -%s%% / +%s%%", (preset, slowDown, speedUp) => {
    expect(tempoChangeRange(preset)).toEqual({
      slowDownPercent: slowDown,
      speedUpPercent: speedUp
    });
  });

  it("accepts up to 30% speed-up while keeping the slowdown limit at 20%", () => {
    expect(isTempoChangeWithinRange(30, 20)).toBe(true);
    expect(isTempoChangeWithinRange(30.01, 20)).toBe(false);
    expect(isTempoChangeWithinRange(-20, 20)).toBe(true);
    expect(isTempoChangeWithinRange(-20.01, 20)).toBe(false);
  });

  it("rates the same magnitude more strictly when it slows the track down", () => {
    expect(tempoChangeQuality(8)).toBe("excellent");
    expect(tempoChangeQuality(-8)).toBe("good");
    expect(tempoChangeQuality(25)).toBe("acceptable");
    expect(tempoChangeQuality(-25)).toBe("not-recommended");
  });

  it("uses a lower perceptual cost for speed-up", () => {
    expect(tempoChangePerceptualCost(6)).toBe(4);
    expect(tempoChangePerceptualCost(10)).toBe(6);
    expect(tempoChangePerceptualCost(20)).toBe(15);
    expect(tempoChangePerceptualCost(30)).toBeCloseTo(20);
    expect(tempoChangePerceptualCost(-20)).toBe(20);
  });

  it("treats the unlimited preset as unbounded", () => {
    expect(isTempoChangeWithinRange(500, 100)).toBe(true);
    expect(isTempoChangeWithinRange(-99.9, 100)).toBe(true);
  });
});
