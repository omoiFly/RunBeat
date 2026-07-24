import { describe, expect, it } from "vitest";
import { createProject, type Track } from "../domain/types";
import { estimateProjectDuration } from "./renderEstimate";

function makeTrack(index: number, seconds = 240): Track {
  return {
    id: `track-${index}`,
    source: {
      id: `track-${index}`,
      fileName: `${index}.mp3`,
      fileSize: 1,
      mimeType: "audio/mpeg",
      lastModified: 1,
      available: true
    },
    durationSeconds: seconds,
    status: "complete",
    edit: { exportEnabled: true, sourceInSeconds: 0, sourceOutSeconds: seconds, phaseNudgeBeats: 0 },
    order: index,
    derivedAnalysis: {
      normalizedBpm: 180,
      detectorOctaveFactor: 1,
      stepsPerBeat: 1,
      effectiveFactor: 1,
      targetSpm: 180,
      tempoRatio: 1,
      timeRatio: 1,
      tempoChangePercent: 0,
      quality: "excellent",
      warnings: []
    }
  };
}

describe("export duration estimate", () => {
  it("includes time stretching and subtracts continuous crossfades", () => {
    const project = createProject();
    project.tracks = [makeTrack(0), makeTrack(1), makeTrack(2)];
    project.exportSettings.mode = "continuous";
    const transitionSeconds = project.transitionBars * 4 * 60 / project.targetSpm;
    expect(estimateProjectDuration(project)).toBeCloseTo(3 * 240 - 2 * transitionSeconds, 4);
  });

  it("calculates the combined final duration for all fifty supported tracks", () => {
    const project = createProject();
    project.tracks = Array.from({ length: 50 }, (_, index) => makeTrack(index));
    const transitionSeconds = project.transitionBars * 4 * 60 / project.targetSpm;
    expect(estimateProjectDuration(project)).toBeCloseTo(50 * 240 - 49 * transitionSeconds, 4);
  });

  it("reports the sum of individual outputs in separate mode", () => {
    const project = createProject();
    project.tracks = [makeTrack(0), makeTrack(1), makeTrack(2)];
    project.exportSettings.mode = "separate";
    expect(estimateProjectDuration(project)).toBe(720);
  });
});
