import { describe, expect, it } from "vitest";
import type { BeatTrackSettings } from "../domain/types";
import { IntegratedLoudnessMeter, transparentLoudnessGain, truePeakProtectionGain, TruePeakMeter } from "./loudness";
import { mixPlannedTimeline, planTimeline, planTimelineGeometry, type MixOptions, type RenderableTrack } from "./mixer";
import { streamPlannedTimeline } from "./streamingMixer";

const beatTrack: BeatTrackSettings = {
  sound: "click",
  gainDb: -14,
  accentEvery: 0,
  alternateFeet: false,
  duckingEnabled: false
};

function track(length: number, phaseOffsetSeconds: number | undefined, phaseNudgeBeats = 0): RenderableTrack {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let frame = 0; frame < length; frame += 1) {
    left[frame] = Math.sin(frame / 23) * 0.08;
    right[frame] = Math.cos(frame / 31) * 0.06;
  }
  return { channels: [left, right], phaseOffsetSeconds, phaseNudgeBeats };
}

function cloneTrack(source: RenderableTrack): RenderableTrack {
  return { ...source, channels: source.channels.map((channel) => new Float32Array(channel)) };
}

describe("streaming timeline mixer", () => {
  it("matches the in-memory mixer while loading only the current track", async () => {
    const sources = [track(2_300, 0.08), track(1_900, 0.17, -0.25), track(2_100, undefined)];
    const options: MixOptions = {
      sampleRate: 1_000,
      targetSpm: 240,
      transitionBars: 1,
      beatTrack,
      normalizeLoudness: false,
      loudnessLufs: -14,
      includeBeat: false
    };
    const plan = planTimeline(sources.map(cloneTrack), options);
    const expected = mixPlannedTimeline(plan, options);
    const geometry = planTimelineGeometry(sources.map((source) => ({
      frameCount: source.channels[0].length,
      phaseOffsetSeconds: source.phaseOffsetSeconds,
      phaseNudgeBeats: source.phaseNudgeBeats
    })), options);
    const actual = [new Float32Array(geometry.durationFrames), new Float32Array(geometry.durationFrames)];
    const loadOrder: number[] = [];
    await streamPlannedTimeline(
      geometry,
      async (index) => {
        loadOrder.push(index);
        return cloneTrack(sources[index]);
      },
      options,
      (channels, startFrame) => {
        actual[0].set(channels[0], startFrame);
        actual[1].set(channels[1], startFrame);
      }
    );
    expect(loadOrder).toEqual([0, 1, 2]);
    expect(actual[0]).toEqual(expected[0]);
    expect(actual[1]).toEqual(expected[1]);
  });

  it("matches the music-first in-memory pipeline when a calibrated beat is included", async () => {
    const sources = [track(44_100, undefined)];
    const options: MixOptions = {
      sampleRate: 44_100,
      targetSpm: 180,
      transitionBars: 0,
      beatTrack: { ...beatTrack, gainDb: -10 },
      normalizeLoudness: true,
      loudnessLufs: -20,
      includeBeat: true
    };
    const expected = mixPlannedTimeline(planTimeline(sources.map(cloneTrack), options), options);
    const geometry = planTimelineGeometry(sources.map((source) => ({
      frameCount: source.channels[0].length,
      phaseOffsetSeconds: source.phaseOffsetSeconds,
      phaseNudgeBeats: source.phaseNudgeBeats
    })), options);

    const musicLoudness = new IntegratedLoudnessMeter(options.sampleRate);
    const musicTruePeak = new TruePeakMeter();
    await streamPlannedTimeline(
      geometry,
      async (index) => cloneTrack(sources[index]),
      { ...options, includeBeat: false },
      (channels) => {
        musicLoudness.push(channels);
        musicTruePeak.push(channels);
      }
    );
    const inputMusicLufs = musicLoudness.value();
    const musicGain = transparentLoudnessGain(inputMusicLufs, musicTruePeak.value(), options.loudnessLufs);
    const mixedOptions: MixOptions = {
      ...options,
      musicGain,
      beatReferenceLufs: inputMusicLufs + 20 * Math.log10(musicGain)
    };
    const finalTruePeak = new TruePeakMeter();
    await streamPlannedTimeline(
      geometry,
      async (index) => cloneTrack(sources[index]),
      mixedOptions,
      (channels) => finalTruePeak.push(channels)
    );
    const finalGain = truePeakProtectionGain(finalTruePeak.value());
    const actual = [new Float32Array(geometry.durationFrames), new Float32Array(geometry.durationFrames)];
    await streamPlannedTimeline(
      geometry,
      async (index) => cloneTrack(sources[index]),
      mixedOptions,
      (channels, startFrame) => {
        for (let channel = 0; channel < channels.length; channel += 1) {
          for (let frame = 0; frame < channels[channel].length; frame += 1) {
            actual[channel][startFrame + frame] = channels[channel][frame] * finalGain;
          }
        }
      }
    );

    let maximumDifference = 0;
    for (let channel = 0; channel < actual.length; channel += 1) {
      for (let frame = 0; frame < actual[channel].length; frame += 1) {
        maximumDifference = Math.max(maximumDifference, Math.abs(actual[channel][frame] - expected[channel][frame]));
      }
    }
    expect(maximumDifference).toBeLessThan(1e-6);
  });
});
