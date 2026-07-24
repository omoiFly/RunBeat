import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../../domain/types";
import { LanguageProvider } from "../../i18n";
import { ExportWizard } from "./ExportWizard";

describe("export content choices", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("offers music exports with and without beats, without a beat-only mode", () => {
    render(
      <LanguageProvider>
        <ExportWizard
          open
          project={createProject("Test")}
          renderState={{ status: "idle" }}
          onSettings={vi.fn()}
          onStart={vi.fn()}
          onCancelRender={vi.fn()}
          onClose={vi.fn()}
        />
      </LanguageProvider>
    );

    const continuousWithBeat = screen.getByRole("radio", { name: "连续跑步音乐（带节拍）" });
    const continuousWithoutBeat = screen.getByRole("radio", { name: "连续跑步音乐（不带节拍）" });
    expect(screen.getByRole("radio", { name: "分别导出处理后的歌曲（带节拍）" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "分别导出处理后的歌曲（不带节拍）" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.queryByRole("radio", { name: "仅导出节拍轨" })).not.toBeInTheDocument();
    expect(continuousWithBeat).toBeChecked();

    fireEvent.click(continuousWithoutBeat);
    expect(continuousWithoutBeat).toBeChecked();
  });
});
