import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomBeatSampleRef } from "../domain/types";

const mocks = vi.hoisted(() => ({ decodeFile: vi.fn(), loadCustomBeatResource: vi.fn() }));
vi.mock("./audio", () => ({ decodeFile: mocks.decodeFile }));
vi.mock("./db", () => ({ loadCustomBeatResource: mocks.loadCustomBeatResource }));
import { clearCustomBeatSamples, decodeCustomBeatFile, getCustomBeatSample, loadCustomBeatSample } from "./customBeat";

function reference(resourceId: string): CustomBeatSampleRef {
  return { resourceId, fileName: `${resourceId}.wav`, fileSize: 4, mimeType: "audio/wav", lastModified: 1, durationSeconds: 1, available: true };
}

beforeEach(() => { clearCustomBeatSamples(); vi.resetAllMocks(); });
describe("custom beat audio", () => {
  it("normalizes the uploaded one-shot without changing channel balance", async () => {
    mocks.decodeFile.mockResolvedValue({ channels: [Float32Array.from([0.5, -1]), Float32Array.from([0.25, 0.5])], sampleRate: 44_100, duration: 2 });
    const result = await decodeCustomBeatFile(new File(["beat"], "beat.wav"));
    expect(result.channels).toEqual([Float32Array.from([0.45, -0.9]), Float32Array.from([0.225, 0.45])]);
    expect(result.durationSeconds).toBe(2);
  });

  it.each([0, NaN, 4])("rejects an invalid duration of %s seconds", async (duration) => {
    mocks.decodeFile.mockResolvedValue({ channels: [Float32Array.from([0.5])], sampleRate: 44_100, duration });
    await expect(decodeCustomBeatFile(new File(["beat"], "beat.wav"))).rejects.toThrow();
  });

  it("rejects oversized input before decoding", async () => {
    await expect(decodeCustomBeatFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "beat.wav"))).rejects.toThrow("10 MB");
    expect(mocks.decodeFile).not.toHaveBeenCalled();
  });

  it("keeps distinct resource samples available when project history switches between them", async () => {
    const a = { channels: [Float32Array.from([0.9, 0.2])], sampleRate: 44_100 };
    const b = { channels: [Float32Array.from([0.1, 0.8])], sampleRate: 44_100 };
    mocks.loadCustomBeatResource.mockImplementation(async (id) => id === "a" ? a : b);
    await loadCustomBeatSample("a");
    await loadCustomBeatSample("b");
    expect(getCustomBeatSample(reference("a"))).toEqual(a);
    expect(getCustomBeatSample(reference("b"))).toEqual(b);
    clearCustomBeatSamples();
    expect(getCustomBeatSample(reference("a"))).toBeUndefined();
    await loadCustomBeatSample("a");
    expect(getCustomBeatSample(reference("a"))).toEqual(a);
  });

  it("does not reuse a cached sample after its resource is missing", async () => {
    mocks.loadCustomBeatResource.mockResolvedValueOnce({ channels: [Float32Array.from([0.9])], sampleRate: 44_100 }).mockResolvedValueOnce(undefined);
    await loadCustomBeatSample("a");
    expect(await loadCustomBeatSample("a")).toBeUndefined();
    expect(getCustomBeatSample(reference("a"))).toBeUndefined();
  });
});
