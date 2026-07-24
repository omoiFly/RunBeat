import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, type ProjectV1 } from "../../domain/types";
import type { AppLanguage } from "../../i18n";
import { downloadBlob, renderProject, type RenderResult } from "../../services/render";
import { useExportRenderJob } from "./useExportRenderJob";

vi.mock("../../services/render", () => ({
  downloadBlob: vi.fn(),
  renderProject: vi.fn()
}));

describe("useExportRenderJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps progress outside the export panel and completes after parent rerenders", async () => {
    let finish!: (result: RenderResult) => void;
    const pendingResult = new Promise<RenderResult>((resolve) => { finish = resolve; });
    vi.mocked(renderProject).mockImplementation(async (_project, onProgress) => {
      onProgress({ jobId: "job", stage: "stretch", progress: 0.35, message: "处理中" });
      return pendingResult;
    });
    const project = createProject("测试项目");
    const { result, rerender } = renderHook(({
      currentProject,
      currentLanguage
    }: {
      currentProject: ProjectV1;
      currentLanguage: AppLanguage;
    }) => useExportRenderJob(currentProject, currentLanguage), {
      initialProps: { currentProject: project, currentLanguage: "zh-CN" as AppLanguage }
    });

    let running!: Promise<void>;
    act(() => { running = result.current.startRender(); });
    await waitFor(() => expect(result.current.renderState.progress?.progress).toBe(0.35));
    expect(renderProject).toHaveBeenCalledWith(
      project,
      expect.any(Function),
      expect.objectContaining({ language: "zh-CN" })
    );

    rerender({ currentProject: { ...project, name: "渲染期间修改标题" }, currentLanguage: "en" });
    expect(result.current.renderState.status).toBe("rendering");

    const rendered: RenderResult = { blob: new Blob(["audio"]), fileName: "mix.wav", durationSeconds: 123 };
    await act(async () => { finish(rendered); await running; });

    expect(downloadBlob).toHaveBeenCalledWith(rendered.blob, "mix.wav");
    expect(result.current.renderState).toMatchObject({ status: "completed", completedDuration: 123 });
  });
});
