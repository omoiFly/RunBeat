import { describe, expect, it } from "vitest";
import { beatGridPhaseAfterSourceOffset, bestBeatGridPhase, chooseBpmCandidate, deriveTrackAnalysis, estimateGlobalBpmConfidence, standardDeviation } from "./bpm";
import type { RawTrackAnalysis } from "../domain/types";

function regularBeatTicks(bpm: number, count = 48, phaseSeconds = 0.08): number[] {
  return Array.from({ length: count }, (_, index) => phaseSeconds + index * 60 / bpm);
}

const raw: RawTrackAnalysis = {
  rawBpm: 88,
  rhythmBpm: 176.2,
  beatTicks: regularBeatTicks(176, 24, 0.4),
  bpmConfidence: 0.95,
  bpmIntervals: Array.from({ length: 23 }, () => 60 / 176),
  windowBpms: [88, 88.1, 87.9],
  bpmStdDev: 0.1,
  waveformPeaks: [],
  analyzedAt: 1
};

describe("BPM mapping", () => {
  it("maps half-time material to the closest effective step tempo", () => {
    const result = chooseBpmCandidate(88, 180, "auto");
    expect(result.effectiveBpm).toBe(176);
    expect(result.change).toBeCloseTo(2.2727, 3);
  });

  it("honours two steps per beat", () => {
    const result = chooseBpmCandidate(88, 180, "two-steps-per-beat");
    expect(result.stepsPerBeat).toBe(2);
    expect(result.bpm).toBe(88);
  });

  it("supports the walking cadence lower bound without forcing a running-tempo candidate", () => {
    const result = chooseBpmCandidate(120, 60, "auto");
    expect(result.effectiveBpm).toBe(60);
    expect(result.change).toBe(0);
  });

  it("supports the high-cadence upper bound", () => {
    const result = chooseBpmCandidate(115, 230, "auto");
    expect(result.effectiveBpm).toBe(230);
    expect(result.change).toBe(0);
  });

  it("derives reciprocal tempo and time ratios", () => {
    const result = deriveTrackAnalysis(raw, 180, "two-steps-per-beat");
    expect(result.tempoRatio).toBeCloseTo(180 / 176, 6);
    expect(result.timeRatio).toBeCloseTo(176 / 180, 6);
    expect(result.quality).toBe("excellent");
    expect(result.qualityFactors).toEqual({ tempoChange: "excellent", bpmConfidence: "excellent", phaseAlignment: "excellent" });
  });

  it("computes population standard deviation", () => {
    expect(standardDeviation([1, 2, 3])).toBeCloseTo(Math.sqrt(2 / 3), 6);
  });

  it("treats octave-equivalent detector and window estimates as agreement", () => {
    expect(estimateGlobalBpmConfidence(88, 176.2, [44, 88.1, 176, 87.9, 352])).toBeGreaterThan(0.95);
  });

  it("keeps an unsupported single estimate at low confidence", () => {
    expect(estimateGlobalBpmConfidence(120, undefined, [])).toBeCloseTo(0.15, 6);
  });

  it("uses all beat ticks and rejects isolated false ticks when fitting grid phase", () => {
    const interval = 60 / 180;
    const timeRatio = 1.25;
    const expected = 0.08;
    const ticks = Array.from({ length: 12 }, (_, index) => (expected + index * 2 * interval) / timeRatio);
    ticks.push(0.21 / timeRatio, 0.27 / timeRatio);
    expect(bestBeatGridPhase(ticks, timeRatio, 180)).toBeCloseTo(expected, 6);
  });

  it("rejects an ambiguous two-cluster beat phase", () => {
    const interval = 60 / 180;
    expect(bestBeatGridPhase([0, 0.002, interval - 0.002, interval / 2, interval / 2 + 0.002, interval / 2 - 0.002], 1, 180)).toBeUndefined();
  });

  it("does not disguise accumulated BPM drift as a successful fixed-ratio phase lock", () => {
    const targetInterval = 60 / 180;
    const actualInterval = targetInterval * 1.0015;
    const expected = 0.075;
    const ticks = Array.from({ length: 520 }, (_, index) => expected + index * actualInterval);
    expect(bestBeatGridPhase(ticks, 1, 180)).toBeUndefined();
  });

  it("refines the actual stretch ratio before locking phase on a long track", () => {
    const effectiveBpm = 150.12;
    const expectedSourcePhase = 0.075;
    const ticks = Array.from({ length: 520 }, (_, index) => expectedSourcePhase + index * 60 / effectiveBpm);
    const analysis = deriveTrackAnalysis({
      ...raw,
      rawBpm: 74.9,
      rhythmBpm: effectiveBpm,
      beatTicks: ticks,
      bpmConfidence: 0.98
    }, 180, "auto");
    expect(analysis.phaseAlignmentModel).toBe("beat-refined");
    expect(analysis.normalizedBpm).toBeCloseTo(effectiveBpm, 3);
    expect(analysis.timeRatio).toBeCloseTo(effectiveBpm / 180, 6);
    expect(analysis.phaseCoverage).toBeGreaterThan(0.99);
    expect(analysis.phaseOffsetSeconds).toBeCloseTo(expectedSourcePhase * analysis.timeRatio, 5);
  });

  it("tolerates occasional missing and false beat ticks while refining a long track", () => {
    const effectiveBpm = 179.86;
    const ticks = Array.from({ length: 480 }, (_, index) => 0.06 + index * 60 / effectiveBpm)
      .filter((_, index) => index % 47 !== 0);
    ticks.push(12.345, 48.765, 93.21);
    const analysis = deriveTrackAnalysis({
      ...raw,
      rawBpm: 89.7,
      rhythmBpm: effectiveBpm,
      beatTicks: ticks,
      bpmConfidence: 0.98
    }, 180, "auto");
    expect(analysis.normalizedBpm).toBeCloseTo(effectiveBpm, 2);
    expect(analysis.phaseAlignmentModel).toBe("beat-refined");
    expect(analysis.phaseCoverage).toBeGreaterThan(0.98);
    expect(analysis.phaseOffsetSeconds).toBeDefined();
  });

  it("keeps the global model when beat refinement does not improve phase", () => {
    const effectiveBpm = 168;
    const ticks = Array.from({ length: 420 }, (_, index) => 0.08 + index * 60 / effectiveBpm);
    const analysis = deriveTrackAnalysis({
      ...raw,
      rawBpm: 84,
      rhythmBpm: effectiveBpm,
      beatTicks: ticks,
      bpmConfidence: 0.98
    }, 180, "auto");
    expect(analysis.phaseAlignmentModel).toBe("global-bpm");
    expect(analysis.normalizedBpm).toBe(effectiveBpm);
    expect(analysis.bpmRefinementPercent).toBeUndefined();
    expect(analysis.phaseCoverage).toBeGreaterThan(0.99);
  });

  it("adjusts beat phase when the source is trimmed", () => {
    expect(beatGridPhaseAfterSourceOffset(0.1, 0.2, 1, 120)).toBeCloseTo(0.4, 6);
  });

  it("rates speed-up changes up to twenty percent as good", () => {
    const analysis = deriveTrackAnalysis({ ...raw, rawBpm: 157, rhythmBpm: 157, beatTicks: regularBeatTicks(157), windowBpms: [157, 157, 157], bpmConfidence: 0.95 }, 180, "one-step-per-beat");
    expect(analysis.tempoChangePercent).toBeLessThan(20);
    expect(analysis.quality).toBe("good");
  });

  it("rates speed-up changes through thirty percent as acceptable", () => {
    const analysis = deriveTrackAnalysis({ ...raw, rawBpm: 144, rhythmBpm: 144, beatTicks: regularBeatTicks(144), windowBpms: [144, 144, 144], bpmConfidence: 0.95 }, 180, "one-step-per-beat");
    expect(analysis.tempoChangePercent).toBe(25);
    expect(analysis.quality).toBe("acceptable");
    expect(analysis.warnings).toContain("加速幅度较大（超过 +20%）");
  });

  it("rates speed-up changes above thirty percent as not recommended", () => {
    const analysis = deriveTrackAnalysis({ ...raw, rawBpm: 138, rhythmBpm: 138, beatTicks: regularBeatTicks(138), windowBpms: [138, 138, 138], bpmConfidence: 0.95 }, 180, "one-step-per-beat");
    expect(analysis.tempoChangePercent).toBeGreaterThan(30);
    expect(analysis.quality).toBe("not-recommended");
    expect(analysis.warnings).toContain("加速超过 +30%，可能明显影响听感");
  });

  it("rates the same percentage more strictly when it slows the track down", () => {
    const faster = deriveTrackAnalysis({ ...raw, rawBpm: 167, rhythmBpm: 167, beatTicks: regularBeatTicks(167), windowBpms: [167, 167, 167], bpmConfidence: 0.95 }, 180, "one-step-per-beat");
    const slower = deriveTrackAnalysis({ ...raw, rawBpm: 196, rhythmBpm: 196, beatTicks: regularBeatTicks(196), windowBpms: [196, 196, 196], bpmConfidence: 0.95 }, 180, "one-step-per-beat");

    expect(faster.tempoChangePercent).toBeGreaterThan(7);
    expect(slower.tempoChangePercent).toBeLessThan(-8);
    expect(faster.qualityFactors?.tempoChange).toBe("excellent");
    expect(slower.qualityFactors?.tempoChange).toBe("good");
  });

  it("ranks an unlocked phase below a tempo change above twenty percent", () => {
    const analysis = deriveTrackAnalysis({ ...raw, beatTicks: [] }, 180, "two-steps-per-beat");
    expect(Math.abs(analysis.tempoChangePercent)).toBeLessThan(6);
    expect(analysis.qualityFactors).toEqual({ tempoChange: "excellent", bpmConfidence: "excellent", phaseAlignment: "needs-calibration" });
    expect(analysis.quality).toBe("needs-calibration");
    expect(analysis.warnings.join(" ")).toContain("手动设置歌曲首拍");
  });

  it("requires calibration when a locked phase is still too weak", () => {
    const period = 60 / 180;
    const ticks = Array.from({ length: 100 }, (_, index) => 0.05 + index * period + (index >= 68 ? period / 2 : 0));
    const analysis = deriveTrackAnalysis({ ...raw, rawBpm: 180, rhythmBpm: 180, beatTicks: ticks }, 180, "one-step-per-beat");
    expect(analysis.phaseOffsetSeconds).toBeDefined();
    expect(analysis.phaseCoverage).toBeCloseTo(0.68, 2);
    expect(analysis.qualityFactors?.phaseAlignment).toBe("needs-calibration");
    expect(analysis.quality).toBe("needs-calibration");
  });

  it("treats a manually supplied first beat as a reliable phase", () => {
    const analysis = deriveTrackAnalysis({ ...raw, beatTicks: [] }, 180, "two-steps-per-beat", undefined, 0.2);
    expect(analysis.phaseAlignmentModel).toBe("manual");
    expect(analysis.qualityFactors?.phaseAlignment).toBe("excellent");
    expect(analysis.quality).toBe("excellent");
  });
});
