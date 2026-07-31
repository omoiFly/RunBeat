import type { BeatTrackSettings } from "../domain/types";
import { beatTrackGainForReference, generateBeatTrack, type BeatSample } from "./beatTrack";
import { equalPowerGains, transitionDurationSeconds } from "./grid";
import {
  applyGain,
  measureIntegratedLoudness,
  measureTruePeak,
  transparentLoudnessGain,
  truePeakProtectionGain
} from "./loudness";

export { normalizeAndLimit } from "./loudness";

export interface RenderableTrack {
  channels: Float32Array[];
  phaseOffsetSeconds?: number;
  phaseNudgeBeats: number;
}

export interface MixOptions {
  sampleRate: number;
  targetSpm: number;
  transitionBars: number;
  beatTrack: BeatTrackSettings;
  customBeatSample?: BeatSample;
  normalizeLoudness: boolean;
  loudnessLufs: number;
  includeBeat: boolean;
  minimumDurationSeconds?: number;
  /** Internal streaming-pass gain applied only to the music bus. */
  musicGain?: number;
  /** Actual post-normalization music loudness used to calibrate the beat bus. */
  beatReferenceLufs?: number;
}

export interface TimelineEntry {
  trackIndex: number;
  startFrames: number;
  audibleStartFrames: number;
  endFrames: number;
  overlapFrames: number;
  phaseShiftFrames: number;
}

export interface TimelinePlan {
  aligned: Float32Array[][];
  entries: TimelineEntry[];
  durationFrames: number;
}

export interface TimelineTrackGeometry {
  frameCount: number;
  phaseOffsetSeconds?: number;
  phaseNudgeBeats: number;
}

export interface TimelineGeometry {
  entries: TimelineEntry[];
  durationFrames: number;
}

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function phaseShiftFrames(track: Pick<TimelineTrackGeometry, "phaseOffsetSeconds" | "phaseNudgeBeats">, sampleRate: number, targetSpm: number, timelineStartFrames: number): number {
  const beatInterval = 60 / targetSpm;
  const phase = track.phaseOffsetSeconds;
  const timelineStart = timelineStartFrames / sampleRate;
  let shift = phase == null ? 0 : positiveModulo(-(timelineStart + phase), beatInterval);
  if (phase != null && shift * sampleRate < 0.5) shift = 0;
  shift += track.phaseNudgeBeats * beatInterval;
  return Math.round(shift * sampleRate);
}

function applyPhaseShift(track: RenderableTrack, shiftFrames: number): Float32Array[] {
  const channels = track.channels.map((channel) => {
    if (shiftFrames >= 0) {
      const result = new Float32Array(channel.length + shiftFrames);
      result.set(channel, shiftFrames);
      return result;
    }
    return channel.slice(Math.min(channel.length, -shiftFrames));
  });
  return channels;
}

export function planTimelineGeometry(tracks: TimelineTrackGeometry[], options: Pick<MixOptions, "sampleRate" | "targetSpm" | "transitionBars" | "minimumDurationSeconds">): TimelineGeometry {
  const transitionFrames = Math.round(transitionDurationSeconds(options.transitionBars, options.targetSpm) * options.sampleRate);
  const entries: TimelineEntry[] = [];
  let cursor = 0;
  tracks.forEach((track, index) => {
    const shiftFrames = phaseShiftFrames(track, options.sampleRate, options.targetSpm, cursor);
    const alignedFrames = Math.max(0, track.frameCount + shiftFrames);
    const overlap = index < tracks.length - 1 ? Math.min(transitionFrames, Math.floor(alignedFrames / 2)) : 0;
    entries.push({
      trackIndex: index,
      startFrames: cursor,
      audibleStartFrames: cursor + Math.max(0, shiftFrames),
      endFrames: cursor + alignedFrames,
      overlapFrames: overlap,
      phaseShiftFrames: shiftFrames
    });
    cursor += alignedFrames - overlap;
  });
  const durationFrames = Math.max(cursor, Math.round((options.minimumDurationSeconds ?? 1) * options.sampleRate));
  return { entries, durationFrames };
}

export function planTimeline(tracks: RenderableTrack[], options: Pick<MixOptions, "sampleRate" | "targetSpm" | "transitionBars" | "minimumDurationSeconds">): TimelinePlan {
  const geometry = planTimelineGeometry(tracks.map((track) => ({
    frameCount: track.channels[0]?.length ?? 0,
    phaseOffsetSeconds: track.phaseOffsetSeconds,
    phaseNudgeBeats: track.phaseNudgeBeats
  })), options);
  const aligned = tracks.map((track, index) => applyPhaseShift(track, geometry.entries[index].phaseShiftFrames));
  const { entries, durationFrames } = geometry;
  return { aligned, entries, durationFrames };
}

export function mixPlannedTimeline(plan: TimelinePlan, options: MixOptions): Float32Array[] {
  if (!plan.aligned.length && !options.includeBeat) throw new Error("时间线中没有可渲染歌曲");
  const transitionFrames = Math.round(transitionDurationSeconds(options.transitionBars, options.targetSpm) * options.sampleRate);
  const { aligned, entries, durationFrames } = plan;
  const output = [new Float32Array(durationFrames), new Float32Array(durationFrames)];
  aligned.forEach((channels, trackIndex) => {
    const start = entries[trackIndex].startFrames;
    const previousOverlap = trackIndex > 0 ? Math.min(transitionFrames, channels[0].length, start) : 0;
    const nextOverlap = trackIndex < aligned.length - 1 ? Math.min(transitionFrames, channels[0].length) : 0;
    for (let frame = 0; frame < channels[0].length && start + frame < durationFrames; frame += 1) {
      let gain = 1;
      if (previousOverlap && frame < previousOverlap) gain *= equalPowerGains(frame / previousOverlap)[1];
      if (nextOverlap && frame >= channels[0].length - nextOverlap) gain *= equalPowerGains((frame - (channels[0].length - nextOverlap)) / nextOverlap)[0];
      output[0][start + frame] += channels[0][frame] * gain;
      output[1][start + frame] += (channels[1] ?? channels[0])[frame] * gain;
    }
  });

  const inputMusicLufs = measureIntegratedLoudness(output, options.sampleRate);
  const musicGain = transparentLoudnessGain(
    inputMusicLufs,
    measureTruePeak(output),
    options.normalizeLoudness ? options.loudnessLufs : undefined
  );
  applyGain(output, durationFrames, musicGain);
  const musicReferenceLufs = Number.isFinite(inputMusicLufs)
    ? inputMusicLufs + 20 * Math.log10(musicGain)
    : options.loudnessLufs;

  if (options.includeBeat) {
    const beat = generateBeatTrack(
      durationFrames / options.sampleRate,
      options.targetSpm,
      options.sampleRate,
      { ...options.beatTrack, gainDb: 0 },
      0,
      options.customBeatSample
    );
    const beatGain = beatTrackGainForReference(
      options.beatTrack,
      options.sampleRate,
      musicReferenceLufs,
      options.customBeatSample
    );
    for (let channel = 0; channel < 2; channel += 1) {
      for (let frame = 0; frame < durationFrames; frame += 1) {
        output[channel][frame] += beat[channel][frame] * beatGain;
      }
    }
  }
  applyGain(output, durationFrames, truePeakProtectionGain(measureTruePeak(output)));
  return output;
}

export function mixTimeline(tracks: RenderableTrack[], options: MixOptions): Float32Array[] {
  return mixPlannedTimeline(planTimeline(tracks, options), options);
}
