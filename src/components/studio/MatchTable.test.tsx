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

function renderTable(onPreview: (id: string, mode: "processed" | "processed-beat") => void) {
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
        onSort={vi.fn()}
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
