import type { Quality } from "./types";

const SPEED_UP_LIMITS = new Map<number, number>([
  [4, 6],
  [6, 10],
  [10, 15],
  [15, 20],
  [20, 30]
]);

const SPEED_UP_COST_POINTS = [
  [0, 0],
  [6, 4],
  [10, 6],
  [15, 10],
  [20, 15],
  [30, 20]
] as const;

export interface TempoChangeRange {
  slowDownPercent: number;
  speedUpPercent: number;
}

export function tempoChangeRange(maxTempoChangePercent: number): TempoChangeRange {
  if (maxTempoChangePercent >= 100) {
    return { slowDownPercent: Number.POSITIVE_INFINITY, speedUpPercent: Number.POSITIVE_INFINITY };
  }
  return {
    slowDownPercent: maxTempoChangePercent,
    speedUpPercent: SPEED_UP_LIMITS.get(maxTempoChangePercent) ?? maxTempoChangePercent * 1.5
  };
}

export function isTempoChangeWithinRange(
  tempoChangePercent: number,
  maxTempoChangePercent: number
): boolean {
  if (!Number.isFinite(tempoChangePercent)) return false;
  const range = tempoChangeRange(maxTempoChangePercent);
  return tempoChangePercent >= -range.slowDownPercent
    && tempoChangePercent <= range.speedUpPercent;
}

export function tempoChangePerceptualCost(tempoChangePercent: number): number {
  if (tempoChangePercent < 0) return -tempoChangePercent;
  for (let index = 1; index < SPEED_UP_COST_POINTS.length; index += 1) {
    const [upperChange, upperCost] = SPEED_UP_COST_POINTS[index];
    if (tempoChangePercent > upperChange) continue;
    const [lowerChange, lowerCost] = SPEED_UP_COST_POINTS[index - 1];
    const progress = (tempoChangePercent - lowerChange) / (upperChange - lowerChange);
    return lowerCost + (upperCost - lowerCost) * progress;
  }
  const [lastChange, lastCost] = SPEED_UP_COST_POINTS[SPEED_UP_COST_POINTS.length - 1];
  return lastCost + (tempoChangePercent - lastChange) / 2;
}

export function tempoChangeQuality(tempoChangePercent: number): Quality {
  if (isTempoChangeWithinRange(tempoChangePercent, 6)) return "excellent";
  if (isTempoChangeWithinRange(tempoChangePercent, 15)) return "good";
  if (isTempoChangeWithinRange(tempoChangePercent, 20)) return "acceptable";
  return "not-recommended";
}
