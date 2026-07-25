import { describe, expect, it, vi } from "vitest";
import type { Track } from "../domain/types";
import { prepareTrackClip } from "./renderAudio";

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

describe("export audio preparation", () => {
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
