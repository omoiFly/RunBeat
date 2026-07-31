import { describe, expect, it } from "vitest";
import type { BeatTrackSettings } from "../domain/types";
import { measureIntegratedLoudness, measureTruePeak, TRUE_PEAK_CEILING_DBTP } from "./loudness";
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

function sineTrack(amplitude: number, sampleRate = 44_100, seconds = 2): RenderableTrack {
  const channels = [new Float32Array(sampleRate * seconds), new Float32Array(sampleRate * seconds)];
  for (let frame = 0; frame < channels[0].length; frame += 1) {
    const sample = amplitude * Math.sin(2 * Math.PI * 1_000 * frame / sampleRate);
    channels[0][frame] = sample;
    channels[1][frame] = sample;
  }
  return { channels, phaseNudgeBeats: 0 };
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

  it("normalizes the music bus before adding a song-relative beat", () => {
    const options = {
      sampleRate: 44_100,
      targetSpm: 120,
      transitionBars: 0,
      beatTrack: { ...beatTrack, gainDb: -10 },
      normalizeLoudness: true,
      loudnessLufs: -20,
      includeBeat: true
    };
    const quiet = mixTimeline([sineTrack(0.01)], options);
    const loud = mixTimeline([sineTrack(0.1)], options);

    let maximumDifference = 0;
    for (let channel = 0; channel < quiet.length; channel += 1) {
      for (let frame = 0; frame < quiet[channel].length; frame += 1) {
        maximumDifference = Math.max(maximumDifference, Math.abs(quiet[channel][frame] - loud[channel][frame]));
      }
    }
    expect(maximumDifference).toBeLessThan(1e-5);
    expect(measureTruePeak(quiet)).toBeLessThanOrEqual(10 ** (TRUE_PEAK_CEILING_DBTP / 20) + 1e-5);
  });

  it("protects the final true peak at the extended +10 dB beat setting", () => {
    const output = mixTimeline([sineTrack(0.03)], {
      sampleRate: 44_100,
      targetSpm: 180,
      transitionBars: 0,
      beatTrack: { ...beatTrack, gainDb: 10 },
      normalizeLoudness: true,
      loudnessLufs: -14,
      includeBeat: true
    });

    expect(measureTruePeak(output)).toBeLessThanOrEqual(10 ** (TRUE_PEAK_CEILING_DBTP / 20) + 1e-5);
  });

  it("reaches the requested music loudness before final peak protection", () => {
    const output = mixTimeline([sineTrack(0.01)], {
      sampleRate: 44_100,
      targetSpm: 120,
      transitionBars: 0,
      beatTrack,
      normalizeLoudness: true,
      loudnessLufs: -20,
      includeBeat: false
    });
    expect(measureIntegratedLoudness(output, 44_100)).toBeCloseTo(-20, 1);
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
