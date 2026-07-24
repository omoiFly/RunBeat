import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, type Track } from "../../domain/types";
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

  it("adds an optional local cover step to continuous exports and passes the image to rendering", () => {
    const project = createProject("Test");
    project.tracks = [{
      id: "track-1",
      source: {
        id: "source-1",
        fileName: "song.wav",
        fileSize: 1024,
        mimeType: "audio/wav",
        lastModified: 1,
        available: true
      },
      durationSeconds: 60,
      status: "complete",
      derivedAnalysis: {
        normalizedBpm: 180,
        detectorOctaveFactor: 1,
        stepsPerBeat: 1,
        effectiveFactor: 1,
        targetSpm: 180,
        tempoRatio: 1,
        timeRatio: 1,
        tempoChangePercent: 0,
        quality: "excellent",
        warnings: []
      },
      edit: {
        exportEnabled: true,
        sourceInSeconds: 0,
        sourceOutSeconds: 60,
        phaseNudgeBeats: 0
      },
      order: 0
    } satisfies Track];
    const onStart = vi.fn();

    render(
      <LanguageProvider>
        <ExportWizard
          open
          project={project}
          renderState={{ status: "idle" }}
          onSettings={vi.fn()}
          onStart={onStart}
          onCancelRender={vi.fn()}
          onClose={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(screen.getByText("导出音频向导 - 第 1 页，共 4 页")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "下一步 >" }));
    expect(screen.getByRole("group", { name: "封面视频（可选）" })).toBeVisible();

    const cover = new File(["image"], "run-cover.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("封面图片:"), { target: { files: [cover] } });
    expect(screen.getByText(/run-cover\.png/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "下一步 >" }));
    expect(screen.getByRole("group", { name: "视频格式" })).toContainHTML("H.264");
    fireEvent.click(screen.getByRole("button", { name: "下一步 >" }));
    expect(screen.getByRole("group", { name: "导出摘要" })).toHaveTextContent("MP4, H.264 + AAC");
    expect(screen.getByRole("group", { name: "导出摘要" })).toHaveTextContent("run-cover.png");

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: project.id }), cover);
    expect(screen.getByRole("heading", { name: "正在生成封面视频" })).toBeVisible();
  });

  it("skips the cover step for separate exports", () => {
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

    fireEvent.click(screen.getByRole("radio", { name: "分别导出处理后的歌曲（带节拍）" }));
    expect(screen.getByText("导出音频向导 - 第 1 页，共 3 页")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "下一步 >" }));
    expect(screen.getByRole("group", { name: "音频格式" })).toBeVisible();
    expect(screen.queryByLabelText("封面图片:")).not.toBeInTheDocument();
  });
});
