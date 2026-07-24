/// <reference lib="webworker" />
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { alignBpmToReference, estimateGlobalBpmConfidence, standardDeviation } from "../audio/bpm";
import { consumeEssentiaVector, disposeEssentiaVector } from "../audio/essentiaVector";
import { estimateBpmFallback, waveformPeaks } from "../audio/fallbackAnalyzer";
import { MAX_TARGET_SPM, type RawTrackAnalysis } from "../domain/types";
import type { AnalysisCommand, AnalysisEvent } from "./protocol";

const context: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function emit(event: AnalysisEvent): void {
  context.postMessage(event);
}

context.onmessage = async ({ data }: MessageEvent<AnalysisCommand>) => {
  if (data.kind !== "analyze") return;
  const { jobId, trackId, pcm, sampleRate } = data;
  let essentia: Essentia | undefined;
  try {
    emit({ protocolVersion: 1, kind: "progress", jobId, trackId, stage: "bpm", progress: 0.12 });
    let rawBpm: number;
    let rhythmBpm: number | undefined;
    let beatTicks: number[] = [];
    let bpmIntervals: number[] = [];
    const windowBpms: number[] = [];
    try {
      essentia = new Essentia(EssentiaWASM);
      const signal = essentia.arrayToVector(pcm);
      try {
        rawBpm = essentia.PercivalBpmEstimator(signal, undefined, undefined, undefined, undefined, MAX_TARGET_SPM, 50, sampleRate).bpm;
        emit({ protocolVersion: 1, kind: "progress", jobId, trackId, stage: "beats", progress: 0.42 });
        const rhythm = essentia.RhythmExtractor2013(signal, MAX_TARGET_SPM, "multifeature", 40);
        rhythmBpm = rhythm.bpm;
        beatTicks = consumeEssentiaVector(rhythm.ticks);
        consumeEssentiaVector(rhythm.estimates);
        bpmIntervals = consumeEssentiaVector(rhythm.bpmIntervals);
        const windowLength = Math.round(sampleRate * 20);
        const windowStep = Math.round(sampleRate * 10);
        for (let start = 0; start + sampleRate * 8 < pcm.length; start += windowStep) {
          const window = pcm.subarray(start, Math.min(pcm.length, start + windowLength));
          let rms = 0;
          for (let i = 0; i < window.length; i += 64) rms += window[i] * window[i];
          if (Math.sqrt(rms / Math.ceil(window.length / 64)) < 0.006) continue;
          const vector = essentia.arrayToVector(window);
          try {
            const bpm = essentia.PercivalBpmEstimator(vector, undefined, undefined, undefined, undefined, MAX_TARGET_SPM, 50, sampleRate).bpm;
            if (bpm > 0) windowBpms.push(bpm);
          } finally {
            disposeEssentiaVector(vector);
          }
        }
      } finally {
        disposeEssentiaVector(signal);
      }
    } catch (error) {
      console.warn("Essentia analysis failed; using local fallback", error);
      rawBpm = estimateBpmFallback(pcm, sampleRate);
      windowBpms.push(rawBpm);
    }
    const alignedWindows = windowBpms.map((bpm) => alignBpmToReference(bpm, rawBpm));
    const analysis: RawTrackAnalysis = {
      rawBpm,
      rhythmBpm,
      beatTicks,
      bpmConfidence: estimateGlobalBpmConfidence(rawBpm, rhythmBpm, windowBpms),
      bpmIntervals,
      windowBpms,
      bpmStdDev: standardDeviation(alignedWindows),
      maxBpmDrift: alignedWindows.length ? Math.max(...alignedWindows.map((bpm) => Math.abs(bpm - rawBpm))) : 0,
      waveformPeaks: waveformPeaks(pcm),
      analyzedAt: Date.now()
    };
    emit({ protocolVersion: 1, kind: "progress", jobId, trackId, stage: "complete", progress: 1 });
    emit({ protocolVersion: 1, kind: "complete", jobId, trackId, analysis });
  } catch (error) {
    emit({ protocolVersion: 1, kind: "failed", jobId, trackId, error: error instanceof Error ? error.message : String(error) });
  } finally {
    essentia?.shutdown?.();
  }
};
