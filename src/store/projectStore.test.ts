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
    savedRevision: 0,
    undoStack: [],
    redoStack: [],
    isDirty: false,
    analysisProgress: {},
    analysisTask: undefined,
    busy: false
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

describe("project edit history", () => {
  it("undoes and redoes project edits while updating the dirty state", () => {
    useProjectStore.getState().setTargetSpm(192);

    expect(useProjectStore.getState()).toMatchObject({
      isDirty: true,
      project: { targetSpm: 192 }
    });
    expect(useProjectStore.getState().undoStack).toHaveLength(1);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState()).toMatchObject({
      isDirty: false,
      project: { targetSpm: 180 }
    });
    expect(useProjectStore.getState().redoStack).toHaveLength(1);

    useProjectStore.getState().redo();
    expect(useProjectStore.getState()).toMatchObject({
      isDirty: true,
      project: { targetSpm: 192 }
    });
  });

  it("groups one project-properties apply into a single undo step", () => {
    useProjectStore.getState().setTargetSpm(188);
    useProjectStore.getState().setMappingMode("one-step-per-beat");
    useProjectStore.getState().setMaxTempoChange(10);

    expect(useProjectStore.getState().undoStack).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project).toMatchObject({
      targetSpm: 180,
      mappingMode: "auto",
      maxTempoChangePercent: 20
    });
  });

  it("clears redo history after a new edit", () => {
    useProjectStore.getState().setTargetSpm(188);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().redoStack).toHaveLength(1);

    useProjectStore.getState().setMappingMode("two-steps-per-beat");
    expect(useProjectStore.getState().redoStack).toHaveLength(0);
  });
});

describe("analysis cancellation", () => {
  it("returns an interrupted new track to the waiting state", () => {
    useProjectStore.setState((state) => ({
      project: { ...state.project, tracks: [{ ...track("active", 0), status: "analyzing-bpm" }] },
      busy: true,
      analysisProgress: { active: 0.42 },
      analysisTask: { kind: "add", trackIds: ["active"], settledTrackIds: [], total: 1 }
    }));

    useProjectStore.getState().cancelAnalysis();

    expect(useProjectStore.getState()).toMatchObject({
      busy: false,
      analysisTask: undefined,
      analysisProgress: {},
      project: { tracks: [{ status: "queued" }] }
    });
  });

  it("restores the previous result when reanalysis is canceled", () => {
    const previousProject = {
      ...createProject(),
      tracks: [{ ...track("active", 0), status: "complete" as const }]
    };
    useProjectStore.setState({
      project: {
        ...previousProject,
        tracks: [{ ...previousProject.tracks[0], status: "analyzing-beats" }]
      },
      revision: 12,
      savedRevision: 11,
      undoStack: [{
        project: previousProject,
        revision: 11,
        label: "重新分析歌曲",
        changedAt: Date.now()
      }],
      redoStack: [],
      isDirty: true,
      busy: true,
      analysisProgress: { active: 0.7 },
      analysisTask: { kind: "reanalyze", trackIds: ["active"], settledTrackIds: [], total: 1 }
    });

    useProjectStore.getState().cancelAnalysis();

    expect(useProjectStore.getState()).toMatchObject({
      project: { tracks: [{ status: "complete" }] },
      revision: 11,
      isDirty: false,
      undoStack: [],
      busy: false,
      analysisTask: undefined
    });
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
