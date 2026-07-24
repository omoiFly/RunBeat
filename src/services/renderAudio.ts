import { beatGridPhaseAfterSourceOffset } from "../audio/bpm";
import type { RenderableTrack } from "../audio/mixer";
import type { ProjectV1, Track } from "../domain/types";
import type { DecodedAudio } from "./audio";
import { clampSourceRange, type SourceRange } from "./previewRange";

export type AudioStretcher = (channels: Float32Array[], timeRatio: number, sampleRate: number) => Promise<Float32Array[]>;

export {
  clampSourceRange,
  previewSourceRange,
  previewStartBounds,
  type PreviewStartBounds,
  type SourceRange
} from "./previewRange";

export interface PreparedTrackClip {
  audio: RenderableTrack;
  range: SourceRange;
}

type StretchCommand = { kind: "stretch"; jobId: string; channels: Float32Array[]; timeRatio: number; sampleRate: number };
type StretchResult = { kind: "complete"; jobId: string; channels: Float32Array[] }
  | { kind: "failed"; jobId: string; error: string };

interface PendingStretch {
  command: StretchCommand;
  transfer: ArrayBuffer[];
  resolve: (channels: Float32Array[]) => void;
  reject: (error: Error) => void;
}

interface RenderWorkerSlot {
  worker: Worker;
  task?: PendingStretch;
}

export interface RenderWorkerPool {
  size: number;
  stretch: AudioStretcher;
  dispose: () => void;
}

function renderAbortError(): DOMException {
  return new DOMException("渲染已取消", "AbortError");
}

function createRenderWorker(): Worker {
  return new Worker(new URL("../workers/render.worker.ts", import.meta.url), { type: "module" });
}

/** Creates independent Rubber Band WASM workers for parallel track preparation. */
export function createRenderWorkerPool(requestedSize: number, signal?: AbortSignal): RenderWorkerPool {
  const size = Math.max(1, Math.min(4, Math.floor(requestedSize) || 1));
  const queue: PendingStretch[] = [];
  const slots: RenderWorkerSlot[] = [];
  let disposed = false;

  const pump = () => {
    if (disposed) return;
    for (const slot of slots) {
      if (slot.task) continue;
      const task = queue.shift();
      if (!task) break;
      slot.task = task;
      try {
        slot.worker.postMessage(task.command, task.transfer);
      } catch (error) {
        slot.task = undefined;
        task.reject(error instanceof Error ? error : new Error(String(error)));
        slot.worker.terminate();
        attachWorker(slot);
        Promise.resolve().then(pump);
      }
    }
  };

  const attachWorker = (slot: RenderWorkerSlot) => {
    const worker = createRenderWorker();
    slot.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<StretchResult>) => {
      const task = slot.task;
      if (!task || data.jobId !== task.command.jobId) return;
      slot.task = undefined;
      if (data.kind === "complete") task.resolve(data.channels);
      else task.reject(new Error(data.error || "变速失败"));
      pump();
    };
    worker.onerror = (event) => {
      const task = slot.task;
      slot.task = undefined;
      worker.terminate();
      if (task) task.reject(new Error(event.message || "变速工作线程加载失败"));
      if (!disposed) {
        attachWorker(slot);
        pump();
      }
    };
  };

  for (let index = 0; index < size; index += 1) {
    const slot = {} as RenderWorkerSlot;
    slots.push(slot);
    attachWorker(slot);
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", abort);
    const error = signal?.aborted ? renderAbortError() : new Error("渲染工作池已释放");
    while (queue.length) queue.shift()!.reject(error);
    for (const slot of slots) {
      slot.worker.terminate();
      slot.task?.reject(error);
      slot.task = undefined;
    }
  };
  const abort = () => dispose();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) dispose();

  return {
    size,
    stretch: (channels, timeRatio, sampleRate) => new Promise<Float32Array[]>((resolve, reject) => {
      if (disposed || signal?.aborted) {
        reject(signal?.aborted ? renderAbortError() : new Error("渲染工作池已释放"));
        return;
      }
      const transfer = [...new Set(channels.map((channel) => channel.buffer as ArrayBuffer))];
      queue.push({
        command: { kind: "stretch", jobId: crypto.randomUUID(), channels, timeRatio, sampleRate },
        transfer,
        resolve,
        reject
      });
      pump();
    }),
    dispose
  };
}

let sharedRenderPool: RenderWorkerPool | undefined;

/**
 * The shared pitch-preserving stretch path used by both preview and export.
 * Preview uses one persistent worker; export creates an adaptive temporary pool.
 */
export const stretchForRender: AudioStretcher = (channels, timeRatio, sampleRate) => {
  sharedRenderPool ??= createRenderWorkerPool(1);
  return sharedRenderPool.stretch(channels, timeRatio, sampleRate);
};

/** Clips, stretches and derives phase metadata exactly as the export path does. */
export async function prepareTrackClip(
  decoded: Pick<DecodedAudio, "channels" | "sampleRate" | "duration">,
  track: Track,
  project: Pick<ProjectV1, "targetSpm">,
  requestedRange: SourceRange,
  stretch: AudioStretcher = stretchForRender
): Promise<PreparedTrackClip> {
  const range = clampSourceRange(requestedRange, decoded.duration);
  const startFrame = Math.max(0, Math.round(range.startSeconds * decoded.sampleRate));
  const endFrame = Math.min(decoded.channels[0]?.length ?? 0, Math.round(range.endSeconds * decoded.sampleRate));
  if (endFrame <= startFrame) throw new Error("试听或导出的音频片段为空，请检查入点和出点");
  const exactRange = {
    startSeconds: startFrame / decoded.sampleRate,
    endSeconds: endFrame / decoded.sampleRate
  };
  const clipped = decoded.channels.map((channel) => startFrame === 0 && endFrame === channel.length
    ? channel
    : channel.slice(startFrame, endFrame));
  const timeRatio = track.derivedAnalysis?.timeRatio ?? 1;
  const channels = await stretch(clipped, timeRatio, decoded.sampleRate);
  const phaseOffsetSeconds = beatGridPhaseAfterSourceOffset(
    track.derivedAnalysis?.phaseOffsetSeconds,
    exactRange.startSeconds,
    timeRatio,
    project.targetSpm
  );
  return {
    range: exactRange,
    audio: {
      channels,
      phaseOffsetSeconds,
      phaseNudgeBeats: track.edit.phaseNudgeBeats
    }
  };
}
