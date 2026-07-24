// @vitest-environment node
import { describe, expect, it } from "vitest";
import essentiaPackage from "essentia.js";
import { MAX_TARGET_SPM } from "../domain/types";
import { consumeEssentiaVector, disposeEssentiaVector } from "./essentiaVector";

describe("Essentia.js integration", () => {
  it("loads the pinned WASM and detects a click tempo", { timeout: 30_000 }, () => {
    const sampleRate = 44_100;
    const seconds = 12;
    const bpm = 176;
    const signal = new Float32Array(sampleRate * seconds);
    const beatFrames = sampleRate * 60 / bpm;
    for (let frame = 0; frame < signal.length; frame += 1) {
      const phase = frame % beatFrames;
      if (phase < 1200) signal[frame] = Math.sin(2 * Math.PI * 880 * phase / sampleRate) * Math.exp(-phase / 250);
    }
    const essentia = new essentiaPackage.Essentia(essentiaPackage.EssentiaWASM);
    let vector: EssentiaVectorFloat | undefined;
    try {
      vector = essentia.arrayToVector(signal);
      const result = essentia.PercivalBpmEstimator(vector, undefined, undefined, undefined, undefined, MAX_TARGET_SPM, 50, sampleRate);
      expect(result.bpm).toBeGreaterThan(80);
      expect(result.bpm).toBeLessThan(MAX_TARGET_SPM);
      const rhythm = essentia.RhythmExtractor2013(vector, MAX_TARGET_SPM, "multifeature", 40);
      const ticks = consumeEssentiaVector(rhythm.ticks);
      consumeEssentiaVector(rhythm.estimates);
      consumeEssentiaVector(rhythm.bpmIntervals);
      expect(ticks.length).toBeGreaterThan(20);
      expect(ticks[0]).toBeGreaterThanOrEqual(0);
    } finally {
      disposeEssentiaVector(vector);
      essentia.shutdown();
    }
  });
});
