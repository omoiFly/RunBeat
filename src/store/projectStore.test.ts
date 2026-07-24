import { beforeEach, describe, expect, it } from "vitest";
import { createProject, type Track } from "../domain/types";
import { useProjectStore } from "./projectStore";

function track(id: string, order: number): Track {
  return {
    id,
    source: {
      id,
      fileName: `${id}.wav`,
      fileSize: 1,
      mimeType: "audio/wav",
      lastModified: 0,
      available: true
    },
    durationSeconds: 1,
    status: "queued",
    edit: {
      sourceInSeconds: 0,
      sourceOutSeconds: 1,
      phaseNudgeBeats: 0
    },
    order
  };
}

beforeEach(() => {
  useProjectStore.setState({
    project: createProject(),
    revision: 0,
    isDirty: false
  });
});

describe("track removal order", () => {
  it("removes one track without reverting the remaining display order to insertion order", () => {
    useProjectStore.setState({
      project: {
        ...createProject(),
        tracks: [track("first-added", 0), track("second-added", 1), track("third-added", 2)]
      }
    });
    // Reordering updates the explicit order values while deliberately leaving
    // the backing array in insertion order.
    useProjectStore.getState().reorderTracks(["second-added", "third-added", "first-added"]);

    useProjectStore.getState().removeTrack("third-added");

    expect(useProjectStore.getState().project.tracks.map(({ id, order }) => ({ id, order }))).toEqual([
      { id: "second-added", order: 0 },
      { id: "first-added", order: 1 }
    ]);
  });

  it("removes multiple tracks while preserving the relative order of every survivor", () => {
    useProjectStore.setState({
      project: {
        ...createProject(),
        tracks: [
          track("a", 3),
          track("b", 0),
          track("c", 2),
          track("d", 1)
        ]
      }
    });

    useProjectStore.getState().removeTracks(["d", "a"]);

    expect(useProjectStore.getState().project.tracks.map(({ id, order }) => ({ id, order }))).toEqual([
      { id: "b", order: 0 },
      { id: "c", order: 1 }
    ]);
  });
});

describe("automatic project naming", () => {
  it("follows the first track in playback order and updates the song count", () => {
    useProjectStore.setState({
      project: {
        ...createProject(),
        tracks: [track("first-song", 0), track("second-song", 1)]
      }
    });

    useProjectStore.getState().reorderTracks(["second-song", "first-song"]);
    expect(useProjectStore.getState().project).toMatchObject({
      name: "second-song 等 2 首",
      nameMode: "auto"
    });

    useProjectStore.getState().removeTrack("first-song");
    expect(useProjectStore.getState().project).toMatchObject({
      name: "second-song",
      nameMode: "auto"
    });
  });
});

describe("target cadence range", () => {
  it("accepts 60–230 SPM and clamps values outside the supported range", () => {
    useProjectStore.getState().setTargetSpm(59);
    expect(useProjectStore.getState().project.targetSpm).toBe(60);

    useProjectStore.getState().setTargetSpm(230);
    expect(useProjectStore.getState().project.targetSpm).toBe(230);

    useProjectStore.getState().setTargetSpm(231);
    expect(useProjectStore.getState().project.targetSpm).toBe(230);
  });
});

describe("legacy export settings", () => {
  it.each([
    ["continuous", "continuous"],
    ["separate", "separate"],
    ["beat-only", "continuous"]
  ] as const)("migrates %s projects to a music export with beats", (legacyMode, expectedMode) => {
    const project = createProject();
    const legacySettings = project.exportSettings as unknown as { mode: string; includeBeat?: boolean };
    legacySettings.mode = legacyMode;
    delete legacySettings.includeBeat;

    useProjectStore.getState().importProject(project);

    expect(useProjectStore.getState().project.exportSettings).toMatchObject({
      mode: expectedMode,
      includeBeat: true
    });
  });
});
