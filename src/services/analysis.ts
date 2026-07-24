import type { RawTrackAnalysis } from "../domain/types";
import type { AnalysisCommand, AnalysisEvent } from "../workers/protocol";
import { MAX_ANALYSIS_WORKERS } from "./clientPerformance";

export type TrackAnalyzer = (
  trackId: string,
  pcm: Float32Array,
  sampleRate: number,
  onProgress?: (stage: string, progress: number) => void
) => Promise<RawTrackAnalysis>;

interface PendingAnalysis {
  command: AnalysisCommand;
  transfer: ArrayBuffer[];
  onProgress?: (stage: string, progress: number) => void;
  resolve: (analysis: RawTrackAnalysis) => void;
  reject: (error: Error) => void;
}

interface AnalysisWorkerSlot {
  worker?: Worker;
  task?: PendingAnalysis;
}

export interface AnalysisWorkerPool {
  size: number;
  analyze: TrackAnalyzer;
  dispose: () => void;
}

function createAnalysisWorker(): Worker {
  return new Worker(new URL("../workers/analysis.worker.ts", import.meta.url), { type: "module" });
}

/** Creates independent Essentia runtimes so separate songs can be analyzed in parallel. */
export function createAnalysisWorkerPool(
  requestedSize: number,
  workerFactory: () => Worker = createAnalysisWorker
): AnalysisWorkerPool {
  const size = Math.max(1, Math.min(MAX_ANALYSIS_WORKERS, Math.floor(requestedSize) || 1));
  const queue: PendingAnalysis[] = [];
  const slots: AnalysisWorkerSlot[] = Array.from({ length: size }, () => ({}));
  let disposed = false;

  const attachWorker = (slot: AnalysisWorkerSlot) => {
    const worker = workerFactory();
    slot.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<AnalysisEvent>) => {
      const task = slot.task;
      if (!task || data.jobId !== task.command.jobId) return;
      if (data.kind === "progress") {
        task.onProgress?.(data.stage, data.progress);
        return;
      }
      slot.task = undefined;
      if (data.kind === "complete") task.resolve(data.analysis);
      else task.reject(new Error(data.error || "音频分析失败"));
      pump();
    };
    worker.onerror = (event) => {
      if (slot.worker !== worker) return;
      const task = slot.task;
      slot.task = undefined;
      slot.worker = undefined;
      worker.terminate();
      if (task) task.reject(new Error(event.message || "分析工作线程加载失败"));
      pump();
    };
  };

  const pump = () => {
    if (disposed) return;
    for (const slot of slots) {
      if (slot.task) continue;
      const task = queue.shift();
      if (!task) break;
      if (!slot.worker) attachWorker(slot);
      slot.task = task;
      try {
        slot.worker!.postMessage(task.command, task.transfer);
      } catch (error) {
        slot.task = undefined;
        slot.worker?.terminate();
        slot.worker = undefined;
        task.reject(error instanceof Error ? error : new Error(String(error)));
        Promise.resolve().then(pump);
      }
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const error = new Error("分析工作池已释放");
    while (queue.length) queue.shift()!.reject(error);
    for (const slot of slots) {
      slot.worker?.terminate();
      slot.worker = undefined;
      slot.task?.reject(error);
      slot.task = undefined;
    }
  };

  // Start fetching the shared Essentia worker while the first local audio file
  // is still decoding. Remaining workers stay lazy to avoid unnecessary WASM
  // initialization and memory use.
  attachWorker(slots[0]);

  return {
    size,
    analyze: (trackId, pcm, sampleRate, onProgress) => new Promise<RawTrackAnalysis>((resolve, reject) => {
      if (disposed) {
        reject(new Error("分析工作池已释放"));
        return;
      }
      const command: AnalysisCommand = {
        protocolVersion: 1,
        kind: "analyze",
        jobId: crypto.randomUUID(),
        trackId,
        pcm,
        sampleRate
      };
      queue.push({ command, transfer: [pcm.buffer as ArrayBuffer], onProgress, resolve, reject });
      pump();
    }),
    dispose
  };
}

let sharedAnalysisPool: AnalysisWorkerPool | undefined;

/** Single-song adapter used by manual reanalysis. Batch imports own a temporary adaptive pool. */
export const analyzeTrack: TrackAnalyzer = (trackId, pcm, sampleRate, onProgress) => {
  sharedAnalysisPool ??= createAnalysisWorkerPool(1);
  return sharedAnalysisPool.analyze(trackId, pcm, sampleRate, onProgress);
};
