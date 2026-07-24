/// <reference types="vite/client" />

interface EssentiaVectorFloat {
  size(): number;
  get(index: number): number;
  delete(): void;
}

declare module "essentia.js/dist/essentia-wasm.es.js" {
  export const EssentiaWASM: unknown;
}

declare module "essentia.js" {
  const packageEntry: {
    EssentiaWASM: unknown;
    Essentia: new (module: unknown) => {
      arrayToVector(input: Float32Array): EssentiaVectorFloat;
      PercivalBpmEstimator(signal: EssentiaVectorFloat, frameSize?: number, frameSizeOSS?: number, hopSize?: number, hopSizeOSS?: number, maxBpm?: number, minBpm?: number, sampleRate?: number): { bpm: number };
      RhythmExtractor2013(signal: EssentiaVectorFloat, maxTempo?: number, method?: string, minTempo?: number): {
        bpm: number;
        ticks: EssentiaVectorFloat;
        confidence: number;
        estimates: EssentiaVectorFloat;
        bpmIntervals: EssentiaVectorFloat;
      };
      shutdown(): void;
    };
  };
  export default packageEntry;
}

declare module "essentia.js/dist/essentia.js-core.es.js" {
  export default class Essentia {
    constructor(module: unknown);
    arrayToVector(input: Float32Array): EssentiaVectorFloat;
    PercivalBpmEstimator(signal: EssentiaVectorFloat, frameSize?: number, frameSizeOSS?: number, hopSize?: number, hopSizeOSS?: number, maxBpm?: number, minBpm?: number, sampleRate?: number): { bpm: number };
    RhythmExtractor2013(signal: EssentiaVectorFloat, maxTempo?: number, method?: string, minTempo?: number): {
      bpm: number;
      ticks: EssentiaVectorFloat;
      confidence: number;
      estimates: EssentiaVectorFloat;
      bpmIntervals: EssentiaVectorFloat;
    };
    shutdown(): void;
  }
}
