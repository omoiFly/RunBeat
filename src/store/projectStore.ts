import { create } from "zustand";
import { deriveTrackAnalysis, estimateGlobalBpmConfidence } from "../audio/bpm";
import { tempoChangeRange } from "../domain/tempoChange";
import { clampTargetSpm, createProject, DEFAULT_PROJECT_NAME, type BeatTrackSettings, type ExportSettings, type MappingMode, type ProjectV1, type Track, type TrackEdit } from "../domain/types";
import { analyzeTrack, createAnalysisWorkerPool } from "../services/analysis";
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

export interface ProjectState {
  project: ProjectV1;
  savedSnapshot?: ProjectV1;
  revision: number;
  savedRevision: number;
  hasSavedRecord: boolean;
  isDirty: boolean;
  saveState: ProjectSaveState;
  saveError?: string;
  lastSavedAt?: number;
  analysisProgress: Record<string, number>;
  busy: boolean;
  notice?: string;
  initialize: (projectId?: string) => Promise<void>;
  addFiles: (files: File[]) => Promise<void>;
  reanalyzeTrack: (trackId: string) => Promise<void>;
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
    revision: state.revision + 1,
    isDirty: true,
    saveError: undefined
  };
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

let initializeRequest = 0;
let workspaceGeneration = 0;

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createProject(),
  savedSnapshot: undefined,
  revision: 0,
  savedRevision: 0,
  hasSavedRecord: false,
  isDirty: false,
  saveState: "idle",
  saveError: undefined,
  lastSavedAt: undefined,
  analysisProgress: {},
  busy: false,

  initialize: async (projectId) => {
    workspaceGeneration += 1;
    const request = ++initializeRequest;
    clearRegisteredFiles();
    clearCustomBeatSamples();
    if (!projectId) {
      set({
        project: createProject(),
        savedSnapshot: undefined,
        revision: 0,
        savedRevision: 0,
        hasSavedRecord: false,
        isDirty: false,
        saveState: "idle",
        saveError: undefined,
        lastSavedAt: undefined,
        analysisProgress: {},
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
        hasSavedRecord: true,
        isDirty: false,
        saveState: "idle",
        saveError: undefined,
        lastSavedAt: stored.updatedAt,
        analysisProgress: {},
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
      hasSavedRecord: false,
      isDirty: false,
      saveState: "idle",
      saveError: undefined,
      lastSavedAt: undefined,
      analysisProgress: {},
      busy: false,
      notice: "没有找到这个本地项目，已创建新项目。"
    });
  },

  addFiles: async (selected) => {
    const generation = workspaceGeneration;
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
    set((state) => ({ ...dirtyProject(state, project), busy: true }));
    prefetchRubberBandForPreview();
    const concurrency = recommendedAnalysisConcurrency(
      tracks.length,
      Math.max(...files.map((file) => file.size))
    );
    const analysisPool = createAnalysisWorkerPool(concurrency);
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
            : { project: { ...state.project, tracks: state.project.tracks.map((item) => item.id === track.id ? { ...item, status: "decoding" } : item) } });
          if (!file) throw new Error("原始文件不可用");
          const decoded = await decodeFile(file, { createChannels: false });
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
            return dirtyProject(state, next);
          });
        } catch (error) {
          set((state) => {
            if (generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === track.id)) return state;
            const next = {
              ...state.project,
              updatedAt: Date.now(),
              tracks: state.project.tracks.map((item): Track => item.id === track.id ? { ...item, status: "failed", error: error instanceof Error ? error.message : String(error) } : item)
            };
            return dirtyProject(state, next);
          });
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: concurrency }, () => analyzeNext()));
    } finally {
      analysisPool.dispose();
      if (generation === workspaceGeneration) set({ busy: false });
    }
  },

  reanalyzeTrack: async (trackId) => {
    const generation = workspaceGeneration;
    const track = get().project.tracks.find((item) => item.id === trackId);
    if (!track) return;
    const file = getRegisteredFile(trackId);
    if (!file) {
      set((state) => {
        const project = {
          ...state.project,
          tracks: state.project.tracks.map((item): Track => item.id === trackId
            ? { ...item, source: { ...item.source, available: false }, status: "missing" }
            : item)
        };
        return { ...dirtyProject(state, project), notice: `请先重新关联 ${track.source.fileName} 的原始文件，再重新分析。` };
      });
      return;
    }
    prefetchRubberBandForPreview();
    set((state) => generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === trackId)
      ? state
      : {
          busy: true,
          analysisProgress: { ...state.analysisProgress, [trackId]: 0.05 },
          project: {
            ...state.project,
            tracks: state.project.tracks.map((item) => item.id === trackId
              ? { ...item, status: "decoding", error: undefined }
              : item)
          }
        });
    try {
      const decoded = await decodeFile(file, { createChannels: false });
      set((state) => generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === trackId)
        ? state
        : {
            project: {
              ...state.project,
              tracks: state.project.tracks.map((item) => {
                if (item.id !== trackId) return item;
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
      const analysis = await analyzeTrack(trackId, decoded.mono, decoded.sampleRate, (stage, progress) => {
        if (stage === "beats" && get().project.exportSettings.format === "mp3") {
          prefetchFfmpegForExport();
        }
        set((state) => generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === trackId)
          ? state
          : {
              analysisProgress: { ...state.analysisProgress, [trackId]: progress },
              project: {
                ...state.project,
                tracks: state.project.tracks.map((item) => item.id === trackId
                  ? { ...item, status: stage === "beats" ? "analyzing-beats" : item.status }
                  : item)
              }
            });
      });
      set((state) => {
        if (generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === trackId)) return state;
        const next = withDerived({
          ...state.project,
          updatedAt: Date.now(),
          tracks: state.project.tracks.map((item) => item.id === trackId
            ? { ...item, rawAnalysis: analysis, status: "complete", error: undefined }
            : item)
        });
        return { ...dirtyProject(state, next), notice: `${track.source.fileName} 已重新分析。` };
      });
    } catch (error) {
      set((state) => {
        if (generation !== workspaceGeneration || !state.project.tracks.some((item) => item.id === trackId)) return state;
        const next = {
          ...state.project,
          updatedAt: Date.now(),
          tracks: state.project.tracks.map((item): Track => item.id === trackId
            ? { ...item, status: "failed", error: error instanceof Error ? error.message : String(error) }
            : item)
        };
        return dirtyProject(state, next);
      });
    } finally {
      if (generation === workspaceGeneration) set({ busy: false });
    }
  },

  removeTrack: (trackId) => {
    const current = get().project;
    const tracks = compactTrackOrder(current.tracks.filter((track) => track.id !== trackId));
    const project = projectAfterTrackChange(current, tracks);
    set((state) => dirtyProject(state, project));
  },

  removeTracks: (trackIds) => {
    const removing = new Set(trackIds);
    if (!removing.size) return;
    const current = get().project;
    const tracks = compactTrackOrder(current.tracks.filter((track) => !removing.has(track.id)));
    if (tracks.length === current.tracks.length) return;
    const project = projectAfterTrackChange(current, tracks);
    set((state) => dirtyProject(state, project));
  },

  setTargetSpm: (targetSpm) => {
    const project = withDerived({ ...get().project, targetSpm: clampTargetSpm(targetSpm), updatedAt: Date.now() });
    set((state) => dirtyProject(state, project));
  },

  setMappingMode: (mappingMode) => {
    const project = withDerived({ ...get().project, mappingMode, updatedAt: Date.now() });
    set((state) => dirtyProject(state, project));
  },

  setMaxTempoChange: (maxTempoChangePercent) => {
    const project = { ...get().project, maxTempoChangePercent, updatedAt: Date.now() };
    set((state) => dirtyProject(state, project));
  },

  updateTrackEdit: (trackId, patch) => {
    const project = withDerived({ ...get().project, tracks: get().project.tracks.map((track) => track.id === trackId ? { ...track, edit: { ...track.edit, ...patch } } : track), updatedAt: Date.now() });
    set((state) => dirtyProject(state, project));
  },

  setTrackExportEnabled: (trackId, exportEnabled) => {
    const project = {
      ...get().project,
      tracks: get().project.tracks.map((track) => track.id === trackId
        ? { ...track, edit: { ...track.edit, exportEnabled } }
        : track),
      updatedAt: Date.now()
    };
    set((state) => dirtyProject(state, project));
  },

  setTracksExportEnabled: (trackIds, exportEnabled) => {
    const selected = new Set(trackIds);
    if (!selected.size) return;
    const current = get().project;
    const project = {
      ...current,
      tracks: current.tracks.map((track) => selected.has(track.id)
        ? { ...track, edit: { ...track.edit, exportEnabled } }
        : track),
      updatedAt: Date.now()
    };
    set((state) => dirtyProject(state, project));
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
    set((state) => ({ ...dirtyProject(state, project), notice }));
  },

  reorderTracks: (orderedIds) => {
    const orderMap = new Map(orderedIds.map((id, index) => [id, index]));
    const current = get().project;
    const tracks = current.tracks.map((track) => ({ ...track, order: orderMap.get(track.id) ?? track.order }));
    const project = projectAfterTrackChange(current, tracks);
    set((state) => dirtyProject(state, project));
  },

  updateBeatTrack: (patch) => {
    const project = { ...get().project, beatTrack: { ...get().project.beatTrack, ...patch }, updatedAt: Date.now() };
    set((state) => dirtyProject(state, project));
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
    set((state) => ({ ...dirtyProject(state, project), notice: `已启用自定义鼓点：${file.name}` }));
  },

  updateExportSettings: (patch) => {
    const project = { ...get().project, exportSettings: { ...get().project.exportSettings, ...patch }, updatedAt: Date.now() };
    set((state) => dirtyProject(state, project));
    if (project.exportSettings.format === "mp3") prefetchFfmpegForExport();
  },

  renameProject: (name) => {
    const current = get().project;
    const normalizedName = name.trim();
    const project = {
      ...current,
      name: normalizedName || DEFAULT_PROJECT_NAME,
      nameMode: "custom" as const,
      updatedAt: Date.now()
    };
    set((state) => dirtyProject(state, project));
  },

  clearNotice: () => set({ notice: undefined }),

  importProject: (incoming) => {
    workspaceGeneration += 1;
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
      revision: 1,
      savedRevision: 0,
      hasSavedRecord: false,
      isDirty: true,
      saveState: "idle",
      saveError: undefined,
      lastSavedAt: undefined,
      analysisProgress: {},
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
    set((state) => ({ ...dirtyProject(state, project), notice: `已重新关联 ${linked.size} 首歌曲。` }));
  },

  saveCurrent: async (name, automatic = false) => {
    let capturedProject!: ProjectV1;
    let capturedRevision = 0;
    set((state) => {
      const normalizedName = name?.trim();
      const nameChanged = normalizedName != null && normalizedName !== state.project.name;
      capturedRevision = state.revision + (nameChanged ? 1 : 0);
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
      reconcileRegisteredFiles(capturedProject.tracks.map((track) => track.id));
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
      capturedRevision = state.revision + 1;
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
        isDirty: true,
        saveState: "saving",
        saveError: undefined
      };
    });
    try {
      await persist(capturedProject);
      reconcileRegisteredFiles(capturedProject.tracks.map((track) => track.id));
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
    const state = get();
    if (!state.savedSnapshot) {
      clearRegisteredFiles();
      clearCustomBeatSamples();
      set({
        project: createProject(),
        savedSnapshot: undefined,
        revision: 0,
        savedRevision: 0,
        hasSavedRecord: false,
        isDirty: false,
        saveState: "idle",
        saveError: undefined,
        lastSavedAt: undefined,
        analysisProgress: {},
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
      isDirty: false,
      saveState: "idle",
      saveError: undefined,
      analysisProgress: {},
      busy: false,
      notice: "已放弃未保存的更改。"
    });
  }
}));
