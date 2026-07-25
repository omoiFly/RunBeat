export interface SourceRange {
  startSeconds: number;
  endSeconds: number;
}

export function clampSourceRange(range: SourceRange, durationSeconds: number): SourceRange {
  const duration = Math.max(0, durationSeconds);
  const startSeconds = Math.max(0, Math.min(duration, range.startSeconds));
  return {
    startSeconds,
    endSeconds: Math.max(startSeconds, Math.min(duration, range.endSeconds))
  };
}
