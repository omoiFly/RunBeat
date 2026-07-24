import { describe, expect, it, vi } from "vitest";
import type { RawTrackAnalysis } from "../domain/types";
import type { AnalysisCommand, AnalysisEvent } from "../workers/protocol";
import { createAnalysisWorkerPool } from "./analysis";
import { MAX_ANALYSIS_WORKERS } from "./clientPerformance";

const analysis: RawTrackAnalysis = {
  rawBpm: 180,
  beatTicks: [0, 1 / 3],
  bpmIntervals: [1 / 3],
  windowBpms: [180],
  waveformPeaks: [],
  analyzedAt: 1
};

class FakeAnalysisWorker {
  onmessage: ((event: MessageEvent<AnalysisEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  commands: AnalysisCommand[] = [];
  terminated = false;

  postMessage(command: AnalysisCommand): void {
    this.commands.push(command);
  }

  emit(event: AnalysisEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<AnalysisEvent>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("analysis worker pool", () => {
  it("accepts the adaptive high-performance limit without exceeding it", () => {
    const workers: FakeAnalysisWorker[] = [];
    const pool = createAnalysisWorkerPool(MAX_ANALYSIS_WORKERS + 10, () => {
      const worker = new FakeAnalysisWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    expect(pool.size).toBe(MAX_ANALYSIS_WORKERS);
    expect(workers).toHaveLength(1);
    pool.dispose();
    expect(workers[0].terminated).toBe(true);
  });

  it("runs independent jobs concurrently and dispatches queued work in order", async () => {
    const workers: FakeAnalysisWorker[] = [];
    const progress = vi.fn();
    const pool = createAnalysisWorkerPool(2, () => {
      const worker = new FakeAnalysisWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const jobs = ["a", "b", "c"].map((trackId) => pool.analyze(
      trackId,
      new Float32Array([0, 1]),
      44_100,
      progress
    ));

    expect(workers).toHaveLength(2);
    expect(workers.map((worker) => worker.commands.map((command) => command.trackId))).toEqual([["a"], ["b"]]);

    const first = workers[0].commands[0];
    workers[0].emit({ protocolVersion: 1, kind: "progress", jobId: first.jobId, trackId: "a", stage: "beats", progress: 0.5 });
    expect(progress).toHaveBeenCalledWith("beats", 0.5);
    workers[0].emit({ protocolVersion: 1, kind: "complete", jobId: first.jobId, trackId: "a", analysis });
    await jobs[0];
    expect(workers[0].commands.map((command) => command.trackId)).toEqual(["a", "c"]);

    for (const worker of workers) {
      const pending = worker.commands.at(-1)!;
      if (pending.trackId === "a") continue;
      worker.emit({ protocolVersion: 1, kind: "complete", jobId: pending.jobId, trackId: pending.trackId, analysis });
    }
    await expect(Promise.all(jobs)).resolves.toEqual([analysis, analysis, analysis]);
    pool.dispose();
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });
});
