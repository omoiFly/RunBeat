import { describe, expect, it } from "vitest";
import type { BeatTrackSettings } from "../domain/types";
import { beatTrackGainForReference, generateBeatHit, generateBeatTrack, generateBeatTrackRange } from "./beatTrack";

const customSettings: BeatTrackSettings = {
  sound: "custom",
  gainDb: 0,
  accentEvery: 0,
  alternateFeet: false,
  duckingEnabled: false
};

describe("custom beat track", () => {
  it("places the uploaded one-shot on every target step", () => {
    const [left, right] = generateBeatTrack(1.1, 120, 1_000, customSettings, 0, {
      channels: [Float32Array.from([1, 0.5])],
      sampleRate: 1_000
    });
    expect(left[0]).toBeCloseTo(1);
    expect(left[1]).toBeCloseTo(0.5);
    expect(left[500]).toBeCloseTo(1);
    expect(left[1_000]).toBeCloseTo(1);
    expect(right).toEqual(left);
  });

  it("reports when a custom sample needs to be uploaded again", () => {
    expect(() => generateBeatTrack(1, 180, 1_000, customSettings)).toThrow("重新上传");
  });
});

describe("beat track gain staging", () => {
  it("maps the new -10 dB default to the old raw 0 dB strength", () => {
    const sample = {
      channels: [Float32Array.from([1])],
      sampleRate: 1_000
    };
    const baselineGain = beatTrackGainForReference({ ...customSettings, gainDb: -10 }, 1_000, -14, sample);
    const zeroGain = beatTrackGainForReference(customSettings, 1_000, -14, sample);
    const maximumGain = beatTrackGainForReference({ ...customSettings, gainDb: 10 }, 1_000, -14, sample);
    const quieterReferenceGain = beatTrackGainForReference({ ...customSettings, gainDb: -10 }, 1_000, -24, sample);
    expect(baselineGain).toBeCloseTo(1, 6);
    expect(20 * Math.log10(zeroGain / baselineGain)).toBeCloseTo(10, 5);
    expect(20 * Math.log10(maximumGain / baselineGain)).toBeCloseTo(20, 5);
    expect(20 * Math.log10(quieterReferenceGain / baselineGain)).toBeCloseTo(-10, 5);
  });
});

describe("chunked beat track", () => {
  it("matches one-shot generation without resetting accents or left/right feet", () => {
    const settings: BeatTrackSettings = {
      sound: "wood",
      gainDb: -3,
      accentEvery: 4,
      alternateFeet: true,
      duckingEnabled: false
    };
    const sampleRate = 1_000;
    const frames = 4_317;
    const full = generateBeatTrack(frames / sampleRate, 173, sampleRate, settings);
    const joined = [new Float32Array(frames), new Float32Array(frames)];
    for (let start = 0; start < frames; start += 337) {
      const count = Math.min(337, frames - start);
      const chunk = generateBeatTrackRange(start, count, 173, sampleRate, settings);
      joined[0].set(chunk[0], start);
      joined[1].set(chunk[1], start);
    }
    expect(joined[0]).toEqual(full[0]);
    expect(joined[1]).toEqual(full[1]);
  });

  it("generates the same indexed one-shot used by the live Web Audio scheduler", () => {
    const settings: BeatTrackSettings = {
      sound: "wood",
      gainDb: -3,
      accentEvery: 4,
      alternateFeet: true,
      duckingEnabled: false
    };
    const sampleRate = 1_000;
    const full = generateBeatTrack(1.1, 120, sampleRate, settings);
    const first = generateBeatHit(0, sampleRate, settings);
    const second = generateBeatHit(1, sampleRate, settings);
    expect(first[0]).toEqual(full[0].slice(0, first[0].length));
    expect(first[1]).toEqual(full[1].slice(0, first[1].length));
    expect(second[0]).toEqual(full[0].slice(500, 500 + second[0].length));
    expect(second[1]).toEqual(full[1].slice(500, 500 + second[1].length));
  });
});
