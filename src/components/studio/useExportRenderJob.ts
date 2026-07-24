import { useEffect, useRef, useState } from "react";
import type { ProjectV1, RenderProgress } from "../../domain/types";
import type { AppLanguage } from "../../i18n";
import { downloadBlob, renderProject } from "../../services/render";

export interface ExportRenderState {
  status: "idle" | "rendering" | "completed" | "failed";
  progress?: RenderProgress;
  error?: string;
  completedDuration?: number;
}

const IDLE_RENDER_STATE: ExportRenderState = { status: "idle" };

export function useExportRenderJob(project: ProjectV1, language: AppLanguage) {
  const [renderState, setRenderState] = useState<ExportRenderState>(IDLE_RENDER_STATE);
  const controller = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const projectId = useRef(project.id);

  useEffect(() => {
    if (projectId.current === project.id) return;
    projectId.current = project.id;
    generation.current += 1;
    controller.current?.abort();
    controller.current = undefined;
    setRenderState(IDLE_RENDER_STATE);
  }, [project.id]);

  const startRender = async (projectOverride?: ProjectV1, coverImage?: File) => {
    if (controller.current) return;
    const renderProjectSnapshot = projectOverride ?? project;
    const renderLanguage = language;
    const currentGeneration = ++generation.current;
    const currentController = new AbortController();
    controller.current = currentController;
    setRenderState({ status: "rendering" });

    try {
      const result = await renderProject(renderProjectSnapshot, (progress) => {
        if (generation.current === currentGeneration) setRenderState({ status: "rendering", progress });
      }, { signal: currentController.signal, language: renderLanguage, coverImage });
      if (generation.current !== currentGeneration) return;
      downloadBlob(result.blob, result.fileName);
      setRenderState({
        status: "completed",
        progress: { jobId: result.fileName, stage: "qa", progress: 1, message: "完成" },
        completedDuration: result.durationSeconds
      });
    } catch (renderError) {
      if (generation.current !== currentGeneration) return;
      const cancelled = currentController.signal.aborted;
      setRenderState({
        status: "failed",
        error: cancelled ? "渲染已取消" : renderError instanceof Error ? renderError.message : String(renderError)
      });
    } finally {
      if (generation.current === currentGeneration) controller.current = undefined;
    }
  };

  const cancelRender = () => controller.current?.abort();

  return { renderState, startRender, cancelRender };
}
