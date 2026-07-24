import { beatGridPhaseAfterSourceOffset } from "../audio/bpm";
import { planTimelineGeometry, type TimelineGeometry, type TimelineTrackGeometry } from "../audio/mixer";
import type { ProjectV1, Track } from "../domain/types";
import { resolveExportEnabled } from "./exportSelection";

export function estimatedTrackGeometry(
  track: Track,
  project: Pick<ProjectV1, "targetSpm" | "exportSettings">
): TimelineTrackGeometry {
  const sampleRate = project.exportSettings.sampleRate;
  const durationFrames = Math.max(0, Math.round(track.durationSeconds * sampleRate));
  const startFrame = Math.max(0, Math.min(durationFrames, Math.round(track.edit.sourceInSeconds * sampleRate)));
  const endFrame = Math.max(startFrame, Math.min(durationFrames, Math.round(track.edit.sourceOutSeconds * sampleRate)));
  const timeRatio = track.derivedAnalysis?.timeRatio ?? 1;
  return {
    frameCount: Math.max(0, Math.round((endFrame - startFrame) * timeRatio)),
    phaseOffsetSeconds: beatGridPhaseAfterSourceOffset(
      track.derivedAnalysis?.phaseOffsetSeconds,
      startFrame / sampleRate,
      timeRatio,
      project.targetSpm
    ),
    phaseNudgeBeats: track.edit.phaseNudgeBeats
  };
}

export function projectTimelineGeometry(
  tracks: Track[],
  project: Pick<ProjectV1, "targetSpm" | "transitionBars" | "exportSettings">,
  minimumDurationSeconds?: number
): TimelineGeometry {
  return planTimelineGeometry(tracks.map((track) => estimatedTrackGeometry(track, project)), {
    sampleRate: project.exportSettings.sampleRate,
    targetSpm: project.targetSpm,
    transitionBars: project.transitionBars,
    minimumDurationSeconds
  });
}

/** Returns the final planned audio length shown before export. */
export function estimateProjectDuration(project: ProjectV1): number {
  const sampleRate = project.exportSettings.sampleRate;
  const selected = project.tracks
    .filter((track) => resolveExportEnabled(track, project.maxTempoChangePercent))
    .sort((left, right) => left.order - right.order);
  if (project.exportSettings.mode === "separate") {
    return selected.reduce((sum, track) => {
      const geometry = projectTimelineGeometry([track], project);
      return sum + geometry.durationFrames / sampleRate;
    }, 0);
  }
  return projectTimelineGeometry(selected, project).durationFrames / sampleRate;
}
