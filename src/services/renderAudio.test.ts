import { describe, expect, it, vi } from "vitest";
import type { Track } from "../domain/types";
import { prepareTrackClip, previewSourceRange, previewStartBounds } from "./renderAudio";

function makeTrack(): Track {
  return {
    id: "track-1",
    source: {
      id: "track-1",
      fileName: "track.wav",
      fileSize: 1,
      mimeType: "audio/wav",
      lastModified: 1,
      available: true
    },
    durationSeconds: 60,
    status: "complete",
    edit: {
      inclusionMode: "auto",
      sourceInSeconds: 10,
      sourceOutSeconds: 50,
      phaseNudgeBeats: 0.5
    },
    order: 0,
    derivedAnalysis: {
      normalizedBpm: 120,
      detectorOctaveFactor: 1,
      stepsPerBeat: 1,
      effectiveFactor: 1,
      targetSpm: 120,
      tempoRatio: 0.5,
      timeRatio: 2,
      tempoChangePercent: -50,
      phaseOffsetSeconds: 0.2,
      quality: "not-recommended",
      warnings: []
    }
  };
}

describe("shared preview/export audio preparation", () => {
  it("selects any requested preview start inside the edited source range", () => {
    expect(previewStartBounds(makeTrack(), 60)).toEqual({ minSeconds: 10, maxSeconds: 30, previewDurationSeconds: 20 });
    expect(previewSourceRange(makeTrack(), 60, 10)).toEqual({ startSeconds: 10, endSeconds: 30 });
    expect(previewSourceRange(makeTrack(), 60, 17.5)).toEqual({ startSeconds: 17.5, endSeconds: 37.5 });
    expect(previewSourceRange(makeTrack(), 60, 30)).toEqual({ startSeconds: 30, endSeconds: 50 });
  });

  it("centers by default and clamps the requested start to the available bounds", () => {
    expect(previewStartBounds(makeTrack(), 32)).toEqual({ minSeconds: 10, maxSeconds: 12, previewDurationSeconds: 20 });
    expect(previewSourceRange(makeTrack(), 32)).toEqual({ startSeconds: 11, endSeconds: 31 });
    expect(previewSourceRange(makeTrack(), 32, -10)).toEqual({ startSeconds: 10, endSeconds: 30 });
    expect(previewSourceRange(makeTrack(), 32, 99)).toEqual({ startSeconds: 12, endSeconds: 32 });
  });

  it("uses the whole range when the edited clip is shorter than the preview", () => {
    expect(previewStartBounds(makeTrack(), 18)).toEqual({ minSeconds: 10, maxSeconds: 10, previewDurationSeconds: 8 });
    expect(previewSourceRange(makeTrack(), 18, 15)).toEqual({ startSeconds: 10, endSeconds: 18 });
  });

  it("uses exact clipped frames, the requested ratio and trim-adjusted phase", async () => {
    const left = Float32Array.from({ length: 50 }, (_, index) => index);
    const right = Float32Array.from({ length: 50 }, (_, index) => -index);
    const stretch = vi.fn(async (channels: Float32Array[], ratio: number, sampleRate: number) => {
      expect(channels[0]).toEqual(left.slice(10, 31));
      expect(channels[1]).toEqual(right.slice(10, 31));
      expect(ratio).toBe(2);
      expect(sampleRate).toBe(10);
      return channels.map((channel) => new Float32Array(channel.length * ratio));
    });

    const result = await prepareTrackClip(
      { channels: [left, right], sampleRate: 10, duration: 5 },
      makeTrack(),
      { targetSpm: 120 },
      { startSeconds: 1.04, endSeconds: 3.06 },
      stretch
    );

    expect(stretch).toHaveBeenCalledOnce();
    expect(result.range).toEqual({ startSeconds: 1, endSeconds: 3.1 });
    expect(result.audio.channels[0]).toHaveLength(42);
    expect(result.audio.phaseOffsetSeconds).toBeCloseTo(0.2, 8);
    expect(result.audio.phaseNudgeBeats).toBe(0.5);
  });

  it("rejects an empty edited range before starting Rubber Band", async () => {
    const stretch = vi.fn();
    await expect(prepareTrackClip(
      { channels: [new Float32Array(10), new Float32Array(10)], sampleRate: 10, duration: 1 },
      makeTrack(),
      { targetSpm: 120 },
      { startSeconds: 1, endSeconds: 1 },
      stretch
    )).rejects.toThrow("音频片段为空");
    expect(stretch).not.toHaveBeenCalled();
  });
});
