import { beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  decodeFile: vi.fn()
}));
const dbMocks = vi.hoisted(() => ({
  loadCustomBeatResource: vi.fn(),
  saveCustomBeatResource: vi.fn()
}));

vi.mock("./audio", () => ({ decodeFile: audioMocks.decodeFile }));
vi.mock("./db", () => dbMocks);

import {
  clearCustomBeatSamples,
  discardCustomBeatSample,
  getCustomBeatSample,
  registerCustomBeatSample,
  restoreCustomBeatSample
} from "./customBeat";

describe("custom beat resources", () => {
  beforeEach(() => {
    clearCustomBeatSamples();
    audioMocks.decodeFile.mockReset();
    dbMocks.loadCustomBeatResource.mockReset();
    dbMocks.saveCustomBeatResource.mockReset().mockResolvedValue(undefined);
  });

  it("normalizes and persists an uploaded sample", async () => {
    audioMocks.decodeFile.mockResolvedValue({
      channels: [Float32Array.from([0.5, -1]), Float32Array.from([0.25, 0.5])],
      sampleRate: 44_100,
      duration: 2
    });
    const file = new File(["beat"], "beat.wav", { type: "audio/wav" });

    const reference = await registerCustomBeatSample("project-1", file);
    expect(reference).toMatchObject({ fileName: "beat.wav", resourceId: expect.any(String), available: true });
    expect(dbMocks.saveCustomBeatResource).toHaveBeenCalledWith(expect.objectContaining({
      id: reference.resourceId,
      sampleRate: 44_100,
      channels: [Float32Array.from([0.45, -0.9]), Float32Array.from([0.225, 0.45])]
    }));
    expect(getCustomBeatSample("project-1")?.channels[0]).toEqual(Float32Array.from([0.45, -0.9]));
  });

  it("restores a persisted sample after the in-memory cache is cleared", async () => {
    const resource = {
      id: "resource-1",
      sampleRate: 44_100,
      channels: [Float32Array.from([0.9, 0.2])]
    };
    dbMocks.loadCustomBeatResource.mockResolvedValue(resource);

    const restored = await restoreCustomBeatSample("project-1", {
      resourceId: resource.id,
      fileName: "beat.wav",
      fileSize: 4,
      mimeType: "audio/wav",
      lastModified: 1,
      durationSeconds: 1,
      available: false
    });

    expect(restored).toBe(true);
    expect(getCustomBeatSample("project-1")).toEqual({
      channels: resource.channels,
      sampleRate: resource.sampleRate
    });
  });

  it("does not erase a saved sample when discarding an unsaved-only slot", () => {
    discardCustomBeatSample("missing-project");
    expect(getCustomBeatSample("missing-project")).toBeUndefined();
  });
});
