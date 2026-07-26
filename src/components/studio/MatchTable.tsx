import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ClassicIcon } from "../ClassicIcon";
import { QUALITY_LABELS, type Track } from "../../domain/types";
import { useI18n } from "../../i18n";
import { formatDuration } from "../../utils/format";
import { useCenteredTrack } from "./useCenteredTrack";

type Translate = ReturnType<typeof useI18n>["t"];
type SortableColumnId =
  | "filename"
  | "status"
  | "raw-bpm"
  | "mapped-bpm"
  | "beat-count"
  | "phase-accuracy"
  | "tempo-change"
  | "duration"
  | "quality";
type TableColumnId = "export" | SortableColumnId;
type OptionalColumnId = Exclude<TableColumnId, "export" | "filename">;
export type TrackListPreviewMode = "processed" | "processed-beat";

const COLUMN_PREFS_KEY = "runbeat.track-columns.v1";
const COLUMN_WIDTHS_PREFS_KEY = "runbeat.track-column-widths.v1";
const OPTIONAL_COLUMNS: ReadonlyArray<{ id: OptionalColumnId; label: string }> = [
  { id: "status", label: "状态" },
  { id: "raw-bpm", label: "原始 BPM" },
  { id: "mapped-bpm", label: "映射 BPM" },
  { id: "beat-count", label: "拍点" },
  { id: "phase-accuracy", label: "相位准确率" },
  { id: "tempo-change", label: "变速" },
  { id: "duration", label: "输出时长" },
  { id: "quality", label: "综合质量" }
];
const OPTIONAL_COLUMN_IDS = new Set<OptionalColumnId>(OPTIONAL_COLUMNS.map(({ id }) => id));
const DEFAULT_COLUMN_WIDTHS: Record<TableColumnId, number> = {
  export: 72,
  filename: 300,
  status: 110,
  "raw-bpm": 100,
  "mapped-bpm": 100,
  "beat-count": 75,
  "phase-accuracy": 140,
  "tempo-change": 125,
  duration: 130,
  quality: 120
};
const MIN_COLUMN_WIDTHS: Record<TableColumnId, number> = {
  export: 60,
  filename: 160,
  status: 76,
  "raw-bpm": 76,
  "mapped-bpm": 82,
  "beat-count": 62,
  "phase-accuracy": 96,
  "tempo-change": 84,
  duration: 90,
  quality: 84
};
const MAX_COLUMN_WIDTH = 480;

function isOptionalColumn(id: TableColumnId): id is OptionalColumnId {
  return OPTIONAL_COLUMN_IDS.has(id as OptionalColumnId);
}

function readVisibleColumns(): Set<OptionalColumnId> {
  try {
    const stored = JSON.parse(localStorage.getItem(COLUMN_PREFS_KEY) ?? "null");
    if (Array.isArray(stored)) {
      return new Set(stored.filter((id): id is OptionalColumnId => OPTIONAL_COLUMN_IDS.has(id as OptionalColumnId)));
    }
  } catch {
    // Fall through to the complete default layout.
  }
  return new Set(OPTIONAL_COLUMNS.map(({ id }) => id));
}

function readColumnWidths(): Record<TableColumnId, number> {
  try {
    const stored = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_PREFS_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      (Object.keys(DEFAULT_COLUMN_WIDTHS) as TableColumnId[]).map((column) => {
        const width = Number(stored[column]);
        return [
          column,
          Number.isFinite(width)
            ? Math.max(MIN_COLUMN_WIDTHS[column], Math.min(MAX_COLUMN_WIDTH, Math.round(width)))
            : DEFAULT_COLUMN_WIDTHS[column]
        ];
      })
    ) as Record<TableColumnId, number>;
  } catch {
    return { ...DEFAULT_COLUMN_WIDTHS };
  }
}

function statusLabel(track: Track, t: Translate): string {
  return t({
    queued: "等待分析",
    decoding: "正在解码",
    "analyzing-bpm": "分析 BPM",
    "analyzing-beats": "分析拍点",
    complete: "分析完成",
    failed: "分析失败",
    missing: "需要原文件"
  }[track.status]);
}

function phaseDetail(track: Track, t: Translate): string | undefined {
  const analysis = track.derivedAnalysis;
  if (!analysis) return undefined;
  return [
    analysis.phaseConfidence == null ? undefined : t("相位置信度 {value}%", { value: Math.round(analysis.phaseConfidence * 100) }),
    analysis.phaseMedianErrorMs == null ? undefined : t("拍点中位误差 {value} ms", { value: analysis.phaseMedianErrorMs.toFixed(0) }),
    analysis.phaseCoverage == null ? undefined : t("可靠拍点覆盖 {value}%", { value: Math.round(analysis.phaseCoverage * 100) })
  ].filter(Boolean).join("; ") || undefined;
}

function beatCountLabel(track: Track, t: Translate): string {
  return track.rawAnalysis ? t("{count} 个", { count: track.rawAnalysis.beatTicks.length }) : "--";
}

function phaseAccuracyLabel(track: Track, t: Translate): string {
  const analysis = track.derivedAnalysis;
  if (!analysis) return "--";
  if (analysis.phaseAlignmentModel === "manual") return t("手动");
  const accuracy = analysis.phaseCoverage ?? analysis.phaseConfidence;
  return accuracy == null ? "--" : `${Math.round(accuracy * 100)}%`;
}

function qualityDetail(track: Track, t: Translate, translateMessage: (message?: string) => string): string | undefined {
  const factors = track.derivedAnalysis?.qualityFactors;
  if (!factors) return track.derivedAnalysis?.warnings.map(translateMessage).join("; ") || undefined;
  return t("综合评级取最差项：变速 {tempo}；BPM 置信度 {bpm}；相位 {phase}", {
    tempo: t(QUALITY_LABELS[factors.tempoChange]),
    bpm: t(QUALITY_LABELS[factors.bpmConfidence]),
    phase: t(QUALITY_LABELS[factors.phaseAlignment])
  });
}

interface ContextMenuState {
  x: number;
  y: number;
}

interface ColumnMenuState extends ContextMenuState {
  column: TableColumnId;
}

export function MatchTable({
  tracks,
  selectedIds,
  focusedId,
  onSelectionChange,
  onExportEnabled,
  onDelete,
  onReanalyze,
  onMove,
  onReorder,
  onPreview,
  onShowProperties,
  onSort,
  sortKey,
  sortDirection = "asc",
  busy = false
}: {
  tracks: Track[];
  selectedIds: Set<string>;
  focusedId?: string;
  onSelectionChange: (selectedIds: Set<string>, focusedId?: string) => void;
  onExportEnabled: (ids: string[], enabled: boolean) => void;
  onDelete: () => void;
  onReanalyze: () => void;
  onMove: (direction: -1 | 1) => void;
  onReorder: (ids: string[]) => void;
  onPreview: (id: string, mode: TrackListPreviewMode) => void;
  onShowProperties: () => void;
  onSort: (key: SortableColumnId) => void;
  sortKey?: SortableColumnId;
  sortDirection?: "asc" | "desc";
  busy?: boolean;
}) {
  const { t, translateMessage } = useI18n();
  const ordered = useMemo(() => [...tracks].sort((a, b) => a.order - b.order), [tracks]);
  const listRef = useCenteredTrack<HTMLDivElement>(focusedId);
  const anchorId = useRef<string | undefined>(undefined);
  const dragId = useRef<string | undefined>(undefined);
  const contextRef = useRef<HTMLDivElement>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [columnMenu, setColumnMenu] = useState<ColumnMenuState>();
  const [visibleColumns, setVisibleColumns] = useState<Set<OptionalColumnId>>(readVisibleColumns);
  const [columnWidths, setColumnWidthsState] = useState<Record<TableColumnId, number>>(readColumnWidths);
  const [columnResize, setColumnResize] = useState<{ column: TableColumnId; pointerId: number; startX: number; startWidth: number }>();
  const visibleColumnIds = useMemo<TableColumnId[]>(
    () => ["export", "filename", ...OPTIONAL_COLUMNS.map(({ id }) => id).filter((id) => visibleColumns.has(id))],
    [visibleColumns]
  );
  const tableMinWidth = visibleColumnIds.reduce((total, column) => total + columnWidths[column], 0);

  useEffect(() => {
    if (!contextMenu && !columnMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (contextRef.current?.contains(target) || columnMenuRef.current?.contains(target)) return;
      setContextMenu(undefined);
      setColumnMenu(undefined);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(undefined);
        setColumnMenu(undefined);
      }
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    window.requestAnimationFrame(() => {
      (columnMenu ? columnMenuRef : contextRef).current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [columnMenu, contextMenu]);

  const selectRow = (trackId: string, event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">) => {
    const index = ordered.findIndex((track) => track.id === trackId);
    if (event.shiftKey && anchorId.current) {
      const anchorIndex = ordered.findIndex((track) => track.id === anchorId.current);
      if (anchorIndex >= 0 && index >= 0) {
        const range = ordered.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1).map((track) => track.id);
        onSelectionChange(new Set(event.ctrlKey || event.metaKey ? [...selectedIds, ...range] : range), trackId);
        return;
      }
    }
    anchorId.current = trackId;
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedIds);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      onSelectionChange(next, trackId);
      return;
    }
    onSelectionChange(new Set([trackId]), trackId);
  };

  const openContextMenu = (trackId: string, x: number, y: number) => {
    if (!selectedIds.has(trackId)) {
      anchorId.current = trackId;
      onSelectionChange(new Set([trackId]), trackId);
    }
    setColumnMenu(undefined);
    setContextMenu({
      x: Math.max(4, Math.min(x, window.innerWidth - 210)),
      y: Math.max(4, Math.min(y, window.innerHeight - 250))
    });
  };

  const setColumns = (next: Set<OptionalColumnId>) => {
    setVisibleColumns(next);
    try {
      localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(OPTIONAL_COLUMNS
        .map(({ id }) => id)
        .filter((id) => next.has(id))));
    } catch {
      // Column choices remain session-local when storage is unavailable.
    }
  };

  const persistColumnWidths = (widths: Record<TableColumnId, number>) => {
    try {
      localStorage.setItem(COLUMN_WIDTHS_PREFS_KEY, JSON.stringify(widths));
    } catch {
      // Column widths remain session-local when storage is unavailable.
    }
  };

  const updateColumnWidth = (column: TableColumnId, width: number, persist = false) => {
    setColumnWidthsState((current) => {
      const next = {
        ...current,
        [column]: Math.max(MIN_COLUMN_WIDTHS[column], Math.min(MAX_COLUMN_WIDTH, Math.round(width)))
      };
      if (persist) persistColumnWidths(next);
      return next;
    });
  };

  const beginColumnResize = (column: TableColumnId, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setColumnResize({
      column,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: columnWidths[column]
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveColumnResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resizing = columnResize;
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    updateColumnWidth(resizing.column, resizing.startWidth + event.clientX - resizing.startX);
  };

  const endColumnResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resizing = columnResize;
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    updateColumnWidth(resizing.column, resizing.startWidth + event.clientX - resizing.startX, true);
    setColumnResize(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeColumnWithKeyboard = (column: TableColumnId, event: KeyboardEvent<HTMLSpanElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const width = event.key === "Home"
      ? DEFAULT_COLUMN_WIDTHS[column]
      : columnWidths[column] + (event.key === "ArrowRight" ? 8 : -8);
    updateColumnWidth(column, width, true);
  };

  const toggleColumn = (column: OptionalColumnId) => {
    const next = new Set(visibleColumns);
    if (next.has(column)) next.delete(column);
    else next.add(column);
    setColumns(next);
    setColumnMenu(undefined);
  };

  const openColumnMenu = (column: TableColumnId, x: number, y: number) => {
    setContextMenu(undefined);
    setColumnMenu({
      column,
      x: Math.max(4, Math.min(x, window.innerWidth - 245)),
      y: Math.max(4, Math.min(y, window.innerHeight - 245))
    });
  };

  const columnLabel = (column: TableColumnId): string => {
    if (column === "export") return t("导出");
    if (column === "filename") return t("歌曲");
    return t(OPTIONAL_COLUMNS.find(({ id }) => id === column)?.label ?? column);
  };

  const headerProps = (column: TableColumnId) => ({
    "data-column": column,
    title: t("右键单击可选择显示的列。"),
    onContextMenu: (event: MouseEvent<HTMLTableCellElement>) => {
      event.preventDefault();
      openColumnMenu(column, event.clientX, event.clientY);
    }
  });

  const renderHeader = (column: TableColumnId, label: string, sortable: boolean) => {
    const sorted = sortable && sortKey === column;
    return <th
      {...headerProps(column)}
      className={column === "export" ? "export-column" : undefined}
      aria-sort={sortable ? sorted ? sortDirection === "asc" ? "ascending" : "descending" : "none" : undefined}
      aria-disabled={sortable && busy ? true : undefined}
      onClick={sortable && !busy ? () => onSort(column as SortableColumnId) : undefined}
    >
      <span className="column-header-content">
        <span>{label}</span>
        {sorted && <span className="column-sort-indicator" aria-hidden="true">{sortDirection === "asc" ? "▲" : "▼"}</span>}
      </span>
      <span
        className="column-resize-handle"
        role="separator"
        aria-label={t("调整“{column}”列宽", { column: label })}
        aria-orientation="vertical"
        aria-valuemin={MIN_COLUMN_WIDTHS[column]}
        aria-valuemax={MAX_COLUMN_WIDTH}
        aria-valuenow={columnWidths[column]}
        tabIndex={0}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => beginColumnResize(column, event)}
        onPointerMove={moveColumnResize}
        onPointerUp={endColumnResize}
        onPointerCancel={endColumnResize}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          updateColumnWidth(column, DEFAULT_COLUMN_WIDTHS[column], true);
        }}
        onKeyDown={(event) => resizeColumnWithKeyboard(column, event)}
      />
    </th>;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (!ordered.length) return;
    const currentIndex = Math.max(0, ordered.findIndex((track) => track.id === focusedId));
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? ordered.length - 1
          : Math.max(0, Math.min(ordered.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
      const nextId = ordered[nextIndex].id;
      if (event.shiftKey) {
        const anchor = anchorId.current ?? focusedId ?? ordered[currentIndex].id;
        const anchorIndex = ordered.findIndex((track) => track.id === anchor);
        const range = ordered.slice(Math.min(anchorIndex, nextIndex), Math.max(anchorIndex, nextIndex) + 1).map((track) => track.id);
        onSelectionChange(new Set(range), nextId);
      } else if (event.ctrlKey || event.metaKey) {
        onSelectionChange(new Set(selectedIds), nextId);
      } else {
        anchorId.current = nextId;
        onSelectionChange(new Set([nextId]), nextId);
      }
      window.requestAnimationFrame(() => document.querySelector<HTMLTableRowElement>(`tr[data-track-id="${CSS.escape(nextId)}"]`)?.focus());
    } else if (event.key === " " && selectedIds.size && !busy) {
      event.preventDefault();
      const allEnabled = [...selectedIds].every((id) => tracks.find((track) => track.id === id)?.edit.exportEnabled);
      onExportEnabled([...selectedIds], !allEnabled);
    } else if (event.key === "Enter" && focusedId) {
      event.preventDefault();
      onPreview(focusedId, "processed-beat");
    } else if (event.key === "Delete" && selectedIds.size && !busy) {
      event.preventDefault();
      onDelete();
    } else if (event.shiftKey && event.key === "F10" && focusedId) {
      event.preventDefault();
      const row = document.querySelector<HTMLTableRowElement>(`tr[data-track-id="${CSS.escape(focusedId)}"]`);
      const rect = row?.getBoundingClientRect();
      openContextMenu(focusedId, rect?.left ?? 20, rect?.bottom ?? 20);
    }
  };

  const dropBefore = (targetId: string) => {
    const sourceId = dragId.current;
    dragId.current = undefined;
    if (!sourceId || sourceId === targetId) return;
    const movingIds = selectedIds.has(sourceId) ? ordered.filter((track) => selectedIds.has(track.id)).map((track) => track.id) : [sourceId];
    const remaining = ordered.map((track) => track.id).filter((id) => !movingIds.includes(id));
    const targetIndex = remaining.indexOf(targetId);
    remaining.splice(targetIndex < 0 ? remaining.length : targetIndex, 0, ...movingIds);
    onReorder(remaining);
  };

  const runContext = (action: () => void) => {
    setContextMenu(undefined);
    action();
  };

  return (
    <div ref={listRef} className="classic-track-list sunken-panel" data-help="track-list">
      <table
        className="match-table interactive"
        role="grid"
        aria-label={t("歌曲详细列表")}
        aria-multiselectable="true"
        style={{ "--table-min-width": `${tableMinWidth}px`, minWidth: `${tableMinWidth}px` } as CSSProperties}
        onKeyDown={handleKeyDown}
      >
        <colgroup>
          {visibleColumnIds.map((column) => <col key={column} data-column={column} style={{ width: `${columnWidths[column]}px` }} />)}
        </colgroup>
        <thead><tr>
          {renderHeader("export", t("导出"), false)}
          {renderHeader("filename", t("歌曲"), true)}
          {visibleColumns.has("status") && renderHeader("status", t("状态"), true)}
          {visibleColumns.has("raw-bpm") && renderHeader("raw-bpm", t("原始 BPM"), true)}
          {visibleColumns.has("mapped-bpm") && renderHeader("mapped-bpm", t("映射 BPM"), true)}
          {visibleColumns.has("beat-count") && renderHeader("beat-count", t("拍点"), true)}
          {visibleColumns.has("phase-accuracy") && renderHeader("phase-accuracy", t("相位准确率"), true)}
          {visibleColumns.has("tempo-change") && renderHeader("tempo-change", t("变速"), true)}
          {visibleColumns.has("duration") && renderHeader("duration", t("输出时长"), true)}
          {visibleColumns.has("quality") && renderHeader("quality", t("综合质量"), true)}
        </tr></thead>
        <tbody>
          {ordered.map((track) => {
            const selected = selectedIds.has(track.id);
            const focused = focusedId === track.id;
            const derived = track.derivedAnalysis;
            return <tr
              key={track.id}
              data-track-id={track.id}
              data-selected-track={focused ? "true" : undefined}
              className={selected ? "selected highlighted" : ""}
              aria-selected={selected}
              tabIndex={focused ? 0 : -1}
              draggable={!busy}
              onClick={(event) => selectRow(track.id, event)}
              onDoubleClick={() => onPreview(track.id, "processed-beat")}
              onContextMenu={(event) => {
                event.preventDefault();
                openContextMenu(track.id, event.clientX, event.clientY);
              }}
              onDragStart={(event) => {
                if (busy) {
                  event.preventDefault();
                  return;
                }
                dragId.current = track.id;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", track.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                event.currentTarget.classList.add("drag-target");
              }}
              onDragLeave={(event) => event.currentTarget.classList.remove("drag-target")}
              onDrop={(event) => {
                event.preventDefault();
                event.currentTarget.classList.remove("drag-target");
                if (!busy) dropBefore(track.id);
              }}
            >
              <td data-column="export" className="export-column" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`${track.source.fileName} ${t("加入导出")}`}
                  checked={track.edit.exportEnabled ?? false}
                  disabled={busy || (track.status !== "complete" && typeof track.edit.exportEnabled !== "boolean")}
                  onChange={(event) => onExportEnabled([track.id], event.target.checked)}
                />
              </td>
              <td data-column="filename" className="match-song-cell"><span><ClassicIcon name="music" /><span title={track.source.fileName}>{track.source.fileName}</span></span></td>
              {visibleColumns.has("status") && <td data-column="status" title={translateMessage(track.error)}>{statusLabel(track, t)}</td>}
              {visibleColumns.has("raw-bpm") && <td data-column="raw-bpm">{track.rawAnalysis?.rawBpm.toFixed(2) ?? "--"}</td>}
              {visibleColumns.has("mapped-bpm") && <td data-column="mapped-bpm">{derived?.normalizedBpm.toFixed(2) ?? "--"}</td>}
              {visibleColumns.has("beat-count") && <td data-column="beat-count" title={track.rawAnalysis ? t("共检测到 {count} 个拍点", { count: track.rawAnalysis.beatTicks.length }) : undefined}>{beatCountLabel(track, t)}</td>}
              {visibleColumns.has("phase-accuracy") && <td data-column="phase-accuracy" title={phaseDetail(track, t)}>{phaseAccuracyLabel(track, t)}</td>}
              {visibleColumns.has("tempo-change") && <td data-column="tempo-change">{derived ? `${derived.tempoChangePercent > 0 ? "+" : ""}${derived.tempoChangePercent.toFixed(2)}%` : "--"}</td>}
              {visibleColumns.has("duration") && <td data-column="duration">{derived ? formatDuration(track.durationSeconds * derived.timeRatio) : "--"}</td>}
              {visibleColumns.has("quality") && <td data-column="quality">{derived
                ? <span className={`quality-label ${derived.quality}`} title={`${qualityDetail(track, t, translateMessage) ?? ""}${phaseDetail(track, t) ? `; ${phaseDetail(track, t)}` : ""}`}><i />{t(QUALITY_LABELS[derived.quality])}</span>
                : "--"}</td>}
            </tr>;
          })}
        </tbody>
      </table>
      {!ordered.length && <div className="classic-list-empty"><ClassicIcon name="music" size={32} /><p>{t("要添加歌曲，请选择“文件”菜单中的“添加歌曲”，或将音频文件拖到此处。")}</p></div>}
      {columnMenu && <div
        ref={columnMenuRef}
        className="classic-context-menu column-context-menu"
        role="menu"
        aria-label={t("列设置")}
        style={{ left: columnMenu.x, top: columnMenu.y }}
      >
        <button
          type="button"
          role="menuitem"
          disabled={!isOptionalColumn(columnMenu.column)}
          onClick={() => {
            if (isOptionalColumn(columnMenu.column)) toggleColumn(columnMenu.column);
          }}
        >{t("隐藏“{column}”", { column: columnLabel(columnMenu.column) })}</button>
        <button
          type="button"
          role="menuitem"
          disabled={columnWidths[columnMenu.column] === DEFAULT_COLUMN_WIDTHS[columnMenu.column]}
          onClick={() => {
            updateColumnWidth(columnMenu.column, DEFAULT_COLUMN_WIDTHS[columnMenu.column], true);
            setColumnMenu(undefined);
          }}
        >{t("重置“{column}”列宽", { column: columnLabel(columnMenu.column) })}</button>
        <div role="separator" />
        {OPTIONAL_COLUMNS.map(({ id, label }) => <button
          key={id}
          type="button"
          role="menuitemcheckbox"
          aria-checked={visibleColumns.has(id)}
          onClick={() => toggleColumn(id)}
        >
          <span className="classic-context-check" aria-hidden="true">{visibleColumns.has(id) ? "✓" : ""}</span>
          {t(label)}
        </button>)}
        <div role="separator" />
        <button
          type="button"
          role="menuitem"
          disabled={visibleColumns.size === OPTIONAL_COLUMNS.length}
          onClick={() => {
            setColumns(new Set(OPTIONAL_COLUMNS.map(({ id }) => id)));
            setColumnMenu(undefined);
          }}
        >{t("显示所有列")}</button>
      </div>}
      {contextMenu && <div ref={contextRef} className="classic-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
        <button type="button" role="menuitem" onClick={() => focusedId && runContext(() => onPreview(focusedId, "processed-beat"))}>{t("试听踩点")}(<u>P</u>)</button>
        <div role="separator" />
        <button type="button" role="menuitem" disabled={busy} onClick={() => runContext(() => onExportEnabled([...selectedIds], true))}>{t("加入导出")}(<u>I</u>)</button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => runContext(() => onExportEnabled([...selectedIds], false))}>{t("排除导出")}(<u>X</u>)</button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => runContext(onReanalyze)}>{t("重新分析")}(<u>A</u>)</button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => runContext(() => onMove(-1))}>{t("上移")}(<u>U</u>)</button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => runContext(() => onMove(1))}>{t("下移")}(<u>D</u>)</button>
        <div role="separator" />
        <button type="button" role="menuitem" disabled={busy} onClick={() => runContext(onDelete)}>{t("删除")}(<u>L</u>)</button>
        <div role="separator" />
        <button type="button" role="menuitem" onClick={() => runContext(onShowProperties)}>{t("歌曲属性")}(<u>R</u>)</button>
      </div>}
    </div>
  );
}
