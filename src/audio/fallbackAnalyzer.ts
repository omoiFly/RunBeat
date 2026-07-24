import { MAX_TARGET_SPM } from "../domain/types";

export function estimateBpmFallback(pcm: Float32Array, sampleRate: number): number {
  const hop = 512;
  const envelopeLength = Math.floor(pcm.length / hop);
  const envelope = new Float32Array(envelopeLength);
  let previous = 0;
  for (let frame = 0; frame < envelopeLength; frame += 1) {
    let energy = 0;
    const start = frame * hop;
    for (let i = start; i < Math.min(start + hop, pcm.length); i += 1) energy += pcm[i] * pcm[i];
    const flux = Math.max(0, energy - previous);
    envelope[frame] = flux;
    previous = energy;
  }
  const minLag = Math.floor((60 * sampleRate) / (MAX_TARGET_SPM * hop));
  const maxLag = Math.ceil((60 * sampleRate) / (50 * hop));
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = lag; i < envelope.length; i += 1) score += envelope[i] * envelope[i - lag];
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return (60 * sampleRate) / (bestLag * hop);
}

export function waveformPeaks(pcm: Float32Array, buckets = 480): number[] {
  const peaks = new Array<number>(buckets).fill(0);
  const size = Math.max(1, Math.floor(pcm.length / buckets));
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    let peak = 0;
    const end = Math.min(pcm.length, (bucket + 1) * size);
    for (let i = bucket * size; i < end; i += 1) peak = Math.max(peak, Math.abs(pcm[i]));
    peaks[bucket] = peak;
  }
  return peaks;
}
