import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, type CustomBeatSampleRef, type ProjectV1 } from "../domain/types";
const mocks = vi.hoisted(() => ({ loadProject: vi.fn(), saveProject: vi.fn(), loadCustomBeatResource: vi.fn() }));
vi.mock("../services/db", () => mocks);
import { getCustomBeatSample } from "../services/customBeat";
import { useProjectStore } from "./projectStore";

function reference(id: string): CustomBeatSampleRef {
  return { resourceId: id, fileName: `${id}.wav`, fileSize: 4, mimeType: "audio/wav", lastModified: 1, durationSeconds: 1, available: true };
}
const a = { channels: [Float32Array.from([0.9, 0.2])], sampleRate: 44_100 };
const b = { channels: [Float32Array.from([0.1, 0.8])], sampleRate: 44_100 };
let stored: Map<string, ProjectV1>;
beforeEach(async () => {
  vi.resetAllMocks();
  stored = new Map();
  const project = createProject("Saved A");
  project.id = "saved-a";
  project.beatTrack = { ...project.beatTrack, sound: "custom", customSample: reference("a") };
  stored.set(project.id, project);
  mocks.loadProject.mockImplementation(async (id) => structuredClone(stored.get(id)));
  mocks.saveProject.mockImplementation(async (next) => { stored.set(next.id, structuredClone(next)); });
  mocks.loadCustomBeatResource.mockImplementation(async (id) => id === "a" ? a : id === "b" ? b : undefined);
  await useProjectStore.getState().initialize(project.id);
});

describe("library beats in project history", () => {
  it("restores the exact samples when undoing and redoing a library choice", async () => {
    await useProjectStore.getState().applyProjectProperties({ beatTrack: { ...useProjectStore.getState().project.beatTrack, customSample: reference("b") } });
    expect(getCustomBeatSample(useProjectStore.getState().project.beatTrack.customSample)).toEqual(b);
    useProjectStore.getState().undo();
    expect(getCustomBeatSample(useProjectStore.getState().project.beatTrack.customSample)).toEqual(a);
    useProjectStore.getState().redo();
    expect(getCustomBeatSample(useProjectStore.getState().project.beatTrack.customSample)).toEqual(b);
  });

  it("shares a resource on save-as and reloads it without uploading again", async () => {
    await useProjectStore.getState().saveAs("Copy A");
    const id = useProjectStore.getState().project.id;
    expect(id).not.toBe("saved-a");
    expect(stored.get(id)?.beatTrack.customSample?.resourceId).toBe("a");
    await useProjectStore.getState().initialize(id);
    expect(getCustomBeatSample(useProjectStore.getState().project.beatTrack.customSample)).toEqual(a);
  });

  it("discards to the saved sample even if another choice was made while saving", async () => {
    let finish!: () => void;
    mocks.saveProject.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const saving = useProjectStore.getState().saveCurrent();
    await vi.waitFor(() => expect(mocks.saveProject).toHaveBeenCalled());
    await useProjectStore.getState().applyProjectProperties({ beatTrack: { ...useProjectStore.getState().project.beatTrack, customSample: reference("b") } });
    finish();
    await saving;
    useProjectStore.getState().discardChanges();
    expect(useProjectStore.getState().project.beatTrack.customSample?.resourceId).toBe("a");
    expect(getCustomBeatSample(useProjectStore.getState().project.beatTrack.customSample)).toEqual(a);
  });
});
