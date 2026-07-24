import { describe, expect, it } from "vitest";
import {
  IntegratedLoudnessMeter,
  TRUE_PEAK_CEILING_DBTP,
  TruePeakMeter,
  kWeightingCoefficients,
  measureIntegratedLoudness,
  measureTruePeak,
  normalizeAndLimit
} from "./loudness";

const SAMPLE_RATE = 44_100;

function stereoSine(amplitude: number, seconds = 3, frequency = 1_000): Float32Array[] {
  const frames = Math.round(seconds * SAMPLE_RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = amplitude * Math.sin(2 * Math.PI * frequency * frame / SAMPLE_RATE);
    left[frame] = sample;
    right[frame] = sample;
  }
  return [left, right];
}

function samplePeak(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

describe("BS.1770 loudness processing", () => {
  it("reproduces the published 48 kHz K-weighting coefficients", () => {
    const { shelf, highPass } = kWeightingCoefficients(48_000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 12);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 12);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 12);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 12);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 12);
    expect(highPass.b0).toBe(1);
    expect(highPass.b1).toBe(-2);
    expect(highPass.b2).toBe(1);
    expect(highPass.a1).toBeCloseTo(-1.99004745483398, 12);
    expect(highPass.a2).toBeCloseTo(0.99007225036621, 12);
  });

  it("measures a 6.02 LU increase when amplitude doubles", () => {
    const quiet = measureIntegratedLoudness(stereoSine(0.05), SAMPLE_RATE);
    const loud = measureIntegratedLoudness(stereoSine(0.1), SAMPLE_RATE);
    expect(loud - quiet).toBeCloseTo(6.0206, 3);
  });

  it("gates sustained silence out of integrated loudness", () => {
    const tone = stereoSine(0.08, 4);
    const withSilence = tone.map((channel) => {
      const result = new Float32Array(channel.length * 2);
      result.set(channel);
      return result;
    });
    const toneLoudness = measureIntegratedLoudness(tone, SAMPLE_RATE);
    const gatedLoudness = measureIntegratedLoudness(withSilence, SAMPLE_RATE);
    expect(Math.abs(gatedLoudness - toneLoudness)).toBeLessThan(0.5);
  });

  it("normalizes an unconstrained signal to the requested integrated loudness", () => {
    const channels = stereoSine(0.03);
    const result = normalizeAndLimit(channels, SAMPLE_RATE, -16);
    const outputLoudness = measureIntegratedLoudness(channels, SAMPLE_RATE);
    expect(result.inputLufs).toBeTypeOf("number");
    expect(result.limiterReductionDb).toBe(0);
    expect(outputLoudness).toBeCloseTo(-16, 1);
    expect(result.truePeakDbtp).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP + 1e-5);
  });

  it("detects inter-sample peaks with the published four-phase FIR", () => {
    const channel = new Float32Array(512);
    for (let frame = 32; frame < channel.length - 32; frame += 1) {
      channel[frame] = frame % 4 < 2 ? 0.8 : -0.8;
    }
    expect(measureTruePeak([channel])).toBeGreaterThan(samplePeak([channel]));
  });

  it("uses linked lookahead gain instead of flattening missed transient peaks", () => {
    const left = new Float32Array(SAMPLE_RATE);
    const right = new Float32Array(SAMPLE_RATE);
    left[10_000] = right[10_000] = 0.7;
    left[10_001] = right[10_001] = 1.4;
    const channels = [left, right];
    const result = normalizeAndLimit(channels, SAMPLE_RATE);
    const ceiling = 10 ** (TRUE_PEAK_CEILING_DBTP / 20);
    expect(result.limiterReductionDb).toBeGreaterThan(0);
    expect(result.limiterReductionDb).toBeLessThanOrEqual(3.05);
    expect(measureTruePeak(channels)).toBeLessThanOrEqual(ceiling + 1e-5);
    expect(channels[0][10_001] / channels[0][10_000]).toBeCloseTo(2, 1);
  });

  it("applies identical limiter gain to both stereo channels", () => {
    const left = new Float32Array(SAMPLE_RATE);
    const right = new Float32Array(SAMPLE_RATE);
    left[10_000] = 1.4;
    right[10_000] = 0.2;
    const channels = [left, right];
    normalizeAndLimit(channels, SAMPLE_RATE);
    expect(channels[0][10_000] / 1.4).toBeCloseTo(channels[1][10_000] / 0.2, 5);
  });

  it("produces identical loudness and true-peak results across arbitrary chunks", () => {
    const channels = stereoSine(0.08, 3.2, 997);
    channels[0][37_111] = 0.93;
    const expectedLoudness = measureIntegratedLoudness(channels, SAMPLE_RATE);
    const expectedTruePeak = measureTruePeak(channels);
    const loudness = new IntegratedLoudnessMeter(SAMPLE_RATE);
    const truePeak = new TruePeakMeter();
    const chunkSizes = [127, 4_321, 17, 9_999, 31_337];
    let offset = 0;
    let chunkIndex = 0;
    while (offset < channels[0].length) {
      const end = Math.min(channels[0].length, offset + chunkSizes[chunkIndex % chunkSizes.length]);
      const chunk = channels.map((channel) => channel.slice(offset, end));
      loudness.push(chunk);
      truePeak.push(chunk);
      offset = end;
      chunkIndex += 1;
    }
    expect(loudness.value()).toBeCloseTo(expectedLoudness, 10);
    expect(truePeak.value()).toBeCloseTo(expectedTruePeak, 10);
  });
});
