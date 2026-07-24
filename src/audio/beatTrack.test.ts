import { describe, expect, it } from "vitest";
import type { BeatTrackSettings } from "../domain/types";
import { generateBeatTrack, generateBeatTrackRange } from "./beatTrack";

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
});
