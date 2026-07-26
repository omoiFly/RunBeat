import { create } from "zustand";
import { deriveTrackAnalysis, estimateGlobalBpmConfidence } from "../audio/bpm";
import { tempoChangeRange } from "../domain/tempoChange";
import { clampTargetSpm, createProject, DEFAULT_PROJECT_NAME, type BeatTrackSettings, type ExportSettings, type MappingMode, type ProjectV1, type Track, type TrackEdit } from "../domain/types";
import { createAnalysisWorkerPool, type AnalysisWorkerPool } from "../services/analysis";
import { decodeFile } from "../services/audio";
import { recommendedAnalysisConcurrency } from "../services/clientPerformance";
import {
  clearCustomBeatSamples,
  cloneCustomBeatSample,
  commitCustomBeatSample,
  discardCustomBeatSample,
  registerCustomBeatSample
} from "../services/customBeat";
import { loadProject, saveProject } from "../services/db";
import { defaultExportEnabled, resolveExportEnabled } from "../services/exportSelection";
import { clearRegisteredFiles, getRegisteredFile, reconcileRegisteredFiles, registerFile, registerRelinkedFiles } from "../services/files";
import { projectNameAfterTrackChange, projectNameMode } from "../services/projectNaming";

export type ProjectSaveState = "idle" | "saving" | "error";

export interface ProjectHistoryEntry {
  project: ProjectV1;
  revision: number;
  label: string;
  mergeKey?: string;
  changedAt: number;
}

export interface AnalysisTaskState {
  trackIds: string[];
  settledTrackIds: string[];
  total: number;
}

export interface ProjectState {
  project: ProjectV1;
  savedSnapshot?: ProjectV1;
  revision: number;
  savedRevision: number;
  undoStack: ProjectHistoryEntry[];
  redoStack: ProjectHistoryEntry[];
  hasSavedRecord: boolean;
  isDirty: boolean;
  saveState: ProjectSaveState;
  saveError?: string;
  lastSavedAt?: number;
  analysisProgress: Record<string, number>;
  analysisTask?: AnalysisTaskState;
  busy: boolean;
  notice?: string;
  initialize: (projectId?: string) => Promise<void>;
  addFiles: (files: File[]) => Promise<void>;
  reanalyzeTrack: (trackId: string) => Promise<void>;
  reanalyzeTracks: (trackIds: string[]) => Promise<void>;
  undo: () => void;
  redo: () => void;
  removeTrack: (trackId: string) => void;
  removeTracks: (trackIds: string[]) => void;
  setTargetSpm: (spm: number) => void;
  setMappingMode: (mode: MappingMode) => void;
  setMaxTempoChange: (value: ProjectV1["maxTempoChangePercent"]) => void;
  updateTrackEdit: (trackId: string, patch: Partial<TrackEdit>) => void;
  setTrackExportEnabled: (trackId: string, enabled: boolean) => void;
  setTracksExportEnabled: (trackIds: string[], enabled: boolean) => void;
  resetExportSelection: () => void;
  reorderTracks: (orderedIds: string[]) => void;
  updateBeatTrack: (patch: Partial<BeatTrackSettings>) => void;
  setCustomBeatFile: (file: File) => Promise<void>;
  updateExportSettings: (patch: Partial<ExportSettings>) => void;
  renameProject: (name: string) => void;
  clearNotice: () => void;
  importProject: (project: ProjectV1) => void;
  relinkFiles: (files: File[]) => void;
  saveCurrent: (name?: string, automatic?: boolean) => Promise<boolean>;
  saveAs: (name: string) => Promise<boolean>;
  discardChanges: () => void;
}

function withDerived(project: ProjectV1): ProjectV1 {
  const legacyExportMode = project.exportSettings.mode as ExportSettings["mode"] | "beat-only";
  return {
    ...project,
    nameMode: projectNameMode(project),
    exportSettings: {
      ...project.exportSettings,
      mode: legacyExportMode === "separate" ? "separate" : "continuous",
      includeBeat: legacyExportMode === "beat-only" || project.exportSettings.includeBeat !== false,
      format: project.exportSettings.format ?? "mp3",
      mp3BitrateKbps: project.exportSettings.mp3BitrateKbps ?? 192,
      includeTimeline: project.exportSettings.includeTimeline ?? true
    },
    tracks: project.tracks.map((track) => {
      const rawAnalysis = track.rawAnalysis
        ? {
            ...track.rawAnalysis,
            bpmConfidence: track.rawAnalysis.bpmConfidence
              ?? estimateGlobalBpmConfidence(track.rawAnalysis.rawBpm, track.rawAnalysis.rhythmBpm, track.rawAnalysis.windowBpms)
          }
        : undefined;
      const derivedAnalysis = rawAnalysis
        ? deriveTrackAnalysis(
          rawAnalysis,
          project.targetSpm,
          track.edit.mappingMode ?? project.mappingMode,
          track.edit.manualBpm,
          track.edit.manualFirstBeat
        )
        : undefined;
      const normalizedTrack = {
        ...track,
        rawAnalysis,
        derivedAnalysis
      };
      const shouldResolveLegacySelection = derivedAnalysis != null
        || track.edit.inclusionMode === "include"
        || track.edit.inclusionMode === "exclude";
      const exportEnabled = track.edit.exportEnabled
        ?? (shouldResolveLegacySelection ? resolveExportEnabled(normalizedTrack, project.maxTempoChangePercent) : undefined);
      return {
        ...normalizedTrack,
        edit: { ...track.edit, exportEnabled }
      };
    })
  };
}

let persistQueue: Promise<void> = Promise.resolve();
let revisionCounter = 0;
let activeAnalysisPool: AnalysisWorkerPool | undefined;

const HISTORY_LIMIT = 50;
const HISTORY_MERGE_WINDOW_MS = 750;

function nextRevision(): number {
  revisionCounter += 1;
  return revisionCounter;
}

function prefetchRubberBandForPreview(): void {
  void import("../services/runtimePreload")
    .then(({ prefetchRubberBandRuntime }) => prefetchRubberBandRuntime());
}

function prefetchFfmpegForExport(): void {
  void import("../services/runtimePreload")
    .then(({ prefetchFfmpegRuntime }) => prefetchFfmpegRuntime());
}

function cloneProject(project: ProjectV1): ProjectV1 {
  return structuredClone(project);
}

function persist(project: ProjectV1): Promise<void> {
  const operation = persistQueue.then(() => saveProject(project));
  persistQueue = operation.catch((error) => {
    console.error("Failed to save project", error);
  });
  return operation;
}

function dirtyProject(state: ProjectState, project: ProjectV1): Partial<ProjectState> {
  return {
    project,
    revision: nextRevision(),
    isDirty: true,
    saveError: undefined
  };
}

function historicProject(
  state: ProjectState,
  project: ProjectV1,
  label: string,
  mergeKey?: string
): Partial<ProjectState> {
  if (state.busy) {
    return { notice: "分析进行中；请等待任务完成后再修改项目。" };
  }
  const changedAt = Date.now();
  const last = state.undoStack.at(-1);
  const shouldMerge = mergeKey != null
    && last?.mergeKey === mergeKey
    && changedAt - last.changedAt <= HISTORY_MERGE_WINDOW_MS;
  const undoStack = shouldMerge
    ? [...state.undoStack.slice(0, -1), { ...last, changedAt }]
    : [...state.undoStack, {
        project: state.project,
        revision: state.revision,
        label,
        mergeKey,
        changedAt
      }].slice(-HISTORY_LIMIT);
  return {
    ...dirtyProject(state, project),
    undoStack,
    redoStack: []
  };
}

function historyTrackIds(state: ProjectState, currentProject: ProjectV1): string[] {
  return [
    ...currentProject.tracks.map((track) => track.id),
    ...state.undoStack.flatMap((entry) => entry.project.tracks.map((track) => track.id)),
    ...state.redoStack.flatMap((entry) => entry.project.tracks.map((track) => track.id))
  ];
}

function settledAnalysisTask(task: AnalysisTaskState | undefined, trackId: string): AnalysisTaskState | undefined {
  if (!task || task.settledTrackIds.includes(trackId)) return task;
  return { ...task, settledTrackIds: [...task.settledTrackIds, trackId] };
}

function disposeActiveAnalysisPool(pool?: AnalysisWorkerPool): void {
  const target = pool ?? activeAnalysisPool;
  if (!target) return;
  if (activeAnalysisPool === target) activeAnalysisPool = undefined;
  target.dispose();
}

function compactTrackOrder(tracks: Track[]): Track[] {
  return [...tracks]
    .sort((left, right) => left.order - right.order)
    .map((track, order) => track.order === order ? track : { ...track, order });
}

function projectAfterTrackChange(project: ProjectV1, tracks: Track[]): ProjectV1 {
  const orderedTracks = [...tracks].sort((left, right) => left.order - right.order);
  return {
    ...project,
    ...projectNameAfterTrackChange(project, orderedTracks),
    tracks,
    updatedAt: Date.now()
  };
}

function projectWithTrackOrder(project: ProjectV1, orderedIds: string[]): ProjectV1 {
  const availableIds = new Set(project.tracks.map((track) => track.id));
  const seen = new Set<string>();
  const completeOrder: string[] = [];
  for (const id of orderedIds) {
    if (!availableIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    completeOrder.push(id);
  }
  for (const track of [...project.tracks].sort((left, right) => left.order - right.order)) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    completeOrder.push(track.id);
  }
  const orderMap = new Map(completeOrder.map((id, index) => [id, index]));
  const tracks = project.tracks.map((track) => ({ ...track, order: orderMap.get(track.id) ?? track.order }));
  if (tracks.every((track, index) => track.order === project.tracks[index].order)) return project;
  return projectAfterTrackChange(project, tracks);
}

let initializeRequest = 0;
let workspaceGeneration = 0;

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createProject(),
  savedSnapshot: undefined,
  revision: 0,
  savedRevision: 0,
  undoStack: [],
  redoStack: [],
  hasSavedRecord: false,
  isDirty: false,
  saveState: "idle",
  saveError: undefined,
  lastSavedAt: undefined,
  analysisProgress: {},
  analysisTask: undefined,
  busy: false,

  initialize: async (projectId) => {
    workspaceGeneration += 1;
    disposeActiveAnalysisPool();
    const request = ++initializeRequest;
    clearRegisteredFiles();
    clearCustomBeatSamples();
    if (!projectId) {
      set({
        project: createProject(),
        savedSnapshot: undefined,
        revision: 0,
        savedRevision: 0,
        undoStack: [],
        redoStack: [],
        hasSavedRecord: false,
        isDirty: false,
        saveState: "idle",
        saveError: undefined,
        lastSavedAt: undefined,
        analysisProgress: {},
        analysisTask: undefined,
        busy: false,
        notice: undefined
      });
      return;
    }
    const stored = await loadProject(projectId);
    if (request !== initializeRequest) return;
    if (stored) {
      const project = withDerived({
          ...stored,
          beatTrack: {
            ...stored.beatTrack,
            customSample: stored.beatTrack.customSample
              ? { ...stored.beatTrack.customSample, available: false }
              : undefined
          },
          tracks: stored.tracks.map((track) => ({ ...track, source: { ...track.source, available: false }, status: "missing" }))
        });
      set({
        project,
        savedSnapshot: cloneProject(project),
        revision: 0,
        savedRevision: 0,
        undoStack: [],
        redoStack: [],
        hasSavedRecord: true,
        isDirty: false,
        saveState: "idle",
        saveError: undefined,
        lastSavedAt: stored.updatedAt,
        analysisProgress: {},
        analysisTask: undefined,
        busy: false,
        notice: undefined
      });
      return;
    }
    set({
      project: createProject(),
      savedSnapshot: undefined,
      revision: 0,
      savedRevision: 0,
      undoStack: [],
      redoStack: [],
      hasSavedRecord: false,
      isDirty: false,
      saveState: "idle",
      saveError: undefined,
      lastSavedAt: undefined,
      analysisProgress: {},
      analysisTask: undefined,
      busy: false,
      notice: "没有找到这个本地项目，已创建新项目。"
    });
  },

  addFiles: async (selected) => {
    if (get().busy) {
      set({ notice: "正在分析其他歌曲，请等待当前任务完成。" });
      return;
    }
    const generation = ++workspaceGeneration;
    const current = get().project;
    const remaining = Math.max(0, 50 - current.tracks.length);
    const files = selected.slice(0, remaining).filter((file) => file.size <= 300 * 1024 * 1024);
    if (!files.length) {
      set({ notice: "没有可导入的文件；单个文件上限为 300 MB，项目最多 50 首。" });
      return;
    }
    const firstNewOrder = current.tracks.reduce((highest, track) => Math.max(highest, track.order), -1) + 1;
    const tracks: Track[] = files.map((file, index) => {
      const id = crypto.randomUUID();
      registerFile(id, file);
      return {
        id,
        source: {
          id,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          lastModified: file.lastModified,
          available: true
        },
        durationSeconds: 0,
        status: "queued",
        edit: { sourceInSeconds: 0, sourceOutSeconds: 0, phaseNudgeBeats: 0 },
        order: firstNewOrder + index
      };
    });
    const nextTracks = [...current.tracks, ...tracks];
    const project = projectAfterTrackChange(current, nextTracks);
    const trackIds = tracks.map((track) => track.id);
    set((state) => ({
      ...historicProject(state, project, "添加歌曲"),
      busy: true,
      analysisProgress: {
        ...state.analysisProgress,
        ...Object.fromEntries(trackIds.map((trackId) => [trackId, 0]))
      },
      analysisTask: { trackIds, settledTrackIds: [], total: trackIds.length }
    }));
    prefetchRubberBandForPreview();
    const concurrency = recommendedAnalysisConcurrency(
      tracks.length,
      Math.max(...files.map((file) => file.size))
    );
    const analysisPool = createAnalysisWorkerPool(concurrency);
    activeAnalysisPool = analysisPool;
    const workOrder = tracks
      .map((_, index) => index)
      .sort((left, right) => files[right].size - files[left].size);
    let nextWork = 0;
    const analyzeNext = async () => {
      while (nextWork < workOrder.length) {
        if (generation !== workspaceGeneration) return;
        const index = workOrder[nextWork];
        nextWork += 1;
        const track = tracks[index];
        const file = files[index];
        try {
          set((state) => generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)
            ? state
            : {
                analysisProgress: { ...state.analysisProgress, [track.id]: 0.05 },
                project: { ...state.project, tracks: state.project.tracks.map((item) => item.id === track.id ? { ...item, status: "decoding" } : item) }
              });
          if (!file) throw new Error("原始文件不可用");
          const decoded = await decodeFile(file, { createChannels: false });
          if (generation !== workspaceGeneration) return;
          set((state) => generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)
            ? state
            : { project: { ...state.project, tracks: state.project.tracks.map((item) => item.id === track.id ? { ...item, durationSeconds: decoded.duration, edit: { ...item.edit, sourceOutSeconds: decoded.duration }, status: "analyzing-bpm" } : item) } });
          const analysis = await analysisPool.analyze(track.id, decoded.mono, decoded.sampleRate, (stage, progress) => {
            if (stage === "beats" && get().project.exportSettings.format === "mp3") {
              prefetchFfmpegForExport();
            }
            set((state) => generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)
              ? state
              : {
                  analysisProgress: { ...state.analysisProgress, [track.id]: progress },
                  project: { ...state.project, tracks: state.project.tracks.map((item) => item.id === track.id ? { ...item, status: stage === "beats" ? "analyzing-beats" : item.status } : item) }
                });
          });
          set((state) => {
            if (generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)) return state;
            const next = withDerived({
              ...state.project,
              updatedAt: Date.now(),
              tracks: state.project.tracks.map((item) => item.id === track.id ? { ...item, rawAnalysis: analysis, status: "complete", error: undefined } : item)
            });
            return {
              ...dirtyProject(state, next),
              analysisProgress: { ...state.analysisProgress, [track.id]: 1 },
              analysisTask: settledAnalysisTask(state.analysisTask, track.id)
            };
          });
        } catch (error) {
          set((state) => {
            if (generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)) return state;
            const next = {
              ...state.project,
              updatedAt: Date.now(),
              tracks: state.project.tracks.map((item): Track => item.id === track.id ? { ...item, status: "failed", error: error instanceof Error ? error.message : String(error) } : item)
            };
            return {
              ...dirtyProject(state, next),
              analysisProgress: { ...state.analysisProgress, [track.id]: 1 },
              analysisTask: settledAnalysisTask(state.analysisTask, track.id)
            };
          });
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: concurrency }, () => analyzeNext()));
    } finally {
      disposeActiveAnalysisPool(analysisPool);
      if (generation === workspaceGeneration) set({ busy: false, analysisTask: undefined });
    }
  },

  reanalyzeTrack: async (trackId) => get().reanalyzeTracks([trackId]),

  reanalyzeTracks: async (requestedTrackIds) => {
    if (get().busy) {
      set({ notice: "正在分析其他歌曲，请等待当前任务完成。" });
      return;
    }
    const current = get().project;
    const requested = [...new Set(requestedTrackIds)]
      .map((trackId) => current.tracks.find((track) => track.id === trackId))
      .filter((track): track is Track => track != null);
    const available = requested
      .map((track) => ({ track, file: getRegisteredFile(track.id) }))
      .filter((item): item is { track: Track; file: File } => item.file != null);
    const missing = new Set(requested.filter((track) => !getRegisteredFile(track.id)).map((track) => track.id));
    if (missing.size) {
      set((state) => {
        const project = {
          ...state.project,
          tracks: state.project.tracks.map((track): Track => missing.has(track.id)
            ? { ...track, source: { ...track.source, available: false }, status: "missing" }
            : track)
        };
        return {
          ...dirtyProject(state, project),
          notice: available.length
            ? `${missing.size} 首歌曲缺少原始文件，已跳过。`
            : `请先重新关联 ${requested[0]?.source.fileName ?? "所选歌曲"} 的原始文件，再重新分析。`
        };
      });
    }
    if (!available.length) return;

    const generation = ++workspaceGeneration;
    const trackIds = available.map(({ track }) => track.id);
    const concurrency = recommendedAnalysisConcurrency(
      available.length,
      Math.max(...available.map(({ file }) => file.size))
    );
    const analysisPool = createAnalysisWorkerPool(concurrency);
    activeAnalysisPool = analysisPool;
    prefetchRubberBandForPreview();
    set((state) => ({
      ...historicProject(state, state.project, "重新分析歌曲"),
      busy: true,
      analysisProgress: {
        ...state.analysisProgress,
        ...Object.fromEntries(trackIds.map((trackId) => [trackId, 0]))
      },
      analysisTask: { trackIds, settledTrackIds: [], total: trackIds.length }
    }));

    const workOrder = available
      .map((_, index) => index)
      .sort((left, right) => available[right].file.size - available[left].file.size);
    let nextWork = 0;
    const analyzeNext = async () => {
      while (nextWork < workOrder.length) {
        if (generation !== workspaceGeneration) return;
        const { track, file } = available[workOrder[nextWork]];
        nextWork += 1;
        try {
          set((state) => generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)
            ? state
            : {
                analysisProgress: { ...state.analysisProgress, [track.id]: 0.05 },
                project: {
                  ...state.project,
                  tracks: state.project.tracks.map((item) => item.id === track.id
                    ? { ...item, status: "decoding", error: undefined }
                    : item)
                }
              });
          const decoded = await decodeFile(file, { createChannels: false });
          if (generation !== workspaceGeneration) return;
          set((state) => generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)
            ? state
            : {
                project: {
                  ...state.project,
                  tracks: state.project.tracks.map((item) => {
                    if (item.id !== track.id) return item;
                    const sourceOutSeconds = item.edit.sourceOutSeconds > 0
                      ? Math.min(item.edit.sourceOutSeconds, decoded.duration)
                      : decoded.duration;
                    return {
                      ...item,
                      durationSeconds: decoded.duration,
                      edit: {
                        ...item.edit,
                        sourceInSeconds: Math.min(item.edit.sourceInSeconds, sourceOutSeconds),
                        sourceOutSeconds
                      },
                      status: "analyzing-bpm"
                    };
                  })
                }
              });
          const analysis = await analysisPool.analyze(track.id, decoded.mono, decoded.sampleRate, (stage, progress) => {
            if (stage === "beats" && get().project.exportSettings.format === "mp3") {
              prefetchFfmpegForExport();
            }
            set((state) => generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)
              ? state
              : {
                  analysisProgress: { ...state.analysisProgress, [track.id]: progress },
                  project: {
                    ...state.project,
                    tracks: state.project.tracks.map((item) => item.id === track.id
                      ? { ...item, status: stage === "beats" ? "analyzing-beats" : item.status }
                      : item)
                  }
                });
          });
          set((state) => {
            if (generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)) return state;
            const next = withDerived({
              ...state.project,
              updatedAt: Date.now(),
              tracks: state.project.tracks.map((item) => item.id === track.id
                ? { ...item, rawAnalysis: analysis, status: "complete", error: undefined }
                : item)
            });
            return {
              ...dirtyProject(state, next),
              analysisProgress: { ...state.analysisProgress, [track.id]: 1 },
              analysisTask: settledAnalysisTask(state.analysisTask, track.id)
            };
          });
        } catch (error) {
          set((state) => {
            if (generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)) return state;
            const next = {
              ...state.project,
              updatedAt: Date.now(),
              tracks: state.project.tracks.map((item): Track => item.id === track.id
                ? { ...item, status: "failed", error: error instanceof Error ? error.message : String(error) }
                : item)
            };
            return {
              ...dirtyProject(state, next),
              analysisProgress: { ...state.analysisProgress, [track.id]: 1 },
              analysisTask: settledAnalysisTask(state.analysisTask, track.id)
            };
          });
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: concurrency }, () => analyzeNext()));
    } finally {
      disposeActiveAnalysisPool(analysisPool);
      if (generation === workspaceGeneration) {
        const successful = get().project.tracks.filter((track) => trackIds.includes(track.id) && track.status === "complete").length;
        set({
          busy: false,
          analysisTask: undefined,
          notice: trackIds.length === 1 && successful === 1
            ? `${available[0].track.source.fileName} 已重新分析。`
            : `重新分析完成：${successful}/${trackIds.length} 首歌曲成功。`
        });
      }
    }
  },

  undo: () => {
    set((state) => {
      if (state.busy || !state.undoStack.length) return state;
      const entry = state.undoStack.at(-1)!;
      const redoEntry: ProjectHistoryEntry = {
        project: state.project,
        revision: state.revision,
        label: entry.label,
        mergeKey: entry.mergeKey,
        changedAt: Date.now()
      };
      return {
        project: entry.project,
        revision: entry.revision,
        isDirty: entry.revision !== state.savedRevision,
        saveError: undefined,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, redoEntry].slice(-HISTORY_LIMIT),
        analysisProgress: {},
        notice: "已撤销上一步操作。"
      };
    });
  },

  redo: () => {
    set((state) => {
      if (state.busy || !state.redoStack.length) return state;
      const entry = state.redoStack.at(-1)!;
      const undoEntry: ProjectHistoryEntry = {
        project: state.project,
        revision: state.revision,
        label: entry.label,
        mergeKey: entry.mergeKey,
        changedAt: Date.now()
      };
      return {
        project: entry.project,
        revision: entry.revision,
        isDirty: entry.revision !== state.savedRevision,
        saveError: undefined,
        undoStack: [...state.undoStack, undoEntry].slice(-HISTORY_LIMIT),
        redoStack: state.redoStack.slice(0, -1),
        analysisProgress: {},
        notice: "已重做上一步操作。"
      };
    });
  },

  removeTrack: (trackId) => {
    const current = get().project;
    const tracks = compactTrackOrder(current.tracks.filter((track) => track.id !== trackId));
    if (tracks.length === current.tracks.length) return;
    const project = projectAfterTrackChange(current, tracks);
    set((state) => historicProject(state, project, "删除歌曲"));
  },

  removeTracks: (trackIds) => {
    const removing = new Set(trackIds);
    if (!removing.size) return;
    const current = get().project;
    const tracks = compactTrackOrder(current.tracks.filter((track) => !removing.has(track.id)));
    if (tracks.length === current.tracks.length) return;
    const project = projectAfterTrackChange(current, tracks);
    set((state) => historicProject(state, project, "删除歌曲"));
  },

  setTargetSpm: (targetSpm) => {
    const current = get().project;
    const normalized = clampTargetSpm(targetSpm);
    if (current.targetSpm === normalized) return;
    const project = withDerived({ ...current, targetSpm: normalized, updatedAt: Date.now() });
    set((state) => historicProject(state, project, "项目属性", "project-settings"));
  },

  setMappingMode: (mappingMode) => {
    const current = get().project;
    if (current.mappingMode === mappingMode) return;
    const project = withDerived({ ...current, mappingMode, updatedAt: Date.now() });
    set((state) => historicProject(state, project, "项目属性", "project-settings"));
  },

  setMaxTempoChange: (maxTempoChangePercent) => {
    const current = get().project;
    if (current.maxTempoChangePercent === maxTempoChangePercent) return;
    const project = { ...current, maxTempoChangePercent, updatedAt: Date.now() };
    set((state) => historicProject(state, project, "项目属性", "project-settings"));
  },

  updateTrackEdit: (trackId, patch) => {
    const current = get().project;
    const target = current.tracks.find((track) => track.id === trackId);
    if (!target || Object.entries(patch).every(([key, value]) => target.edit[key as keyof TrackEdit] === value)) return;
    const project = withDerived({
      ...current,
      tracks: current.tracks.map((track) => track.id === trackId ? { ...track, edit: { ...track.edit, ...patch } } : track),
      updatedAt: Date.now()
    });
    const mergeKey = `track-edit:${trackId}:${Object.keys(patch).sort().join(",")}`;
    set((state) => historicProject(state, project, "歌曲属性", mergeKey));
  },

  setTrackExportEnabled: (trackId, exportEnabled) => {
    const current = get().project;
    const target = current.tracks.find((track) => track.id === trackId);
    if (!target || target.edit.exportEnabled === exportEnabled) return;
    const project = {
      ...current,
      tracks: current.tracks.map((track) => track.id === trackId
        ? { ...track, edit: { ...track.edit, exportEnabled } }
        : track),
      updatedAt: Date.now()
    };
    set((state) => historicProject(state, project, "导出选择", "export-selection"));
  },

  setTracksExportEnabled: (trackIds, exportEnabled) => {
    const selected = new Set(trackIds);
    if (!selected.size) return;
    const current = get().project;
    if (!current.tracks.some((track) => selected.has(track.id) && track.edit.exportEnabled !== exportEnabled)) return;
    const project = {
      ...current,
      tracks: current.tracks.map((track) => selected.has(track.id)
        ? { ...track, edit: { ...track.edit, exportEnabled } }
        : track),
      updatedAt: Date.now()
    };
    set((state) => historicProject(state, project, "导出选择", "export-selection"));
  },

  resetExportSelection: () => {
    const current = get().project;
    const range = tempoChangeRange(current.maxTempoChangePercent);
    const project = {
      ...current,
      tracks: current.tracks.map((track) => ({
        ...track,
        edit: {
          ...track.edit,
          exportEnabled: defaultExportEnabled(track, current.maxTempoChangePercent)
        }
      })),
      updatedAt: Date.now()
    };
    const notice = Number.isFinite(range.slowDownPercent)
      ? `已按 -${range.slowDownPercent}% / +${range.speedUpPercent}% 变速范围重新选择歌曲。`
      : "已按不限变速范围重新选择歌曲。";
    const changed = current.tracks.some((track, index) => track.edit.exportEnabled !== project.tracks[index].edit.exportEnabled);
    if (!changed) {
      set({ notice });
      return;
    }
    set((state) => ({ ...historicProject(state, project, "导出选择"), notice }));
  },

  reorderTracks: (orderedIds) => {
    set((state) => {
      const project = projectWithTrackOrder(state.project, orderedIds);
      if (project === state.project) return state;
      if (!state.busy) return historicProject(state, project, "歌曲顺序", "track-order");

      const activeHistory = state.undoStack.at(-1);
      let undoStack = state.undoStack;
      if (activeHistory) {
        const historyProject = projectWithTrackOrder(activeHistory.project, orderedIds);
        if (historyProject !== activeHistory.project) {
          undoStack = [
            ...state.undoStack.slice(0, -1),
            {
              ...activeHistory,
              project: historyProject,
              revision: nextRevision(),
              changedAt: Date.now()
            }
          ];
        }
      }
      return {
        project,
        revision: nextRevision(),
        isDirty: true,
        saveError: undefined,
        undoStack,
        redoStack: []
      };
    });
  },

  updateBeatTrack: (patch) => {
    const current = get().project;
    if (Object.entries(patch).every(([key, value]) => current.beatTrack[key as keyof BeatTrackSettings] === value)) return;
    const project = { ...current, beatTrack: { ...current.beatTrack, ...patch }, updatedAt: Date.now() };
    set((state) => historicProject(state, project, "项目属性", "project-settings"));
  },

  setCustomBeatFile: async (file) => {
    const projectId = get().project.id;
    const customSample = await registerCustomBeatSample(projectId, file);
    if (get().project.id !== projectId) return;
    const current = get().project;
    const project = {
      ...current,
      beatTrack: { ...current.beatTrack, sound: "custom" as const, customSample },
      updatedAt: Date.now()
    };
    set((state) => ({ ...historicProject(state, project, "项目属性", "project-settings"), notice: `已启用自定义鼓点：${file.name}` }));
  },

  updateExportSettings: (patch) => {
    const current = get().project;
    if (Object.entries(patch).every(([key, value]) => current.exportSettings[key as keyof ExportSettings] === value)) return;
    const project = { ...current, exportSettings: { ...current.exportSettings, ...patch }, updatedAt: Date.now() };
    set((state) => historicProject(state, project, "导出设置"));
    if (project.exportSettings.format === "mp3") prefetchFfmpegForExport();
  },

  renameProject: (name) => {
    const current = get().project;
    const normalizedName = name.trim();
    if ((normalizedName || DEFAULT_PROJECT_NAME) === current.name && current.nameMode === "custom") return;
    const project = {
      ...current,
      name: normalizedName || DEFAULT_PROJECT_NAME,
      nameMode: "custom" as const,
      updatedAt: Date.now()
    };
    set((state) => historicProject(state, project, "项目属性", "project-settings"));
  },

  clearNotice: () => set({ notice: undefined }),

  importProject: (incoming) => {
    workspaceGeneration += 1;
    disposeActiveAnalysisPool();
    const project = withDerived({
      ...incoming,
      id: crypto.randomUUID(),
      name: `${incoming.name}（导入）`,
      nameMode: "custom",
      beatTrack: {
        ...incoming.beatTrack,
        customSample: incoming.beatTrack.customSample
          ? { ...incoming.beatTrack.customSample, available: false }
          : undefined
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tracks: incoming.tracks.map((track) => ({ ...track, source: { ...track.source, available: false }, status: "missing" as const }))
    });
    clearRegisteredFiles();
    clearCustomBeatSamples();
    set({
      project,
      savedSnapshot: undefined,
      revision: nextRevision(),
      savedRevision: 0,
      undoStack: [],
      redoStack: [],
      hasSavedRecord: false,
      isDirty: true,
      saveState: "idle",
      saveError: undefined,
      lastSavedAt: undefined,
      analysisProgress: {},
      analysisTask: undefined,
      busy: false,
      notice: "项目文件已导入；包含歌曲的项目会自动加入本地项目列表。"
    });
  },

  relinkFiles: (files) => {
    const current = get().project;
    const linked = new Set(registerRelinkedFiles(current.tracks.map((track) => ({ id: track.id, fileName: track.source.fileName, fileSize: track.source.fileSize, lastModified: track.source.lastModified })), files));
    const project = {
      ...current,
      updatedAt: Date.now(),
      tracks: current.tracks.map((track) => linked.has(track.id) ? { ...track, source: { ...track.source, available: true }, status: track.rawAnalysis ? "complete" as const : "queued" as const } : track)
    };
    if (!linked.size) {
      set({ notice: "没有找到名称、大小和修改时间一致的文件。" });
      return;
    }
    set((state) => ({ ...historicProject(state, project, "重新关联文件"), notice: `已重新关联 ${linked.size} 首歌曲。` }));
  },

  saveCurrent: async (name, automatic = false) => {
    let capturedProject!: ProjectV1;
    let capturedRevision = 0;
    set((state) => {
      const normalizedName = name?.trim();
      const nameChanged = normalizedName != null && normalizedName !== state.project.name;
      capturedRevision = nameChanged ? nextRevision() : state.revision;
      capturedProject = {
        ...state.project,
        name: normalizedName || state.project.name || DEFAULT_PROJECT_NAME,
        nameMode: normalizedName != null ? "custom" : projectNameMode(state.project),
        updatedAt: Date.now()
      };
      return {
        project: capturedProject,
        revision: capturedRevision,
        isDirty: true,
        saveState: "saving",
        saveError: undefined
      };
    });
    try {
      await persist(capturedProject);
      reconcileRegisteredFiles(historyTrackIds(get(), capturedProject));
      commitCustomBeatSample(capturedProject.id);
      set((state) => state.project.id !== capturedProject.id
        ? state
        : {
            savedSnapshot: cloneProject(capturedProject),
            savedRevision: capturedRevision,
            hasSavedRecord: true,
            isDirty: state.revision !== capturedRevision,
            saveState: "idle",
            saveError: undefined,
            lastSavedAt: capturedProject.updatedAt,
            notice: automatic ? state.notice : "项目已保存。"
          });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => state.project.id !== capturedProject.id
        ? state
        : {
            saveState: "error",
            saveError: message,
            isDirty: true,
            notice: `${automatic ? "自动保存" : "保存"}失败：${message}`
          });
      return false;
    }
  },

  saveAs: async (name) => {
    const sourceProjectId = get().project.id;
    const now = Date.now();
    const newProjectId = crypto.randomUUID();
    let capturedProject!: ProjectV1;
    let capturedRevision = 0;
    cloneCustomBeatSample(sourceProjectId, newProjectId);
    set((state) => {
      capturedRevision = nextRevision();
      capturedProject = {
        ...state.project,
        id: newProjectId,
        name: name.trim() || DEFAULT_PROJECT_NAME,
        nameMode: "custom",
        createdAt: now,
        updatedAt: now
      };
      return {
        project: capturedProject,
        revision: capturedRevision,
        undoStack: [],
        redoStack: [],
        isDirty: true,
        saveState: "saving",
        saveError: undefined
      };
    });
    try {
      await persist(capturedProject);
      reconcileRegisteredFiles(historyTrackIds(get(), capturedProject));
      commitCustomBeatSample(capturedProject.id);
      set((state) => ({
        savedSnapshot: cloneProject(capturedProject),
        savedRevision: capturedRevision,
        hasSavedRecord: true,
        isDirty: state.revision !== capturedRevision,
        saveState: "idle",
        saveError: undefined,
        lastSavedAt: capturedProject.updatedAt,
        notice: `项目已另存为“${capturedProject.name}”。`
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ saveState: "error", saveError: message, isDirty: true, notice: `另存失败：${message}` });
      return false;
    }
  },

  discardChanges: () => {
    workspaceGeneration += 1;
    disposeActiveAnalysisPool();
    const state = get();
    if (!state.savedSnapshot) {
      clearRegisteredFiles();
      clearCustomBeatSamples();
      set({
        project: createProject(),
        savedSnapshot: undefined,
        revision: 0,
        savedRevision: 0,
        undoStack: [],
        redoStack: [],
        hasSavedRecord: false,
        isDirty: false,
        saveState: "idle",
        saveError: undefined,
        lastSavedAt: undefined,
        analysisProgress: {},
        analysisTask: undefined,
        busy: false,
        notice: undefined
      });
      return;
    }
    const restored = cloneProject(state.savedSnapshot);
    reconcileRegisteredFiles(restored.tracks.map((track) => track.id));
    discardCustomBeatSample(restored.id);
    set({
      project: restored,
      revision: state.savedRevision,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      saveState: "idle",
      saveError: undefined,
      analysisProgress: {},
      analysisTask: undefined,
      busy: false,
      notice: "已放弃未保存的更改。"
    });
  }
}));
