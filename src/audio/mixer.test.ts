import { describe, expect, it } from "vitest";
import type { BeatTrackSettings } from "../domain/types";
import { mixTimeline, planTimeline, type RenderableTrack } from "./mixer";

const beatTrack: BeatTrackSettings = {
  sound: "click",
  gainDb: -14,
  accentEvery: 0,
  alternateFeet: false,
  duckingEnabled: false
};

function impulseTrack(length: number, impulse: number, phaseOffsetSeconds: number): RenderableTrack {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  left[impulse] = 0.5;
  right[impulse] = 0.5;
  return { channels: [left, right], phaseOffsetSeconds, phaseNudgeBeats: 0 };
}

describe("timeline phase alignment", () => {
  it("aligns every song to the absolute step grid, including later songs", () => {
    const output = mixTimeline([
      impulseTrack(800, 100, 0.1),
      impulseTrack(500, 200, 0.2)
    ], {
      sampleRate: 1_000,
      targetSpm: 120,
      transitionBars: 0,
      beatTrack,
      normalizeLoudness: false,
      loudnessLufs: -14,
      includeBeat: false
    });
    const impulses = Array.from(output[0], (sample, index) => sample !== 0 ? index : -1).filter((index) => index >= 0);
    expect(impulses).toEqual([500, 1_500]);
  });

  it("keeps an unknown song phase at its planned timeline start", () => {
    const output = mixTimeline([
      impulseTrack(750, 0, 0),
      { ...impulseTrack(300, 0, 0), phaseOffsetSeconds: undefined }
    ], {
      sampleRate: 1_000,
      targetSpm: 120,
      transitionBars: 0,
      beatTrack,
      normalizeLoudness: false,
      loudnessLufs: -14,
      includeBeat: false
    });
    const impulses = Array.from(output[0], (sample, index) => sample !== 0 ? index : -1).filter((index) => index >= 0);
    expect(impulses).toEqual([0, 750]);
  });

  it("generates the master beat grid independently of song phase detection", () => {
    const output = mixTimeline([], {
      sampleRate: 1_000,
      targetSpm: 120,
      transitionBars: 0,
      beatTrack,
      normalizeLoudness: false,
      loudnessLufs: -14,
      includeBeat: true,
      minimumDurationSeconds: 1
    });
    expect(output[0]).toHaveLength(1_000);
    expect(output[0].some((sample) => sample !== 0)).toBe(true);
  });

  it("plans exact starts and removes crossfade overlap from the final duration", () => {
    const tracks = [
      { ...impulseTrack(1_000, 0, 0), phaseOffsetSeconds: undefined },
      { ...impulseTrack(1_000, 0, 0), phaseOffsetSeconds: undefined }
    ];
    const plan = planTimeline(tracks, { sampleRate: 100, targetSpm: 240, transitionBars: 1 });
    expect(plan.entries.map((entry) => entry.startFrames)).toEqual([0, 900]);
    expect(plan.entries.map((entry) => entry.audibleStartFrames)).toEqual([0, 900]);
    expect(plan.durationFrames).toBe(1_900);
  });
});
