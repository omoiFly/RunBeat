/**
 * ITU-R BS.1770-5 / EBU R128 loudness processing for mono and stereo PCM.
 *
 * The meter uses K-weighting, 400 ms blocks with 75% overlap, the -70 LKFS
 * absolute gate and the relative -10 LU gate. Peak protection uses a
 * stereo-linked offline lookahead envelope followed by the 4x, 48th-order
 * interpolating FIR published in BS.1770-5 for true-peak verification.
 */

const LOUDNESS_OFFSET = -0.691;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
const GATING_BLOCK_SECONDS = 0.4;
const GATING_HOP_SECONDS = 0.1;
const MAX_LIMITER_REDUCTION_DB = 3;
const LIMITER_LOOKAHEAD_SECONDS = 0.005;
const LIMITER_RELEASE_SECONDS = 0.1;
const LIMITER_CHUNK_FRAMES = 1 << 18;
const TRUE_PEAK_TAPS = 12;
const TRUE_PEAK_SAFETY = 1 - 1e-6;

export const TRUE_PEAK_CEILING_DBTP = -1;

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface KWeightingCoefficients {
  shelf: BiquadCoefficients;
  highPass: BiquadCoefficients;
}

export interface LoudnessProcessingResult {
  inputLufs?: number;
  targetLufs?: number;
  requestedGainDb: number;
  normalizationGainDb: number;
  limiterReductionDb: number;
  truePeakDbtp: number;
  truePeakCorrectionDb: number;
}

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY;
}

function energyToLufs(energy: number): number {
  return energy > 0 ? LOUDNESS_OFFSET + 10 * Math.log10(energy) : Number.NEGATIVE_INFINITY;
}

/**
 * Derives the De Man K-weighting filters at the requested sample rate. At
 * 48 kHz these values reproduce the coefficients printed in BS.1770-5.
 */
export function kWeightingCoefficients(sampleRate: number): KWeightingCoefficients {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("无效的响度测量采样率");

  const shelfGainDb = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const shelfFrequency = 1681.974450955533;
  const shelfK = Math.tan(Math.PI * shelfFrequency / sampleRate);
  const shelfVh = 10 ** (shelfGainDb / 20);
  const shelfVb = shelfVh ** 0.4996667741545416;
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;

  const highPassQ = 0.5003270373238773;
  const highPassFrequency = 38.13547087602444;
  const highPassK = Math.tan(Math.PI * highPassFrequency / sampleRate);
  const highPassA0 = 1 + highPassK / highPassQ + highPassK * highPassK;

  return {
    shelf: {
      b0: (shelfVh + shelfVb * shelfK / shelfQ + shelfK * shelfK) / shelfA0,
      b1: 2 * (shelfK * shelfK - shelfVh) / shelfA0,
      b2: (shelfVh - shelfVb * shelfK / shelfQ + shelfK * shelfK) / shelfA0,
      a1: 2 * (shelfK * shelfK - 1) / shelfA0,
      a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0
    },
    highPass: {
      b0: 1,
      b1: -2,
      b2: 1,
      a1: 2 * (highPassK * highPassK - 1) / highPassA0,
      a2: (1 - highPassK / highPassQ + highPassK * highPassK) / highPassA0
    }
  };
}

function commonFrameCount(channels: Float32Array[]): number {
  if (!channels.length) return 0;
  let frames = channels[0].length;
  for (let channel = 1; channel < channels.length; channel += 1) frames = Math.min(frames, channels[channel].length);
  return frames;
}

interface KWeightingState {
  shelfState1: number;
  shelfState2: number;
  highPassState1: number;
  highPassState2: number;
}

/** Incremental BS.1770 integrated loudness meter for bounded-memory exports. */
export class IntegratedLoudnessMeter {
  private readonly blockFrames: number;
  private readonly hopFrames: number;
  private readonly segmentsPerBlock: number;
  private readonly absoluteGateEnergy: number;
  private readonly coefficients: KWeightingCoefficients;
  private readonly states: KWeightingState[] = [];
  private readonly recentSegments: number[] = [];
  private readonly absoluteGated: number[] = [];
  private channelCount?: number;
  private segmentFrames = 0;
  private segmentEnergy = 0;

  constructor(sampleRate: number) {
    this.blockFrames = Math.max(1, Math.round(GATING_BLOCK_SECONDS * sampleRate));
    this.hopFrames = Math.max(1, Math.round(GATING_HOP_SECONDS * sampleRate));
    this.segmentsPerBlock = Math.max(1, Math.round(this.blockFrames / this.hopFrames));
    this.absoluteGateEnergy = 10 ** ((ABSOLUTE_GATE_LUFS - LOUDNESS_OFFSET) / 10);
    this.coefficients = kWeightingCoefficients(sampleRate);
  }

  push(channels: Float32Array[]): void {
    const frameCount = commonFrameCount(channels);
    if (!frameCount) return;
    if (this.channelCount == null) {
      this.channelCount = channels.length;
      for (let channel = 0; channel < channels.length; channel += 1) {
        this.states.push({ shelfState1: 0, shelfState2: 0, highPassState1: 0, highPassState2: 0 });
      }
    } else if (channels.length !== this.channelCount) {
      throw new Error("响度测量期间声道数量发生变化");
    }

    const { shelf, highPass } = this.coefficients;
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        const state = this.states[channelIndex];
        const sample = channels[channelIndex][frame];
        const input = Number.isFinite(sample) ? sample : 0;
        const shelfOutput = shelf.b0 * input + state.shelfState1;
        state.shelfState1 = shelf.b1 * input - shelf.a1 * shelfOutput + state.shelfState2;
        state.shelfState2 = shelf.b2 * input - shelf.a2 * shelfOutput;
        const weighted = highPass.b0 * shelfOutput + state.highPassState1;
        state.highPassState1 = highPass.b1 * shelfOutput - highPass.a1 * weighted + state.highPassState2;
        state.highPassState2 = highPass.b2 * shelfOutput - highPass.a2 * weighted;
        this.segmentEnergy += weighted * weighted;
      }
      this.segmentFrames += 1;
      if (this.segmentFrames === this.hopFrames) this.completeSegment();
    }
  }

  private completeSegment(): void {
    this.recentSegments.push(this.segmentEnergy);
    this.segmentEnergy = 0;
    this.segmentFrames = 0;
    if (this.recentSegments.length < this.segmentsPerBlock) return;
    const blockEnergy = this.recentSegments.reduce((sum, energy) => sum + energy, 0) / this.blockFrames;
    if (blockEnergy > this.absoluteGateEnergy) this.absoluteGated.push(blockEnergy);
    this.recentSegments.shift();
  }

  value(): number {
    if (!this.absoluteGated.length) return Number.NEGATIVE_INFINITY;
    const absoluteMean = this.absoluteGated.reduce((sum, energy) => sum + energy, 0) / this.absoluteGated.length;
    const relativeGateEnergy = absoluteMean * 10 ** (RELATIVE_GATE_LU / 10);
    const finalGateEnergy = Math.max(this.absoluteGateEnergy, relativeGateEnergy);
    let finalEnergy = 0;
    let finalBlocks = 0;
    for (const energy of this.absoluteGated) {
      if (energy > finalGateEnergy) {
        finalEnergy += energy;
        finalBlocks += 1;
      }
    }
    return finalBlocks ? energyToLufs(finalEnergy / finalBlocks) : Number.NEGATIVE_INFINITY;
  }
}

/** Measures integrated programme loudness using the BS.1770 two-stage gate. */
export function measureIntegratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const meter = new IntegratedLoudnessMeter(sampleRate);
  meter.push(channels);
  return meter.value();
}

// The 48th-order, four-phase FIR from Annex 2 of ITU-R BS.1770-5.
const TRUE_PEAK_PHASES: readonly (readonly number[])[] = [
  [0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125],
  [-0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375],
  [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625, 0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875],
  [-0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875, 0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375]
];

const TRUE_PEAK_PHASE_BOUNDS = TRUE_PEAK_PHASES.map((phase) => phase.reduce((sum, coefficient) => sum + Math.abs(coefficient), 0));

/** Incremental four-phase FIR true-peak meter. */
export class TruePeakMeter {
  private readonly history: Float64Array[] = [];
  private readonly queueIndices = new Float64Array(TRUE_PEAK_TAPS + 2);
  private readonly queueValues = new Float64Array(TRUE_PEAK_TAPS + 2);
  private queueHead = 0;
  private queueTail = 0;
  private channelCount?: number;
  private position = 0;
  private peak = 0;
  private finalized = false;

  constructor(knownSamplePeak = 0) {
    this.peak = Math.max(0, knownSamplePeak);
  }

  push(channels: Float32Array[]): void {
    if (this.finalized) throw new Error("真峰值测量已经结束");
    const frameCount = commonFrameCount(channels);
    if (!frameCount) return;
    if (this.channelCount == null) {
      this.channelCount = channels.length;
      for (let channel = 0; channel < channels.length; channel += 1) this.history.push(new Float64Array(TRUE_PEAK_TAPS));
    } else if (channels.length !== this.channelCount) {
      throw new Error("真峰值测量期间声道数量发生变化");
    }
    const samples = new Float64Array(channels.length);
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < channels.length; channel += 1) {
        const sample = channels[channel][frame];
        samples[channel] = Number.isFinite(sample) ? sample : 0;
      }
      this.processFrame(samples);
    }
  }

  private processFrame(samples: Float64Array): void {
    let framePeak = 0;
    const historySlot = this.position % TRUE_PEAK_TAPS;
    for (let channel = 0; channel < samples.length; channel += 1) {
      const sample = samples[channel];
      this.history[channel][historySlot] = sample;
      const magnitude = Math.abs(sample);
      if (magnitude > framePeak) framePeak = magnitude;
    }
    if (framePeak > this.peak) this.peak = framePeak;

    const capacity = this.queueIndices.length;
    while (this.queueHead !== this.queueTail) {
      const previous = (this.queueTail - 1 + capacity) % capacity;
      if (this.queueValues[previous] > framePeak) break;
      this.queueTail = previous;
    }
    this.queueIndices[this.queueTail] = this.position;
    this.queueValues[this.queueTail] = framePeak;
    this.queueTail = (this.queueTail + 1) % capacity;
    const windowStart = Math.max(0, this.position - TRUE_PEAK_TAPS + 1);
    while (this.queueHead !== this.queueTail && this.queueIndices[this.queueHead] < windowStart) {
      this.queueHead = (this.queueHead + 1) % capacity;
    }
    const windowPeak = this.queueHead === this.queueTail ? 0 : this.queueValues[this.queueHead];

    for (let phaseIndex = 0; phaseIndex < TRUE_PEAK_PHASES.length; phaseIndex += 1) {
      if (windowPeak * TRUE_PEAK_PHASE_BOUNDS[phaseIndex] <= this.peak) continue;
      const coefficients = TRUE_PEAK_PHASES[phaseIndex];
      for (let channel = 0; channel < samples.length; channel += 1) {
        let interpolated = 0;
        for (let tap = 0; tap < TRUE_PEAK_TAPS && tap <= this.position; tap += 1) {
          const slot = (this.position - tap) % TRUE_PEAK_TAPS;
          interpolated += this.history[channel][slot] * coefficients[tap];
        }
        const magnitude = Math.abs(interpolated);
        if (magnitude > this.peak) this.peak = magnitude;
      }
    }
    this.position += 1;
  }

  value(): number {
    if (!this.finalized) {
      const zeros = new Float64Array(this.channelCount ?? 0);
      for (let frame = 0; frame < TRUE_PEAK_TAPS - 1; frame += 1) this.processFrame(zeros);
      this.finalized = true;
    }
    return this.peak;
  }
}

/** Returns the maximum 4x reconstructed peak as a linear amplitude. */
export function measureTruePeak(channels: Float32Array[], knownSamplePeak = 0): number {
  const meter = new TruePeakMeter(knownSamplePeak);
  meter.push(channels);
  return meter.value();
}

function measureSamplePeak(channels: Float32Array[], frameCount: number): number {
  let peak = 0;
  for (const channel of channels) {
    for (let frame = 0; frame < frameCount; frame += 1) {
      const magnitude = Number.isFinite(channel[frame]) ? Math.abs(channel[frame]) : 0;
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

function applyGain(channels: Float32Array[], frameCount: number, gain: number): void {
  if (gain === 1) return;
  for (const channel of channels) {
    for (let frame = 0; frame < frameCount; frame += 1) channel[frame] *= gain;
  }
}

function applyLookaheadLimiter(
  channels: Float32Array[],
  frameCount: number,
  sampleRate: number,
  normalizationGain: number,
  ceiling: number
): { samplePeak: number; maximumAttenuation: number } {
  const lookaheadFrames = Math.max(1, Math.round(LIMITER_LOOKAHEAD_SECONDS * sampleRate));
  const attackStep = 1 / lookaheadFrames;
  const releaseCoefficient = Math.exp(-1 / (LIMITER_RELEASE_SECONDS * sampleRate));
  let currentAttenuation = 0;
  let maximumAttenuation = 0;
  let samplePeak = 0;

  for (let chunkStart = 0; chunkStart < frameCount; chunkStart += LIMITER_CHUNK_FRAMES) {
    const chunkEnd = Math.min(frameCount, chunkStart + LIMITER_CHUNK_FRAMES);
    const detectorEnd = Math.min(frameCount, chunkEnd + lookaheadFrames);
    const attenuation = new Float32Array(detectorEnd - chunkStart);

    for (let frame = chunkStart; frame < detectorEnd; frame += 1) {
      let framePeak = 0;
      for (const channel of channels) {
        const magnitude = Number.isFinite(channel[frame]) ? Math.abs(channel[frame]) : 0;
        if (magnitude > framePeak) framePeak = magnitude;
      }
      const normalizedPeak = framePeak * normalizationGain;
      attenuation[frame - chunkStart] = normalizedPeak > ceiling ? 1 - ceiling / normalizedPeak : 0;
    }

    for (let index = attenuation.length - 2; index >= 0; index -= 1) {
      attenuation[index] = Math.max(attenuation[index], attenuation[index + 1] - attackStep);
    }

    for (let frame = chunkStart; frame < chunkEnd; frame += 1) {
      const targetAttenuation = attenuation[frame - chunkStart];
      currentAttenuation = targetAttenuation > currentAttenuation
        ? targetAttenuation
        : Math.max(targetAttenuation, currentAttenuation * releaseCoefficient);
      if (currentAttenuation > maximumAttenuation) maximumAttenuation = currentAttenuation;
      const gain = normalizationGain * (1 - currentAttenuation);
      for (const channel of channels) {
        const output = (Number.isFinite(channel[frame]) ? channel[frame] : 0) * gain;
        channel[frame] = output;
        const magnitude = Math.abs(output);
        if (magnitude > samplePeak) samplePeak = magnitude;
      }
    }
  }
  return { samplePeak, maximumAttenuation };
}

/**
 * Applies integrated loudness normalization and transparent peak protection in
 * place. There is deliberately no hard sample clamp in this path.
 */
export function normalizeAndLimit(
  channels: Float32Array[],
  sampleRate: number,
  targetLufs?: number
): LoudnessProcessingResult {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("无效的响度处理采样率");
  const frameCount = commonFrameCount(channels);
  if (!frameCount) {
    return {
      inputLufs: targetLufs == null ? undefined : Number.NEGATIVE_INFINITY,
      targetLufs,
      requestedGainDb: 0,
      normalizationGainDb: 0,
      limiterReductionDb: 0,
      truePeakDbtp: Number.NEGATIVE_INFINITY,
      truePeakCorrectionDb: 0
    };
  }

  const inputLufs = targetLufs == null ? undefined : measureIntegratedLoudness(channels, sampleRate);
  const requestedGainDb = targetLufs != null && inputLufs != null && Number.isFinite(inputLufs)
    ? targetLufs - inputLufs
    : 0;
  const inputSamplePeak = measureSamplePeak(channels, frameCount);
  const maximumTransparentGainDb = inputSamplePeak > 0
    ? TRUE_PEAK_CEILING_DBTP + MAX_LIMITER_REDUCTION_DB - gainToDb(inputSamplePeak)
    : requestedGainDb;
  const normalizationGainDb = Math.min(requestedGainDb, maximumTransparentGainDb);
  const normalizationGain = dbToGain(normalizationGainDb);
  const ceiling = dbToGain(TRUE_PEAK_CEILING_DBTP);
  const limited = applyLookaheadLimiter(channels, frameCount, sampleRate, normalizationGain, ceiling);
  const measuredTruePeak = measureTruePeak(channels, limited.samplePeak);
  const correction = measuredTruePeak > ceiling
    ? ceiling / measuredTruePeak * TRUE_PEAK_SAFETY
    : 1;
  applyGain(channels, frameCount, correction);

  return {
    inputLufs,
    targetLufs,
    requestedGainDb,
    normalizationGainDb,
    limiterReductionDb: limited.maximumAttenuation > 0 ? -gainToDb(1 - limited.maximumAttenuation) : 0,
    truePeakDbtp: gainToDb(measuredTruePeak * correction),
    truePeakCorrectionDb: gainToDb(correction)
  };
}
