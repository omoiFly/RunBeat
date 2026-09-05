import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../../domain/types";
import { LanguageProvider } from "../../i18n";
import { playBeatPreview } from "../../services/preview";
import { ProjectPropertiesDialog } from "./ProjectPropertiesDialog";

const customBeatSample = {
  channels: [Float32Array.from([0.9, 0.2])],
  sampleRate: 44_100
};

vi.mock("../../services/customBeat", () => ({
  decodeCustomBeatFile: vi.fn(async () => customBeatSample),
  getCustomBeatSample: vi.fn(() => undefined)
}));

vi.mock("../../services/preview", async () => {
  const actual = await vi.importActual<typeof import("../../services/preview")>("../../services/preview");
  return { ...actual, playBeatPreview: vi.fn(async () => undefined) };
});

describe("project beat-track properties", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("starts at -10 dB and can be raised by 20 dB", () => {
    render(
      <LanguageProvider>
        <ProjectPropertiesDialog
          open
          project={createProject("Test")}
          onApply={vi.fn()}
          onClose={vi.fn()}
        />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("tab", { name: /节拍轨|Beat Track/ }));
    const gain = screen.getByRole("slider", { name: "相对音量:" });
    expect(gain).toHaveAttribute("min", "-40");
    expect(gain).toHaveAttribute("max", "10");
    expect(gain).toHaveValue("-10");

    fireEvent.change(gain, { target: { value: "10" } });
    expect(gain).toHaveValue("10");
    expect(screen.getByText("+10 dB")).toBeVisible();
  });

  it("enables preview after a custom beat finishes decoding", async () => {
    render(
      <LanguageProvider>
        <ProjectPropertiesDialog
          open
          project={createProject("Test")}
          onApply={vi.fn()}
          onClose={vi.fn()}
        />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("tab", { name: "节拍轨" }));
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, {
      target: { files: [new File(["beat"], "beat.mp3", { type: "audio/mpeg" })] }
    });

    const previewButton = screen.getByRole("button", { name: /试听|Preview/ });
    expect(previewButton).toBeDisabled();
    await waitFor(() => expect(previewButton).toBeEnabled());

    fireEvent.click(previewButton);
    await waitFor(() => expect(playBeatPreview).toHaveBeenCalledWith(
      expect.objectContaining({ beatTrack: expect.objectContaining({ sound: "custom" }) }),
      customBeatSample
    ));
  });

  it("keeps the uploaded filename after applying the custom beat", async () => {
    const onApply = vi.fn(async () => ({
      resourceId: "resource-1",
      fileName: "beat.mp3",
      fileSize: 4,
      mimeType: "audio/mpeg",
      lastModified: 1,
      durationSeconds: 1,
      available: true
    }));
    render(
      <LanguageProvider>
        <ProjectPropertiesDialog
          open
          project={createProject("Test")}
          onApply={onApply}
          onClose={vi.fn()}
        />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("tab", { name: /节拍轨|Beat Track/ }));
    const fileInput = document.querySelector('input[type="file"]');
    fireEvent.change(fileInput!, {
      target: { files: [new File(["beat"], "beat.mp3", { type: "audio/mpeg" })] }
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /试听|Preview/ })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /应用|Apply/ }));
    await waitFor(() => expect(screen.getByText("beat.mp3")).toBeVisible());
    expect(onApply).toHaveBeenCalled();
  });
});
