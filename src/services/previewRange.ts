import type { Track } from "../domain/types";

export interface SourceRange {
  startSeconds: number;
  endSeconds: number;
}

export interface PreviewStartBounds {
  minSeconds: number;
  maxSeconds: number;
  previewDurationSeconds: number;
}

export function clampSourceRange(range: SourceRange, durationSeconds: number): SourceRange {
  const duration = Math.max(0, durationSeconds);
  const startSeconds = Math.max(0, Math.min(duration, range.startSeconds));
  return {
    startSeconds,
    endSeconds: Math.max(startSeconds, Math.min(duration, range.endSeconds))
  };
}

export function previewSourceRange(
  track: Track,
  durationSeconds: number,
  requestedStartSeconds?: number,
  maximumSeconds = 20
): SourceRange {
  const bounds = previewStartBounds(track, durationSeconds, maximumSeconds);
  const defaultStartSeconds = (bounds.minSeconds + bounds.maxSeconds) / 2;
  const requested = requestedStartSeconds == null || !Number.isFinite(requestedStartSeconds)
    ? defaultStartSeconds
    : requestedStartSeconds;
  const startSeconds = Math.max(bounds.minSeconds, Math.min(bounds.maxSeconds, requested));
  return { startSeconds, endSeconds: startSeconds + bounds.previewDurationSeconds };
}

/** Returns the draggable start range for a preview that stays inside the edited clip. */
export function previewStartBounds(
  track: Track,
  durationSeconds: number,
  maximumSeconds = 20
): PreviewStartBounds {
  const edited = clampSourceRange({
    startSeconds: track.edit.sourceInSeconds,
    endSeconds: track.edit.sourceOutSeconds
  }, durationSeconds);
  const previewDuration = Math.min(Math.max(0, maximumSeconds), edited.endSeconds - edited.startSeconds);
  return {
    minSeconds: edited.startSeconds,
    maxSeconds: Math.max(edited.startSeconds, edited.endSeconds - previewDuration),
    previewDurationSeconds: previewDuration
  };
}
