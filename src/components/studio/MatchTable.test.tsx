import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../../domain/types";
import { LanguageProvider } from "../../i18n";
import { MatchTable } from "./MatchTable";

const track: Track = {
  id: "track-1",
  source: {
    id: "track-1",
    fileName: "test-song.mp3",
    fileSize: 1_000,
    mimeType: "audio/mpeg",
    lastModified: 1,
    available: true
  },
  durationSeconds: 180,
  status: "complete",
  edit: {
    exportEnabled: true,
    sourceInSeconds: 0,
    sourceOutSeconds: 180,
    phaseNudgeBeats: 0
  },
  order: 0
};

function renderTable(
  onPreview: (id: string, mode: "processed" | "processed-beat") => void,
  options: { onSort?: (key: string) => void; sortKey?: "filename"; sortDirection?: "asc" | "desc"; busy?: boolean } = {}
) {
  render(
    <LanguageProvider>
      <MatchTable
        tracks={[track]}
        selectedIds={new Set([track.id])}
        focusedId={track.id}
        onSelectionChange={vi.fn()}
        onExportEnabled={vi.fn()}
        onDelete={vi.fn()}
        onReanalyze={vi.fn()}
        onMove={vi.fn()}
        onReorder={vi.fn()}
        onPreview={onPreview}
        onShowProperties={vi.fn()}
        onSort={options.onSort ?? vi.fn()}
        sortKey={options.sortKey}
        sortDirection={options.sortDirection}
        busy={options.busy}
      />
    </LanguageProvider>
  );
  return document.querySelector<HTMLTableRowElement>(`tr[data-track-id="${track.id}"]`)!;
}

describe("track list preview actions", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("previews the processed track with its beat track from the context menu", () => {
    const onPreview = vi.fn();
    const row = renderTable(onPreview);

    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem", { name: /试听踩点/ }));

    expect(onPreview).toHaveBeenCalledWith(track.id, "processed-beat");
  });

  it("previews the processed track with its beat track on double-click", () => {
    const onPreview = vi.fn();
    const row = renderTable(onPreview);

    fireEvent.doubleClick(row);

    expect(onPreview).toHaveBeenCalledWith(track.id, "processed-beat");
  });

  it("previews the processed track with its beat track when Enter is pressed", () => {
    const onPreview = vi.fn();
    renderTable(onPreview);

    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });

    expect(onPreview).toHaveBeenCalledWith(track.id, "processed-beat");
  });
});

describe("track list columns", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows the active sort direction on the selected column", () => {
    renderTable(vi.fn(), { sortKey: "filename", sortDirection: "desc" });

    expect(screen.getByRole("columnheader", { name: /歌曲/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByText("▼")).toBeInTheDocument();
  });

  it("keeps column sorting available while tracks are being analyzed", () => {
    const onSort = vi.fn();
    renderTable(vi.fn(), { onSort, busy: true });

    fireEvent.click(screen.getByRole("columnheader", { name: /歌曲/ }));

    expect(onSort).toHaveBeenCalledWith("filename");
  });

  it("keeps export selection and reordering available while analysis is active", () => {
    const row = renderTable(vi.fn(), { busy: true });

    expect(row).toHaveAttribute("draggable", "true");
    expect(screen.getByRole("checkbox", { name: /加入导出/ })).toBeEnabled();
    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    expect(screen.getByRole("menuitem", { name: /加入导出/ })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /排除导出/ })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /上移/ })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /下移/ })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /重新分析/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /删除/ })).toBeDisabled();
    expect(fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowDown", altKey: true })).toBe(true);
  });

  it("resizes a column with the keyboard and persists the width", () => {
    renderTable(vi.fn());

    fireEvent.keyDown(screen.getByRole("separator", { name: "调整“歌曲”列宽" }), { key: "ArrowRight" });

    expect(JSON.parse(localStorage.getItem("runbeat.track-column-widths.v1") ?? "{}")).toMatchObject({
      filename: 308
    });
  });
});
