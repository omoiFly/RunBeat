import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, type Track } from "../../domain/types";
import { LanguageProvider } from "../../i18n";

const { playPreviewMock } = vi.hoisted(() => ({
  playPreviewMock: vi.fn()
}));

vi.mock("../../services/preview", () => ({
  playPreview: playPreviewMock,
  stopPreview: vi.fn()
}));

import { Inspector } from "./Inspector";

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
  durationSeconds: 60,
  status: "complete",
  edit: {
    exportEnabled: true,
    sourceInSeconds: 0,
    sourceOutSeconds: 60,
    phaseNudgeBeats: 0
  },
  order: 0
};

describe("track preview status", () => {
  beforeEach(() => {
    localStorage.clear();
    playPreviewMock.mockReset();
  });
  afterEach(cleanup);

  it("switches from preparing to playing when audio playback starts", async () => {
    let playbackStarted!: () => void;
    playPreviewMock.mockImplementation(() => new Promise<void>((resolve) => {
      playbackStarted = resolve;
    }));

    render(
      <LanguageProvider>
        <Inspector
          project={createProject("Test")}
          track={track}
          busy={false}
          onTrackEdit={vi.fn()}
          onReanalyze={vi.fn()}
        />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("tab", { name: "试听" }));
    fireEvent.click(screen.getByRole("button", { name: "原始音频" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在准备试听片段...");

    await waitFor(() => expect(playPreviewMock).toHaveBeenCalledOnce());
    playbackStarted();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("试听中"));
  });
});
