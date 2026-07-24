import { describe, expect, it } from "vitest";
import type { Quality, Track } from "../domain/types";
import { sortTracks } from "./trackSorting";

function makeTrack(fileName: string, order: number, rawBpm?: number, change?: number, quality: Quality = "excellent"): Track {
  return {
    id: fileName,
    source: { id: fileName, fileName, fileSize: 1, mimeType: "audio/wav", lastModified: 1, available: true },
    durationSeconds: 60,
    status: rawBpm == null ? "queued" : "complete",
    rawAnalysis: rawBpm == null ? undefined : { rawBpm, beatTicks: [], bpmConfidence: rawBpm / 200, bpmIntervals: [], windowBpms: [], waveformPeaks: [], analyzedAt: 1 },
    derivedAnalysis: change == null ? undefined : {
      normalizedBpm: rawBpm ?? 0,
      detectorOctaveFactor: 1,
      stepsPerBeat: 1,
      effectiveFactor: 1,
      targetSpm: 180,
      tempoRatio: 1 + change / 100,
      timeRatio: 1 / (1 + change / 100),
      tempoChangePercent: change,
      quality,
      warnings: []
    },
    edit: { sourceInSeconds: 0, sourceOutSeconds: 60, phaseNudgeBeats: 0 },
    order
  };
}

describe("track sorting", () => {
  const tracks = [
    makeTrack("Song 10.wav", 0, 170, -5, "good"),
    makeTrack("Song 2.wav", 1, 180, 2, "excellent"),
    makeTrack("Pending.wav", 2)
  ];

  it("uses natural filename ordering", () => {
    expect(sortTracks(tracks, "filename", "asc").map((track) => track.source.fileName)).toEqual(["Pending.wav", "Song 2.wav", "Song 10.wav"]);
  });

  it("sorts numeric values while keeping unavailable analysis last", () => {
    expect(sortTracks(tracks, "raw-bpm", "desc").map((track) => track.source.fileName)).toEqual(["Song 2.wav", "Song 10.wav", "Pending.wav"]);
    expect(sortTracks(tracks, "tempo-change", "asc").map((track) => track.source.fileName)).toEqual(["Song 10.wav", "Song 2.wav", "Pending.wav"]);
  });

  it("sorts tempo changes by their signed percentages", () => {
    const faster = makeTrack("Faster.wav", 0, 170, 8);
    const slower = makeTrack("Slower.wav", 1, 190, -8);
    const fastThirty = makeTrack("Fast 30.wav", 2, 140, 30);
    const slowTwenty = makeTrack("Slow 20.wav", 3, 220, -20);

    expect(sortTracks([faster, slowTwenty, fastThirty, slower], "tempo-change", "asc").map((track) => track.source.fileName)).toEqual([
      "Slow 20.wav",
      "Slower.wav",
      "Faster.wav",
      "Fast 30.wav"
    ]);
    expect(sortTracks([faster, slowTwenty, fastThirty, slower], "tempo-change", "desc").map((track) => track.source.fileName)).toEqual([
      "Fast 30.wav",
      "Faster.wav",
      "Slower.wav",
      "Slow 20.wav"
    ]);
  });

  it("sorts quality from best to worst", () => {
    const needsCalibration = makeTrack("Needs Calibration.wav", 3, 178, 1, "needs-calibration");
    expect(sortTracks([...tracks, needsCalibration], "quality", "asc").map((track) => track.source.fileName)).toEqual(["Song 2.wav", "Song 10.wav", "Needs Calibration.wav", "Pending.wav"]);
  });

  it("sorts detected beat counts and phase accuracy", () => {
    const low = makeTrack("Low.wav", 0, 176, 1);
    const high = makeTrack("High.wav", 1, 178, 1);
    low.rawAnalysis!.beatTicks = [0, 1];
    high.rawAnalysis!.beatTicks = [0, 1, 2, 3];
    low.derivedAnalysis!.phaseCoverage = 0.68;
    high.derivedAnalysis!.phaseCoverage = 0.96;

    expect(sortTracks([low, high], "beat-count", "desc").map((track) => track.source.fileName)).toEqual(["High.wav", "Low.wav"]);
    expect(sortTracks([low, high], "phase-accuracy", "asc").map((track) => track.source.fileName)).toEqual(["Low.wav", "High.wav"]);
  });
});
