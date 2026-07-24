import { MAX_TARGET_SPM, MIN_TARGET_SPM, QUALITY_ORDER, type DerivedTrackAnalysis, type MappingMode, type Quality, type RawTrackAnalysis } from "../domain/types";
import { tempoChangePerceptualCost, tempoChangeQuality } from "../domain/tempoChange";

const FACTORS = [0.5, 1, 2, 4] as const;
const OCTAVE_FACTORS = [0.25, 0.5, 1, 2, 4] as const;

interface Candidate {
  bpm: number;
  detectorOctaveFactor: (typeof FACTORS)[number];
  stepsPerBeat: 1 | 2;
  effectiveBpm: number;
  change: number;
  cost: number;
}

export function chooseBpmCandidate(rawBpm: number, targetSpm: number, mode: MappingMode): Candidate {
  if (!Number.isFinite(rawBpm) || rawBpm <= 0) throw new Error("BPM 必须为正数");
  const stepOptions: (1 | 2)[] = mode === "one-step-per-beat" ? [1] : mode === "two-steps-per-beat" ? [2] : [1, 2];
  const candidates = FACTORS.flatMap((factor) =>
    stepOptions.map((stepsPerBeat) => {
      const bpm = rawBpm * factor;
      const effectiveBpm = bpm * stepsPerBeat;
      const change = (targetSpm / effectiveBpm - 1) * 100;
      return {
        bpm,
        detectorOctaveFactor: factor,
        stepsPerBeat,
        effectiveBpm,
        change,
        cost: tempoChangePerceptualCost(change)
      };
    })
  );
  const plausible = candidates.filter(({ bpm, effectiveBpm }) =>
    bpm >= 55 &&
    bpm <= MAX_TARGET_SPM &&
    effectiveBpm >= MIN_TARGET_SPM &&
    effectiveBpm <= MAX_TARGET_SPM
  );
  const pool = plausible.length ? plausible : candidates;
  return [...pool].sort((a, b) =>
    a.cost - b.cost ||
    a.stepsPerBeat - b.stepsPerBeat ||
    Math.abs(a.detectorOctaveFactor - 1) - Math.abs(b.detectorOctaveFactor - 1)
  )[0];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function circularDistance(left: number, right: number, period: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, period - direct);
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (!sortedValues.length) return 0;
  const position = (sortedValues.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

export function alignBpmToReference(bpm: number, reference: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(reference) || reference <= 0) return bpm;
  const factor = 2 ** Math.round(Math.log2(reference / bpm));
  const aligned = bpm * factor;
  if (OCTAVE_FACTORS.includes(factor as (typeof OCTAVE_FACTORS)[number])) return aligned;
  return bpm;
}

function octaveDistance(left: number, right: number): number {
  const octaves = Math.log2(left / right);
  return Math.abs(octaves - Math.round(octaves));
}

function gaussianScore(distance: number, tolerance: number): number {
  return Math.exp(-0.5 * (distance / tolerance) ** 2);
}

/**
 * Product confidence score for the global BPM estimate, not beat-position confidence.
 * It combines octave-normalized estimator agreement with local-window consistency.
 */
export function estimateGlobalBpmConfidence(rawBpm: number, rhythmBpm: number | undefined, windowBpms: number[]): number {
  if (!Number.isFinite(rawBpm) || rawBpm <= 0) return 0;
  let score = 0.15;
  if (rhythmBpm != null && Number.isFinite(rhythmBpm) && rhythmBpm > 0) {
    score += 0.35 * gaussianScore(octaveDistance(rawBpm, rhythmBpm), Math.log2(1.03));
  }
  const alignedWindows = windowBpms
    .filter((bpm) => Number.isFinite(bpm) && bpm > 0)
    .map((bpm) => alignBpmToReference(bpm, rawBpm));
  if (alignedWindows.length) {
    const center = median(alignedWindows);
    const coverage = Math.min(1, alignedWindows.length / 5);
    score += 0.2 * Math.sqrt(coverage) * gaussianScore(octaveDistance(rawBpm, center), Math.log2(1.03));
    if (alignedWindows.length >= 2) {
      const residuals = alignedWindows.map((bpm) => Math.abs(Math.log2(bpm / center)));
      const robustSpread = 1.4826 * median(residuals);
      const inlierRatio = residuals.filter((residual) => residual <= Math.log2(1.05)).length / residuals.length;
      const stability = gaussianScore(robustSpread, Math.log2(1.025)) * inlierRatio;
      score += 0.3 * coverage * stability;
    }
  }
  return clamp01(score);
}

const PHASE_TOLERANCE_FRACTION = 0.12;
const MIN_PHASE_COVERAGE = 0.65;
const BPM_REFINEMENT_WINDOW_TICKS = 32;
const BPM_REFINEMENT_WINDOW_STRIDE = 16;
const MAX_BPM_REFINEMENT_FRACTION = 0.02;
const MIN_REFINEMENT_SCORE_GAIN = 0.015;

interface BeatGridFit {
  phaseOffsetSeconds?: number;
  confidence?: number;
  coverage?: number;
  medianErrorSeconds?: number;
  p90ErrorSeconds?: number;
  score: number;
}

function sortedBeatTicks(beatTicks: number[]): number[] {
  return beatTicks
    .filter((tick) => Number.isFinite(tick) && tick >= 0)
    .sort((left, right) => left - right)
    .filter((tick, index, ticks) => index === 0 || tick - ticks[index - 1] > 0.0001);
}

/**
 * Fits one fixed-tempo model. A phase is accepted only when a dominant cluster
 * covers most ticks; linear drift is deliberately not hidden in the phase value.
 */
function fitBeatGridPhase(beatTicks: number[], timeRatio: number, targetSpm: number): BeatGridFit {
  if (!Number.isFinite(timeRatio) || timeRatio <= 0 || !Number.isFinite(targetSpm) || targetSpm <= 0) return { score: 0 };
  const period = 60 / targetSpm;
  const phases = sortedBeatTicks(beatTicks).map((tick) => positiveModulo(tick * timeRatio, period));
  if (!phases.length) return { score: 0 };

  const tolerance = period * PHASE_TOLERANCE_FRACTION;
  const orderedPhases = [...phases].sort((left, right) => left - right);
  const unwrappedPhases = [...orderedPhases, ...orderedPhases.map((phase) => phase + period)];
  let bestStart = 0;
  let bestEnd = 0;
  let end = 0;
  for (let start = 0; start < orderedPhases.length; start += 1) {
    end = Math.max(end, start);
    while (
      end + 1 < start + orderedPhases.length
      && unwrappedPhases[end + 1] - unwrappedPhases[start] <= 2 * tolerance
    ) end += 1;
    if (end - start > bestEnd - bestStart) {
      bestStart = start;
      bestEnd = end;
    }
  }
  const dominantCluster = unwrappedPhases.slice(bestStart, bestEnd + 1);
  // Keep the circular median inside the interval that still covers the entire
  // winning cluster. This is robust to outliers without sacrificing coverage.
  const feasibleMinimum = dominantCluster[dominantCluster.length - 1] - tolerance;
  const feasibleMaximum = dominantCluster[0] + tolerance;
  const center = positiveModulo(Math.max(feasibleMinimum, Math.min(feasibleMaximum, median(dominantCluster))), period);

  const residuals = phases.map((phase) => circularDistance(phase, center, period)).sort((left, right) => left - right);
  const coverage = residuals.filter((residual) => residual <= tolerance).length / residuals.length;
  const medianErrorSeconds = percentile(residuals, 0.5);
  const p90ErrorSeconds = percentile(residuals, 0.9);
  const precision = clamp01(1 - medianErrorSeconds / tolerance);
  const tailPrecision = clamp01(1 - p90ErrorSeconds / (period * 0.3));
  const score = 0.72 * coverage + 0.2 * precision + 0.08 * tailPrecision;
  const sampleSupport = clamp01(phases.length / 24);
  const confidence = score * (0.65 + 0.35 * sampleSupport);
  const locked = phases.length >= 4 && coverage >= MIN_PHASE_COVERAGE;
  return {
    phaseOffsetSeconds: locked ? center : undefined,
    confidence,
    coverage,
    medianErrorSeconds,
    p90ErrorSeconds,
    score
  };
}

/**
 * Estimates the effective song BPM from long beat-tick windows. Reconstructing
 * integer grid positions first tolerates missing and false ticks, while a tight
 * bound prevents the beat tracker from changing mapping mode.
 */
function estimateBeatRefinedBpm(beatTicks: number[], baselineBpm: number): number | undefined {
  if (!Number.isFinite(baselineBpm) || baselineBpm <= 0) return undefined;
  const ticks = sortedBeatTicks(beatTicks);
  if (ticks.length <= BPM_REFINEMENT_WINDOW_TICKS) return undefined;
  const gridPositions = [0];
  for (let index = 1; index < ticks.length; index += 1) {
    const approximateSteps = (ticks[index] - ticks[index - 1]) * baselineBpm / 60;
    gridPositions.push(gridPositions[index - 1] + Math.max(0, Math.round(approximateSteps)));
  }
  const estimates: number[] = [];
  for (let start = 0; start + BPM_REFINEMENT_WINDOW_TICKS < ticks.length; start += BPM_REFINEMENT_WINDOW_STRIDE) {
    const elapsed = ticks[start + BPM_REFINEMENT_WINDOW_TICKS] - ticks[start];
    if (elapsed <= 0) continue;
    const gridSteps = gridPositions[start + BPM_REFINEMENT_WINDOW_TICKS] - gridPositions[start];
    if (gridSteps < 8) continue;
    estimates.push(gridSteps * 60 / elapsed);
  }
  if (estimates.length < 3) return undefined;
  const refinedBpm = median(estimates);
  return Math.abs(refinedBpm / baselineBpm - 1) <= MAX_BPM_REFINEMENT_FRACTION ? refinedBpm : undefined;
}

/** Returns a reliable phase for the supplied fixed time-ratio model. */
export function bestBeatGridPhase(beatTicks: number[], timeRatio: number, targetSpm: number): number | undefined {
  return fitBeatGridPhase(beatTicks, timeRatio, targetSpm).phaseOffsetSeconds;
}

export function beatGridPhaseAfterSourceOffset(
  fullTrackPhase: number | undefined,
  sourceOffsetSeconds: number,
  timeRatio: number,
  targetSpm: number
): number | undefined {
  if (fullTrackPhase == null || !Number.isFinite(sourceOffsetSeconds) || !Number.isFinite(timeRatio) || timeRatio <= 0 || !Number.isFinite(targetSpm) || targetSpm <= 0) return undefined;
  return positiveModulo(fullTrackPhase - sourceOffsetSeconds * timeRatio, 60 / targetSpm);
}

function worstQuality(qualities: Quality[]): Quality {
  return QUALITY_ORDER[Math.max(...qualities.map((quality) => QUALITY_ORDER.indexOf(quality)))];
}

function phaseQualityFor(
  phaseOffsetSeconds: number | undefined,
  phaseAlignmentModel: DerivedTrackAnalysis["phaseAlignmentModel"],
  phaseConfidence: number | undefined,
  phaseCoverage: number | undefined,
  phaseMedianErrorSeconds: number | undefined
): Quality {
  if (phaseAlignmentModel === "manual") return "excellent";
  if (phaseOffsetSeconds == null) return "needs-calibration";
  if (phaseConfidence == null || phaseCoverage == null || phaseMedianErrorSeconds == null) return "acceptable";
  if (phaseConfidence < 0.62 || phaseCoverage < 0.7 || phaseMedianErrorSeconds > 0.035) return "needs-calibration";
  if (phaseConfidence < 0.72 || phaseCoverage < 0.8 || phaseMedianErrorSeconds > 0.025) return "acceptable";
  if (phaseConfidence < 0.82 || phaseCoverage < 0.9 || phaseMedianErrorSeconds > 0.015) return "good";
  return "excellent";
}

function qualityFor(
  tempoChangePercent: number,
  bpmConfidence: number,
  phaseOffsetSeconds: number | undefined,
  phaseAlignmentModel: DerivedTrackAnalysis["phaseAlignmentModel"],
  phaseConfidence: number | undefined,
  phaseCoverage: number | undefined,
  phaseMedianErrorSeconds: number | undefined
): { quality: Quality; factors: NonNullable<DerivedTrackAnalysis["qualityFactors"]> } {
  const changeQuality = tempoChangeQuality(tempoChangePercent);
  const confidenceQuality: Quality = bpmConfidence < 0.4 ? "not-recommended" : bpmConfidence < 0.6 ? "acceptable" : bpmConfidence < 0.8 ? "good" : "excellent";
  const phaseQuality = phaseQualityFor(phaseOffsetSeconds, phaseAlignmentModel, phaseConfidence, phaseCoverage, phaseMedianErrorSeconds);
  const factors = { tempoChange: changeQuality, bpmConfidence: confidenceQuality, phaseAlignment: phaseQuality };
  return { quality: worstQuality(Object.values(factors)), factors };
}

export function deriveTrackAnalysis(
  raw: RawTrackAnalysis,
  targetSpm: number,
  mappingMode: MappingMode,
  manualBpm?: number,
  manualFirstBeat?: number
): DerivedTrackAnalysis {
  const sourceBpm = manualBpm ?? raw.rawBpm;
  const candidate = chooseBpmCandidate(sourceBpm, targetSpm, mappingMode);
  const baselineTimeRatio = candidate.effectiveBpm / targetSpm;
  const baselineFit = fitBeatGridPhase(raw.beatTicks, baselineTimeRatio, targetSpm);
  let normalizedBpm = candidate.effectiveBpm;
  let selectedFit = baselineFit;
  let phaseAlignmentModel: DerivedTrackAnalysis["phaseAlignmentModel"] = "global-bpm";
  let bpmRefinementPercent: number | undefined;

  if (manualBpm == null) {
    const refinedBpm = estimateBeatRefinedBpm(raw.beatTicks, candidate.effectiveBpm);
    if (refinedBpm != null) {
      const refinedFit = fitBeatGridPhase(raw.beatTicks, refinedBpm / targetSpm, targetSpm);
      const refinementImprovesLock = refinedFit.phaseOffsetSeconds != null
        && (baselineFit.phaseOffsetSeconds == null || refinedFit.score >= baselineFit.score + MIN_REFINEMENT_SCORE_GAIN);
      if (refinementImprovesLock) {
        normalizedBpm = refinedBpm;
        selectedFit = refinedFit;
        phaseAlignmentModel = "beat-refined";
        bpmRefinementPercent = (refinedBpm / candidate.effectiveBpm - 1) * 100;
      }
    }
  }

  const tempoRatio = targetSpm / normalizedBpm;
  const timeRatio = 1 / tempoRatio;
  const tempoChangePercent = (tempoRatio - 1) * 100;
  const bpmConfidence = manualBpm == null
    ? raw.bpmConfidence ?? estimateGlobalBpmConfidence(raw.rawBpm, raw.rhythmBpm, raw.windowBpms)
    : 1;
  let agreement: number | undefined;
  if (raw.rhythmBpm) {
    const rhythmCandidate = chooseBpmCandidate(raw.rhythmBpm, targetSpm, mappingMode);
    agreement = Math.abs(normalizedBpm - rhythmCandidate.effectiveBpm);
  }
  const interval = 60 / targetSpm;
  const phaseOffsetSeconds = manualFirstBeat == null
    ? selectedFit.phaseOffsetSeconds
    : positiveModulo(manualFirstBeat * timeRatio, interval);
  if (manualFirstBeat != null) phaseAlignmentModel = "manual";
  const phaseConfidence = manualFirstBeat == null ? selectedFit.confidence : 1;
  const phaseCoverage = manualFirstBeat == null ? selectedFit.coverage : undefined;
  const phaseMedianErrorSeconds = manualFirstBeat == null ? selectedFit.medianErrorSeconds : undefined;
  const quality = qualityFor(
    tempoChangePercent,
    bpmConfidence,
    phaseOffsetSeconds,
    phaseAlignmentModel,
    phaseConfidence,
    phaseCoverage,
    phaseMedianErrorSeconds
  );
  const warnings: string[] = [];
  if (tempoChangePercent < -20) warnings.push("减速超过 -20%，通常会明显影响听感");
  else if (tempoChangePercent > 30) warnings.push("加速超过 +30%，可能明显影响听感");
  else if (tempoChangePercent < -15) warnings.push("减速幅度较大（低于 -15%）");
  else if (tempoChangePercent > 20) warnings.push("加速幅度较大（超过 +20%）");
  if (bpmConfidence < 0.45) warnings.push("全局 BPM 置信度较低，建议手动确认");
  else if (bpmConfidence < 0.65) warnings.push("全局 BPM 置信度一般");
  if (phaseOffsetSeconds == null) warnings.push("未能自动锁定歌曲相位；综合质量已标记为“需校准”，请试听并手动设置歌曲首拍");
  else if (quality.factors.phaseAlignment === "needs-calibration") warnings.push("歌曲拍点相位可靠性较低；综合质量已标记为“需校准”，建议手动设置歌曲首拍");
  else if (quality.factors.phaseAlignment === "acceptable") warnings.push("歌曲拍点相位一致性一般，综合质量已降级，建议试听确认");
  return {
    normalizedBpm,
    detectorOctaveFactor: candidate.detectorOctaveFactor,
    stepsPerBeat: candidate.stepsPerBeat,
    effectiveFactor: candidate.detectorOctaveFactor * candidate.stepsPerBeat,
    targetSpm,
    tempoRatio,
    timeRatio,
    tempoChangePercent,
    bpmAgreement: agreement,
    phaseOffsetSeconds,
    phaseAlignmentModel,
    phaseConfidence,
    phaseCoverage,
    phaseMedianErrorMs: phaseMedianErrorSeconds != null
      ? phaseMedianErrorSeconds * 1_000
      : undefined,
    bpmRefinementPercent,
    quality: quality.quality,
    qualityFactors: quality.factors,
    warnings
  };
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}
