import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { AppCommand } from "../components/AppLayout";
import { ClassicIcon } from "../components/ClassicIcon";
import { LazyDialogFallback } from "../components/LazyDialogFallback";
import { Inspector } from "../components/studio/Inspector";
import { MatchTable } from "../components/studio/MatchTable";
import type { ProjectPropertiesDraft } from "../components/studio/ProjectPropertiesDialog";
import { DEFAULT_PROJECT_NAME, type ProjectV1, type Track } from "../domain/types";
import { useI18n } from "../i18n";
import { deleteProject as deleteStoredProject } from "../services/db";
import { sortTracks, type TrackSortDirection, type TrackSortKey } from "../services/trackSorting";
import { useProjectStore } from "../store/projectStore";

const ExportDialogController = lazy(() => import("../components/studio/ExportDialogController").then((module) => ({ default: module.ExportDialogController })));
const ClassicMessageBox = lazy(() => import("../components/ClassicMessageBox").then((module) => ({ default: module.ClassicMessageBox })));
const ConfirmDialog = lazy(() => import("../components/ConfirmDialog").then((module) => ({ default: module.ConfirmDialog })));
const ProjectPropertiesDialog = lazy(() => import("../components/studio/ProjectPropertiesDialog").then((module) => ({ default: module.ProjectPropertiesDialog })));
const OpenProjectDialog = lazy(() => import("../components/studio/ProjectSessionDialogs").then((module) => ({ default: module.OpenProjectDialog })));
const ProjectNameDialog = lazy(() => import("../components/studio/ProjectSessionDialogs").then((module) => ({ default: module.ProjectNameDialog })));

type GuardedAction = () => void | Promise<void>;
type SaveDialogMode = "save" | "save-as";
type ListSortKey =
  | "filename"
  | "status"
  | "raw-bpm"
  | "mapped-bpm"
  | "beat-count"
  | "phase-accuracy"
  | "tempo-change"
  | "duration"
  | "quality";

const STATUS_ORDER: Track["status"][] = [
  "complete",
  "queued",
  "decoding",
  "analyzing-bpm",
  "analyzing-beats",
  "missing",
  "failed"
];

const AUTO_SAVE_DELAY_MS = 250;

function orderedTracks(project: ProjectV1): Track[] {
  return [...project.tracks].sort((left, right) => left.order - right.order);
}

function moveSelectedTracks(project: ProjectV1, selectedIds: Set<string>, direction: -1 | 1): string[] {
  const ids = orderedTracks(project).map((track) => track.id);
  if (direction < 0) {
    for (let index = 1; index < ids.length; index += 1) {
      if (selectedIds.has(ids[index]) && !selectedIds.has(ids[index - 1])) {
        [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
      }
    }
  } else {
    for (let index = ids.length - 2; index >= 0; index -= 1) {
      if (selectedIds.has(ids[index]) && !selectedIds.has(ids[index + 1])) {
        [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
      }
    }
  }
  return ids;
}

export function StudioPage() {
  const { language, t, translateMessage } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initializedRoute = useRef<string | undefined>(undefined);
  const pendingAction = useRef<GuardedAction | undefined>(undefined);
  const addFilesRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const relinkRef = useRef<HTMLInputElement>(null);
  const [selection, setSelectedIds] = useState<Set<string>>(new Set());
  const [focus, setFocusedId] = useState<string>();
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [sortState, setSortState] = useState<{ key?: ListSortKey; direction: TrackSortDirection }>({ direction: "asc" });
  const [projectPropertiesOpen, setProjectPropertiesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [openProjectOpen, setOpenProjectOpen] = useState(false);
  const [saveDialog, setSaveDialog] = useState<{ mode: SaveDialogMode; continueAction: boolean }>();
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [deletePromptOpen, setDeletePromptOpen] = useState(false);
  const [deleteProjectPromptOpen, setDeleteProjectPromptOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const {
    project,
    busy,
    revision,
    hasSavedRecord,
    isDirty,
    saveState,
    initialize,
    addFiles,
    reanalyzeTrack,
    removeTracks,
    setTargetSpm,
    setMappingMode,
    setMaxTempoChange,
    updateTrackEdit,
    setTracksExportEnabled,
    resetExportSelection,
    reorderTracks,
    updateBeatTrack,
    setCustomBeatFile,
    updateExportSettings,
    renameProject,
    importProject,
    relinkFiles,
    saveCurrent,
    saveAs,
    discardChanges
  } = useProjectStore();
  const projectParam = params.get("project") ?? undefined;
  const routeSession = projectParam ? `project:${projectParam}` : `new:${params.get("new") ?? "default"}`;

  useEffect(() => {
    if (initializedRoute.current === routeSession) return;
    initializedRoute.current = routeSession;
    setSelectedIds(new Set());
    setFocusedId(undefined);
    void initialize(projectParam);
  }, [initialize, projectParam, routeSession]);

  const selectedIds = useMemo(() => {
    const availableIds = new Set(project.tracks.map((track) => track.id));
    const retained = new Set([...selection].filter((id) => availableIds.has(id)));
    if (!retained.size && project.tracks[0]) retained.add(project.tracks[0].id);
    return retained;
  }, [project.tracks, selection]);
  const focusedId = project.tracks.some((track) => track.id === focus) ? focus : project.tracks[0]?.id;

  const focusedTrack = useMemo(
    () => project.tracks.find((track) => track.id === focusedId),
    [focusedId, project.tracks]
  );

  const syncRouteToSavedProject = useCallback(() => {
    const currentProject = useProjectStore.getState().project;
    const nextSession = `project:${currentProject.id}`;
    initializedRoute.current = nextSession;
    navigate(`/studio?project=${encodeURIComponent(currentProject.id)}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (
      !isDirty
      || saveState !== "idle"
      || saveDialog != null
      || unsavedPromptOpen
      || (!project.tracks.length && !hasSavedRecord)
    ) return;
    const projectId = project.id;
    const timer = window.setTimeout(() => {
      const state = useProjectStore.getState();
      if (
        state.project.id !== projectId
        || !state.isDirty
        || state.saveState !== "idle"
        || (!state.project.tracks.length && !state.hasSavedRecord)
      ) return;
      void state.saveCurrent(undefined, true).then((saved) => {
        const latest = useProjectStore.getState();
        if (
          saved
          && !projectParam
          && latest.project.id === projectId
          && latest.hasSavedRecord
        ) syncRouteToSavedProject();
      });
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    hasSavedRecord,
    isDirty,
    project.id,
    project.tracks.length,
    projectParam,
    revision,
    saveDialog,
    saveState,
    syncRouteToSavedProject,
    unsavedPromptOpen
  ]);

  const runPendingAction = useCallback(() => {
    const action = pendingAction.current;
    pendingAction.current = undefined;
    if (action) void action();
  }, []);

  const runGuarded = useCallback((action: GuardedAction) => {
    if (!useProjectStore.getState().isDirty) {
      void action();
      return;
    }
    pendingAction.current = action;
    setUnsavedPromptOpen(true);
  }, []);

  const requestSave = useCallback((mode: SaveDialogMode, continueAction = false) => {
    const state = useProjectStore.getState();
    if (mode === "save" && state.hasSavedRecord) {
      void state.saveCurrent().then((saved) => {
        if (!saved) return;
        if (continueAction) runPendingAction();
      });
      return;
    }
    setSaveDialog({ mode, continueAction });
  }, [runPendingAction]);

  const exportProjectFile = useCallback(() => {
    const current = useProjectStore.getState().project;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${current.name}.runbeat.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const chooseProject = useCallback((chosen: ProjectV1) => {
    setOpenProjectOpen(false);
    if (chosen.id === project.id && hasSavedRecord) return;
    runGuarded(() => navigate(`/studio?project=${encodeURIComponent(chosen.id)}`));
  }, [hasSavedRecord, navigate, project.id, runGuarded]);

  const selectAll = useCallback(() => {
    const tracks = useProjectStore.getState().project.tracks;
    setSelectedIds(new Set(tracks.map((track) => track.id)));
    setFocusedId((current) => current ?? tracks[0]?.id);
  }, []);

  const moveSelection = useCallback((direction: -1 | 1) => {
    if (!selectedIds.size) return;
    reorderTracks(moveSelectedTracks(project, selectedIds, direction));
    setSortState({ direction: "asc" });
  }, [project, reorderTracks, selectedIds]);

  const sortList = useCallback((key: ListSortKey) => {
    const direction: TrackSortDirection = sortState.key === key && sortState.direction === "asc" ? "desc" : "asc";
    const tracks = orderedTracks(project);
    let sorted: Track[];
    if (key === "status") {
      sorted = tracks
        .map((track, index) => ({ track, index }))
        .sort((left, right) => {
          const compared = (STATUS_ORDER.indexOf(left.track.status) - STATUS_ORDER.indexOf(right.track.status)) * (direction === "asc" ? 1 : -1);
          return compared || left.index - right.index;
        })
        .map(({ track }) => track);
    } else {
      const trackSortKey: TrackSortKey = key;
      sorted = sortTracks(tracks, trackSortKey, direction);
    }
    reorderTracks(sorted.map((track) => track.id));
    setSortState({ key, direction });
  }, [project, reorderTracks, sortState]);

  const reanalyzeSelected = useCallback(async () => {
    for (const track of orderedTracks(useProjectStore.getState().project)) {
      if (selectedIds.has(track.id)) await useProjectStore.getState().reanalyzeTrack(track.id);
    }
  }, [selectedIds]);

  const handleCommand = useCallback((command: AppCommand) => {
    switch (command) {
      case "new-project":
        runGuarded(() => navigate(`/studio?new=${Date.now()}`));
        break;
      case "open-project":
        setOpenProjectOpen(true);
        break;
      case "save-project":
        requestSave("save");
        break;
      case "save-project-as":
        requestSave("save-as");
        break;
      case "add-tracks":
        addFilesRef.current?.click();
        break;
      case "import-project":
        importRef.current?.click();
        break;
      case "backup-project":
        exportProjectFile();
        break;
      case "export-audio":
        if (project.exportSettings.format === "mp3") {
          void import("../services/runtimePreload")
            .then(({ prefetchFfmpegRuntime }) => prefetchFfmpegRuntime());
        }
        setExportOpen(true);
        break;
      case "close-project":
        runGuarded(() => navigate("/projects"));
        break;
      case "select-all":
        selectAll();
        break;
      case "include-selected":
        setTracksExportEnabled([...selectedIds], true);
        break;
      case "exclude-selected":
        setTracksExportEnabled([...selectedIds], false);
        break;
      case "move-up":
        moveSelection(-1);
        break;
      case "move-down":
        moveSelection(1);
        break;
      case "delete-selected":
        if (selectedIds.size) setDeletePromptOpen(true);
        break;
      case "delete-project":
        if (hasSavedRecord) setDeleteProjectPromptOpen(true);
        break;
      case "track-properties":
        if (focusedId) setInspectorVisible(true);
        break;
      case "project-properties":
        setProjectPropertiesOpen(true);
        break;
      case "reset-selection":
        resetExportSelection();
        break;
      case "reanalyze-selected":
        void reanalyzeSelected();
        break;
      case "relink-files":
        relinkRef.current?.click();
        break;
    }
  }, [
    exportProjectFile,
    focusedId,
    hasSavedRecord,
    moveSelection,
    navigate,
    project.exportSettings.format,
    reanalyzeSelected,
    requestSave,
    resetExportSelection,
    runGuarded,
    selectAll,
    selectedIds,
    setTracksExportEnabled
  ]);

  useEffect(() => {
    const onCommand = (event: Event) => handleCommand((event as CustomEvent<AppCommand>).detail);
    const onInspector = (event: Event) => setInspectorVisible(Boolean((event as CustomEvent<boolean>).detail));
    const onError = (event: Event) => setErrorMessage(String((event as CustomEvent<unknown>).detail));
    window.addEventListener("runbeat:command", onCommand);
    window.addEventListener("runbeat:inspector", onInspector);
    window.addEventListener("runbeat:error", onError);
    return () => {
      window.removeEventListener("runbeat:command", onCommand);
      window.removeEventListener("runbeat:inspector", onInspector);
      window.removeEventListener("runbeat:error", onError);
    };
  }, [handleCommand]);

  const importProjectFile = async (file?: File) => {
    if (!file) return;
    try {
      const { readProjectFile } = await import("../services/projectFile");
      const imported = await readProjectFile(file);
      runGuarded(() => {
        const importSession = `import-${Date.now()}`;
        importProject(imported);
        initializedRoute.current = `new:${importSession}`;
        navigate(`/studio?new=${importSession}`, { replace: true });
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("项目文件无效。"));
    }
  };

  const applyProjectProperties = async (draft: ProjectPropertiesDraft, customBeatFile?: File) => {
    if (draft.name !== project.name) renameProject(draft.name);
    if (draft.targetSpm !== project.targetSpm) setTargetSpm(draft.targetSpm);
    if (draft.mappingMode !== project.mappingMode) setMappingMode(draft.mappingMode);
    if (draft.maxTempoChangePercent !== project.maxTempoChangePercent) setMaxTempoChange(draft.maxTempoChangePercent);
    if (JSON.stringify(draft.beatTrack) !== JSON.stringify(project.beatTrack)) updateBeatTrack(draft.beatTrack);
    if (customBeatFile) await setCustomBeatFile(customBeatFile);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const confirmDelete = () => {
    const ids = [...selectedIds];
    const currentOrder = orderedTracks(project);
    const firstIndex = currentOrder.findIndex((track) => selectedIds.has(track.id));
    removeTracks(ids);
    const remaining = currentOrder.filter((track) => !selectedIds.has(track.id));
    const nextFocus = remaining[Math.min(Math.max(firstIndex, 0), remaining.length - 1)]?.id;
    setSelectedIds(nextFocus ? new Set([nextFocus]) : new Set());
    setFocusedId(nextFocus);
    setDeletePromptOpen(false);
  };

  const confirmProjectDelete = async () => {
    try {
      await deleteStoredProject(project.id);
      setDeleteProjectPromptOpen(false);
      navigate("/projects", { replace: true });
    } catch (error) {
      setDeleteProjectPromptOpen(false);
      setErrorMessage(error instanceof Error ? error.message : t("项目删除失败。"));
    }
  };

  const nameDialogInitialValue = saveDialog?.mode === "save" && project.name === DEFAULT_PROJECT_NAME
    ? ""
    : saveDialog?.mode === "save-as" && project.name !== DEFAULT_PROJECT_NAME
      ? t("{name} 副本", { name: project.name })
      : project.name === DEFAULT_PROJECT_NAME ? "" : project.name;

  return (
    <div
      className={`studio-page classic-editor ${inspectorVisible ? "" : "inspector-hidden"}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={handleDrop}
    >
      <input
        hidden
        ref={addFilesRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg"
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <input
        hidden
        ref={importRef}
        type="file"
        accept=".json,.runbeat.json"
        onChange={(event) => {
          void importProjectFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        hidden
        ref={relinkRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg"
        onChange={(event) => {
          relinkFiles(Array.from(event.target.files ?? []));
          event.currentTarget.value = "";
        }}
      />

      {project.tracks.some((track) => !track.source.available) && <div className="missing-file-strip">
        <ClassicIcon name="warning" />
        <span>{t("部分歌曲需要重新关联原始文件。")}</span>
        <button type="button" onClick={() => relinkRef.current?.click()}>{t("重新关联...")}</button>
      </div>}

      <div className="editor-workspace">
        <section className="track-list-pane" aria-label={t("歌曲列表")}>
          <MatchTable
            tracks={project.tracks}
            selectedIds={selectedIds}
            focusedId={focusedId}
            onSelectionChange={(ids, focused) => {
              setSelectedIds(ids);
              setFocusedId(focused);
            }}
            onExportEnabled={setTracksExportEnabled}
            onDelete={() => selectedIds.size && setDeletePromptOpen(true)}
            onReanalyze={() => void reanalyzeSelected()}
            onMove={moveSelection}
            onReorder={(ids) => {
              setSortState({ direction: "asc" });
              reorderTracks(ids);
            }}
            onPreview={(id, mode) => {
              setFocusedId(id);
              if (!selectedIds.has(id)) setSelectedIds(new Set([id]));
              setInspectorVisible(true);
              window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("runbeat:preview-track", {
                detail: { trackId: id, mode }
              })));
            }}
            onShowProperties={() => setInspectorVisible(true)}
            onSort={sortList}
          />
        </section>
        {inspectorVisible && <Inspector
          project={project}
          track={focusedTrack}
          busy={busy}
          onTrackEdit={(patch) => focusedTrack && updateTrackEdit(focusedTrack.id, patch)}
          onReanalyze={() => focusedTrack && void reanalyzeTrack(focusedTrack.id)}
        />}
      </div>

      {(deletePromptOpen || deleteProjectPromptOpen || unsavedPromptOpen || errorMessage != null) && <Suspense fallback={<LazyDialogFallback />}>
      {deletePromptOpen && <ConfirmDialog
        open={deletePromptOpen}
        title={t("删除歌曲")}
        message={selectedIds.size === 1
          ? t("要从项目中删除“{name}”吗？原始音乐文件不会被删除。", { name: focusedTrack?.source.fileName ?? t("所选歌曲") })
          : t("要从项目中删除所选的 {count} 首歌曲吗？原始音乐文件不会被删除。", { count: selectedIds.size })}
        confirmLabel={t("删除(Y)")}
        onConfirm={confirmDelete}
        onCancel={() => setDeletePromptOpen(false)}
      />}

      {deleteProjectPromptOpen && <ConfirmDialog
        open={deleteProjectPromptOpen}
        title={t("删除项目")}
        message={t("要永久删除“{name}”吗？{detail}", {
          name: project.name,
          detail: isDirty ? t("当前未保存的更改也会丢失。") : t("此操作无法撤销。")
        })}
        confirmLabel={t("删除(Y)")}
        onConfirm={() => void confirmProjectDelete()}
        onCancel={() => setDeleteProjectPromptOpen(false)}
      />}

      {unsavedPromptOpen && <ClassicMessageBox
        open={unsavedPromptOpen}
        title="RunBeat"
        icon="warning"
        message={t("是否保存对“{name}”所做的更改？", { name: project.name })}
        buttons={[
          { value: "save", label: t("是(Y)"), accessKey: "y", default: true },
          { value: "discard", label: t("否(N)"), accessKey: "n" },
          { value: "cancel", label: t("取消"), accessKey: "c" }
        ]}
        cancelValue="cancel"
        onSelect={(value: string) => {
          setUnsavedPromptOpen(false);
          if (value === "save") requestSave("save", true);
          else if (value === "discard") {
            discardChanges();
            runPendingAction();
          } else {
            pendingAction.current = undefined;
          }
        }}
      />}

      {errorMessage != null && <ClassicMessageBox
        open={errorMessage != null}
        title="RunBeat"
        icon="error"
        message={translateMessage(errorMessage)}
        buttons={[{ value: "ok", label: t("确定"), default: true }]}
        onSelect={() => setErrorMessage(undefined)}
      />}
      </Suspense>}

      {saveDialog && <Suspense fallback={<LazyDialogFallback />}><ProjectNameDialog
        open={saveDialog != null}
        title={saveDialog?.mode === "save-as" ? t("项目另存为") : t("保存项目")}
        initialName={nameDialogInitialValue}
        onSave={async (name) => {
          const dialog = saveDialog;
          if (!dialog) return;
          const saved = dialog.mode === "save-as" ? await saveAs(name) : await saveCurrent(name);
          if (!saved) return;
          setSaveDialog(undefined);
          syncRouteToSavedProject();
          if (dialog.continueAction) runPendingAction();
        }}
        onCancel={() => {
          if (saveDialog?.continueAction) pendingAction.current = undefined;
          setSaveDialog(undefined);
        }}
      /></Suspense>}

      {openProjectOpen && <Suspense fallback={<LazyDialogFallback />}><OpenProjectDialog
        open={openProjectOpen}
        currentProjectId={hasSavedRecord ? project.id : undefined}
        onOpen={chooseProject}
        onCancel={() => setOpenProjectOpen(false)}
      /></Suspense>}

      {projectPropertiesOpen && <Suspense fallback={<LazyDialogFallback />}><ProjectPropertiesDialog
        open={projectPropertiesOpen}
        project={project}
        onApply={applyProjectProperties}
        onClose={() => setProjectPropertiesOpen(false)}
      /></Suspense>}

      {exportOpen && <Suspense fallback={<LazyDialogFallback />}>
        <ExportDialogController
          project={project}
          language={language}
          onSettings={updateExportSettings}
          onClose={() => setExportOpen(false)}
        />
      </Suspense>}
    </div>
  );
}
