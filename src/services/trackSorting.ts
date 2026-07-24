import { QUALITY_ORDER, type Track } from "../domain/types";

export type TrackSortKey =
  | "manual"
  | "filename"
  | "raw-bpm"
  | "mapped-bpm"
  | "beat-count"
  | "phase-accuracy"
  | "tempo-change"
  | "quality"
  | "confidence"
  | "duration";
export type TrackSortDirection = "asc" | "desc";

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
function numericValue(track: Track, key: Exclude<TrackSortKey, "manual" | "filename">): number | undefined {
  if (key === "raw-bpm") return track.rawAnalysis?.rawBpm;
  if (key === "mapped-bpm") return track.derivedAnalysis?.normalizedBpm;
  if (key === "beat-count") return track.rawAnalysis?.beatTicks.length;
  if (key === "phase-accuracy") {
    if (track.derivedAnalysis?.phaseAlignmentModel === "manual") return 1;
    return track.derivedAnalysis?.phaseCoverage ?? track.derivedAnalysis?.phaseConfidence;
  }
  if (key === "tempo-change") return track.derivedAnalysis?.tempoChangePercent;
  if (key === "quality") return track.derivedAnalysis ? QUALITY_ORDER.indexOf(track.derivedAnalysis.quality) : undefined;
  if (key === "confidence") return track.rawAnalysis?.bpmConfidence;
  if (!track.derivedAnalysis) return undefined;
  return Math.max(0, track.edit.sourceOutSeconds - track.edit.sourceInSeconds) * track.derivedAnalysis.timeRatio;
}

function compareOptional(left: number | undefined, right: number | undefined, direction: TrackSortDirection): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return (left - right) * (direction === "asc" ? 1 : -1);
}

export function sortTracks(tracks: Track[], key: TrackSortKey, direction: TrackSortDirection): Track[] {
  const indexed = tracks.map((track, index) => ({ track, index }));
  return indexed.sort((left, right) => {
    let compared: number;
    if (key === "manual") compared = left.track.order - right.track.order;
    else if (key === "filename") compared = collator.compare(left.track.source.fileName, right.track.source.fileName) * (direction === "asc" ? 1 : -1);
    else compared = compareOptional(numericValue(left.track, key), numericValue(right.track, key), direction);
    return compared || left.index - right.index;
  }).map(({ track }) => track);
}
