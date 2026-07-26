import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawTrackAnalysis } from "../domain/types";
import type { DecodedAudio } from "../services/audio";

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  createAnalysisWorkerPool: vi.fn(),
  decodeFile: vi.fn(),
  dispose: vi.fn()
}));

vi.mock("../services/analysis", () => ({
  createAnalysisWorkerPool: mocks.createAnalysisWorkerPool
}));

vi.mock("../services/audio", () => ({
  decodeFile: mocks.decodeFile
}));

vi.mock("../services/runtimePreload", () => ({
  prefetchFfmpegRuntime: vi.fn(),
  prefetchRubberBandRuntime: vi.fn()
}));

import { useProjectStore } from "./projectStore";

const decoded: DecodedAudio = {
  channels: [],
  mono: new Float32Array([0, 0.25, -0.25, 0]),
  sampleRate: 44_100,
  duration: 12
};

const analysis: RawTrackAnalysis = {
  rawBpm: 180,
  rhythmBpm: 180,
  beatTicks: [0.1, 0.433, 0.766, 1.099],
  bpmConfidence: 0.95,
  bpmIntervals: [180, 180, 180],
  windowBpms: [180, 180, 180],
  waveformPeaks: [0.25],
  analyzedAt: 1
};

describe("adding tracks during analysis", () => {
  beforeEach(async () => {
    mocks.analyze.mockReset();
    mocks.createAnalysisWorkerPool.mockReset();
    mocks.decodeFile.mockReset();
    mocks.dispose.mockReset();
    mocks.analyze.mockResolvedValue(analysis);
    mocks.createAnalysisWorkerPool.mockImplementation((size: number) => ({
      size,
      analyze: mocks.analyze,
      dispose: mocks.dispose
    }));
    await useProjectStore.getState().initialize();
  });

  it("appends waiting tracks to the active task without interrupting completed work", async () => {
    let resolveFirstDecode!: (value: DecodedAudio) => void;
    const firstDecode = new Promise<DecodedAudio>((resolve) => {
      resolveFirstDecode = resolve;
    });
    mocks.decodeFile.mockImplementation((file: File) =>
      file.name === "first.wav" ? firstDecode : Promise.resolve(decoded)
    );

    const firstImport = useProjectStore.getState().addFiles([
      new File(["first"], "first.wav", { type: "audio/wav" })
    ]);
    await vi.waitFor(() => expect(mocks.decodeFile).toHaveBeenCalledTimes(1));

    const secondImport = useProjectStore.getState().addFiles([
      new File(["second"], "second.wav", { type: "audio/wav" })
    ]);
    const active = useProjectStore.getState();
    expect(active.busy).toBe(true);
    expect(active.project.tracks.map((track) => [track.source.fileName, track.status])).toEqual([
      ["first.wav", "decoding"],
      ["second.wav", "queued"]
    ]);
    expect(active.analysisTask).toMatchObject({
      total: 2,
      settledTrackIds: []
    });
    expect(active.analysisTask?.trackIds).toHaveLength(2);
    expect(mocks.decodeFile).toHaveBeenCalledTimes(1);

    resolveFirstDecode(decoded);
    await Promise.all([firstImport, secondImport]);

    const completed = useProjectStore.getState();
    expect(mocks.decodeFile.mock.calls.map(([file]) => (file as File).name)).toEqual([
      "first.wav",
      "second.wav"
    ]);
    expect(mocks.createAnalysisWorkerPool).toHaveBeenCalledTimes(2);
    expect(completed.busy).toBe(false);
    expect(completed.analysisTask).toBeUndefined();
    expect(completed.project.tracks.map((track) => track.status)).toEqual(["complete", "complete"]);
    expect(completed.undoStack).toHaveLength(1);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.tracks).toHaveLength(0);
  });
});
