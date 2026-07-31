import type { BeatTrackSettings } from "../domain/types";
import { dbToGain } from "./grid";
import { measureTruePeak, TRUE_PEAK_CEILING_DBTP } from "./loudness";

export const BEAT_TRACK_ZERO_DB_PROMINENCE_DB = 10;
export const BEAT_TRACK_LEGACY_ZERO_DB_BOOST_DB = 10;
export const BEAT_TRACK_LEGACY_REFERENCE_LUFS = -14;

export interface BeatSample {
  channels: Float32Array[];
  sampleRate: number;
}

function deterministicNoise(beat: number, sample: number, channel: number): number {
  let value = Math.imul(beat + 1, 0x45d9f3b) ^ Math.imul(sample + 1, 0x119de1f3) ^ Math.imul(channel + 1, 0x27d4eb2d);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x7fffffff - 1;
}

function addPulse(
  target: Float32Array,
  rangeStart: number,
  hitStart: number,
  sampleRate: number,
  frequency: number,
  gain: number,
  noise: number,
  beat: number,
  channel: number
): void {
  const hitFrames = Math.round(sampleRate * 0.075);
  const firstFrame = Math.max(rangeStart, hitStart);
  const endFrame = Math.min(rangeStart + target.length, hitStart + hitFrames);
  for (let frame = firstFrame; frame < endFrame; frame += 1) {
    const i = frame - hitStart;
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 55);
    const tone = Math.sin(2 * Math.PI * frequency * t);
    target[frame - rangeStart] += (tone * (1 - noise) + deterministicNoise(beat, i, channel) * noise) * envelope * gain;
  }
}

function resampleChannel(source: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return source;
  const length = Math.max(1, Math.round(source.length * targetRate / sourceRate));
  const result = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * sourceRate / targetRate;
    const left = Math.min(source.length - 1, Math.floor(position));
    const right = Math.min(source.length - 1, left + 1);
    const fraction = position - left;
    result[index] = source[left] * (1 - fraction) + source[right] * fraction;
  }
  return result;
}

function addCustomBeat(
  target: [Float32Array, Float32Array],
  rangeStart: number,
  hitStart: number,
  sample: [Float32Array, Float32Array],
  sampleRate: number,
  gain: number,
  alternateFeet: boolean,
  beat: number
): void {
  const maximumHitFrames = Math.round(sampleRate * 0.5);
  const hitFrames = Math.min(maximumHitFrames, sample[0].length);
  const wasTruncated = hitFrames < sample[0].length;
  const fadeFrames = wasTruncated ? Math.min(hitFrames, Math.max(1, Math.round(sampleRate * 0.005))) : 0;
  const leftGain = alternateFeet ? (beat % 2 ? 0.92 : 1.08) : 1;
  const rightGain = alternateFeet ? (beat % 2 ? 1.08 : 0.92) : 1;
  const firstFrame = Math.max(rangeStart, hitStart);
  const endFrame = Math.min(rangeStart + target[0].length, hitStart + hitFrames);
  for (let frame = firstFrame; frame < endFrame; frame += 1) {
    const index = frame - hitStart;
    const fade = fadeFrames && index >= hitFrames - fadeFrames ? (hitFrames - index) / fadeFrames : 1;
    target[0][frame - rangeStart] += sample[0][index] * gain * leftGain * fade;
    target[1][frame - rangeStart] += sample[1][index] * gain * rightGain * fade;
  }
}

const customSampleCache = new WeakMap<BeatSample, Map<number, [Float32Array, Float32Array]>>();
const BUILT_IN_PROFILES = {
  "soft-footstep": [95, 0.55],
  "track-footstep": [125, 0.7],
  kick: [72, 0.05],
  wood: [480, 0.22],
  click: [1250, 0.02]
} as const;

function resampledCustomBeat(sample: BeatSample, sampleRate: number): [Float32Array, Float32Array] {
  let rates = customSampleCache.get(sample);
  if (!rates) {
    rates = new Map();
    customSampleCache.set(sample, rates);
  }
  const cached = rates.get(sampleRate);
  if (cached) return cached;
  const result: [Float32Array, Float32Array] = [
    resampleChannel(sample.channels[0], sample.sampleRate, sampleRate),
    resampleChannel(sample.channels[1] ?? sample.channels[0], sample.sampleRate, sampleRate)
  ];
  rates.set(sampleRate, result);
  return result;
}

function generateBeatTrackRangeFromOrigin(
  rangeStartFrames: number,
  frameCount: number,
  gridOriginFrames: number,
  targetSpm: number,
  sampleRate: number,
  settings: BeatTrackSettings,
  customSample?: BeatSample
): [Float32Array, Float32Array] {
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  const gain = dbToGain(settings.gainDb);
  const framesPerBeat = sampleRate * 60 / targetSpm;
  const maximumHitFrames = settings.sound === "custom" ? Math.round(sampleRate * 0.5) : Math.round(sampleRate * 0.075);
  const firstBeat = Math.max(0, Math.floor((rangeStartFrames - gridOriginFrames - maximumHitFrames) / framesPerBeat));
  const rangeEnd = rangeStartFrames + frameCount;

  let custom: [Float32Array, Float32Array] | undefined;
  if (settings.sound === "custom") {
    if (!customSample?.channels.length || !Number.isFinite(customSample.sampleRate) || customSample.sampleRate <= 0) {
      throw new Error("自定义鼓点文件不可用，请在项目设置中重新上传");
    }
    custom = resampledCustomBeat(customSample, sampleRate);
  }
  const profile = settings.sound === "custom" ? undefined : BUILT_IN_PROFILES[settings.sound];

  for (let beat = firstBeat; ; beat += 1) {
    const hitStart = gridOriginFrames + Math.round(beat * framesPerBeat);
    if (hitStart >= rangeEnd) break;
    const accent = settings.accentEvery && beat % settings.accentEvery === 0 ? 1.35 : 1;
    if (custom) {
      addCustomBeat([left, right], rangeStartFrames, hitStart, custom, sampleRate, gain * accent, settings.alternateFeet, beat);
    } else if (profile) {
      const footVariation = settings.alternateFeet && beat % 2 ? 1.06 : 1;
      addPulse(left, rangeStartFrames, hitStart, sampleRate, profile[0] * footVariation, gain * accent, profile[1], beat, 0);
      addPulse(right, rangeStartFrames, hitStart, sampleRate, profile[0] / footVariation, gain * accent, profile[1], beat, 1);
    }
  }
  return [left, right];
}

/** Generates one grid hit while preserving the absolute beat index for accents and alternating feet. */
export function generateBeatHit(
  beat: number,
  sampleRate: number,
  settings: BeatTrackSettings,
  customSample?: BeatSample
): [Float32Array, Float32Array] {
  const hitFrames = settings.sound === "custom"
    ? Math.min(
        Math.round(sampleRate * 0.5),
        customSample?.channels[0]?.length ?? Math.round(sampleRate * 0.5)
      )
    : Math.round(sampleRate * 0.075);
  const target: [Float32Array, Float32Array] = [
    new Float32Array(Math.max(1, hitFrames)),
    new Float32Array(Math.max(1, hitFrames))
  ];
  const gain = dbToGain(settings.gainDb);
  const accent = settings.accentEvery && beat % settings.accentEvery === 0 ? 1.35 : 1;
  if (settings.sound === "custom") {
    if (!customSample?.channels.length || !Number.isFinite(customSample.sampleRate) || customSample.sampleRate <= 0) {
      throw new Error("自定义鼓点文件不可用，请在项目设置中重新上传");
    }
    addCustomBeat(
      target,
      0,
      0,
      resampledCustomBeat(customSample, sampleRate),
      sampleRate,
      gain * accent,
      settings.alternateFeet,
      beat
    );
  } else {
    const profile = BUILT_IN_PROFILES[settings.sound];
    const footVariation = settings.alternateFeet && beat % 2 ? 1.06 : 1;
    addPulse(target[0], 0, 0, sampleRate, profile[0] * footVariation, gain * accent, profile[1], beat, 0);
    addPulse(target[1], 0, 0, sampleRate, profile[0] / footVariation, gain * accent, profile[1], beat, 1);
  }
  return target;
}

/**
 * Returns the gain for a beat rendered at 0 dB so the project control is
 * referenced to the normalized music bus. The music-relative anchor places a
 * 0 dB hit 10 dB above that reference, up to the true-peak ceiling. A legacy
 * calibration floor can raise it further: at the default -14 LUFS reference,
 * calibration never falls below +10 dB, so the new -10 dB
 * default retains at least the old raw 0 dB beat strength and the new 0 dB
 * setting is at least 10 dB stronger. The floor tracks other music references
 * by the same dB delta so the beat-to-music relationship remains stable. Final
 * mix peak protection keeps the exported signal within the true-peak ceiling.
 */
export function beatTrackGainForReference(
  settings: BeatTrackSettings,
  sampleRate: number,
  musicReferenceLufs: number,
  customSample?: BeatSample
): number {
  const referenceSettings: BeatTrackSettings = { ...settings, gainDb: 0 };
  const patternBeats = Math.max(16, settings.accentEvery || 1);
  let referencePeak = 0;
  for (let beat = 0; beat < patternBeats; beat += 1) {
    referencePeak = Math.max(
      referencePeak,
      measureTruePeak(generateBeatHit(beat, sampleRate, referenceSettings, customSample))
    );
  }
  if (!(referencePeak > 0)) return 0;
  const zeroDbPeakDbfs = Math.min(
    TRUE_PEAK_CEILING_DBTP,
    musicReferenceLufs + BEAT_TRACK_ZERO_DB_PROMINENCE_DB
  );
  const musicRelativeCalibration = dbToGain(zeroDbPeakDbfs) / referencePeak;
  const referenceShiftDb = Number.isFinite(musicReferenceLufs)
    ? musicReferenceLufs - BEAT_TRACK_LEGACY_REFERENCE_LUFS
    : 0;
  const legacyCalibrationFloor = dbToGain(BEAT_TRACK_LEGACY_ZERO_DB_BOOST_DB + referenceShiftDb);
  return Math.max(musicRelativeCalibration, legacyCalibrationFloor) * dbToGain(settings.gainDb);
}

/** Generates a slice of the absolute master beat grid without resetting accents or left/right feet. */
export function generateBeatTrackRange(
  startFrame: number,
  frameCount: number,
  targetSpm: number,
  sampleRate: number,
  settings: BeatTrackSettings,
  customSample?: BeatSample
): [Float32Array, Float32Array] {
  return generateBeatTrackRangeFromOrigin(startFrame, frameCount, 0, targetSpm, sampleRate, settings, customSample);
}

export function generateBeatTrack(
  durationSeconds: number,
  targetSpm: number,
  sampleRate: number,
  settings: BeatTrackSettings,
  offsetSeconds = 0,
  customSample?: BeatSample
): [Float32Array, Float32Array] {
  const frames = Math.ceil(durationSeconds * sampleRate);
  const interval = 60 / targetSpm;
  const firstBeat = ((offsetSeconds % interval) + interval) % interval;
  return generateBeatTrackRangeFromOrigin(0, frames, Math.round(firstBeat * sampleRate), targetSpm, sampleRate, settings, customSample);
}
