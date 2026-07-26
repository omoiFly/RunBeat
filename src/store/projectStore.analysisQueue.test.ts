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

    const firstFile = new File(["first"], "first.wav", {
      type: "audio/wav",
      lastModified: 100
    });
    const firstImport = useProjectStore.getState().addFiles([firstFile]);
    await vi.waitFor(() => expect(mocks.decodeFile).toHaveBeenCalledTimes(1));

    const secondImport = useProjectStore.getState().addFiles([
      new File(["first"], "first.wav", { type: "audio/wav", lastModified: 100 }),
      new File(["second"], "second.wav", { type: "audio/wav", lastModified: 200 })
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
    expect(active.notice).toBe("已过滤 1 首重复歌曲。");
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

  it("filters repeats from the same selection and from the existing track list", async () => {
    mocks.decodeFile.mockResolvedValue(decoded);
    const first = new File(["same"], "same.wav", {
      type: "audio/wav",
      lastModified: 100
    });
    const firstDuplicate = new File(["same"], "same.wav", {
      type: "audio/wav",
      lastModified: 100
    });

    await useProjectStore.getState().addFiles([first, firstDuplicate]);

    let state = useProjectStore.getState();
    expect(state.project.tracks).toHaveLength(1);
    expect(state.notice).toBe("已过滤 1 首重复歌曲。");
    expect(mocks.decodeFile).toHaveBeenCalledTimes(1);

    const changedFile = new File(["changed"], "same.wav", {
      type: "audio/wav",
      lastModified: 200
    });
    await useProjectStore.getState().addFiles([
      new File(["same"], "same.wav", { type: "audio/wav", lastModified: 100 }),
      changedFile
    ]);

    state = useProjectStore.getState();
    expect(state.project.tracks.map((track) => [
      track.source.fileName,
      track.source.fileSize,
      track.source.lastModified
    ])).toEqual([
      ["same.wav", first.size, 100],
      ["same.wav", changedFile.size, 200]
    ]);
    expect(state.notice).toBe("已过滤 1 首重复歌曲。");
    expect(mocks.decodeFile).toHaveBeenCalledTimes(2);

    await useProjectStore.getState().addFiles([
      new File(["same"], "same.wav", { type: "audio/wav", lastModified: 100 })
    ]);
    state = useProjectStore.getState();
    expect(state.project.tracks).toHaveLength(2);
    expect(state.notice).toBe("已过滤 1 首重复歌曲；没有其他可导入文件。");
    expect(mocks.decodeFile).toHaveBeenCalledTimes(2);
  });

  it("allows a project to import more than fifty unique tracks", async () => {
    mocks.decodeFile.mockResolvedValue(decoded);
    const files = Array.from({ length: 51 }, (_, index) => new File(
      [`track-${index}`],
      `track-${index}.wav`,
      { type: "audio/wav", lastModified: index + 1 }
    ));

    await useProjectStore.getState().addFiles(files);

    const state = useProjectStore.getState();
    expect(state.project.tracks).toHaveLength(51);
    expect(state.project.tracks.at(-1)?.source.fileName).toBe("track-50.wav");
    expect(mocks.decodeFile).toHaveBeenCalledTimes(51);
    expect(state.notice).toBeUndefined();
  });
});
