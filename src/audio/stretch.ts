export interface StretchOptions {
  timeRatio: number;
  windowSize?: number;
  analysisHop?: number;
}

/**
 * Pitch-preserving overlap-add fallback. The public adapter is intentionally
 * compatible with the future Rubber Band WASM implementation.
 */
export function stretchChannel(input: Float32Array, options: StretchOptions): Float32Array {
  const { timeRatio, windowSize = 2048, analysisHop = 512 } = options;
  if (Math.abs(timeRatio - 1) < 0.0001) return new Float32Array(input);
  const synthesisHop = analysisHop;
  const sourceHop = analysisHop / timeRatio;
  const outputLength = Math.max(1, Math.round(input.length * timeRatio));
  const output = new Float32Array(outputLength + windowSize);
  const weights = new Float32Array(output.length);
  const window = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (windowSize - 1));
  let source = 0;
  let destination = 0;
  while (source < input.length && destination < outputLength) {
    if (destination > 0) {
      const expected = Math.round(destination / timeRatio);
      const searchRadius = Math.min(256, Math.round(sourceHop / 2));
      let bestSource = Math.max(0, expected);
      let bestScore = -Infinity;
      const overlap = Math.min(windowSize - synthesisHop, outputLength - destination);
      for (let candidate = Math.max(0, expected - searchRadius); candidate <= Math.min(input.length - 1, expected + searchRadius); candidate += 4) {
        let correlation = 0;
        let inputEnergy = 1e-9;
        let outputEnergy = 1e-9;
        for (let i = 0; i < overlap && candidate + i < input.length; i += 8) {
          const existing = weights[destination + i] > 1e-6 ? output[destination + i] / weights[destination + i] : 0;
          const sample = input[candidate + i];
          correlation += existing * sample;
          inputEnergy += sample * sample;
          outputEnergy += existing * existing;
        }
        const score = correlation / Math.sqrt(inputEnergy * outputEnergy);
        if (score > bestScore) { bestScore = score; bestSource = candidate; }
      }
      source = bestSource;
    }
    const count = Math.min(windowSize, input.length - source, output.length - destination);
    for (let i = 0; i < count; i += 1) {
      output[destination + i] += input[source + i] * window[i];
      weights[destination + i] += window[i];
    }
    destination += synthesisHop;
    source += sourceHop;
  }
  const result = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) result[i] = weights[i] > 0.00001 ? output[i] / weights[i] : 0;
  return result;
}

export function stretchChannels(channels: Float32Array[], timeRatio: number): Float32Array[] {
  return channels.map((channel) => stretchChannel(channel, { timeRatio }));
}
