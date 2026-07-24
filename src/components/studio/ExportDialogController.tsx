import type { ExportSettings, ProjectV1 } from "../../domain/types";
import type { AppLanguage } from "../../i18n";
import { ExportWizard } from "./ExportWizard";
import { useExportRenderJob } from "./useExportRenderJob";

export function ExportDialogController({
  project,
  language,
  onSettings,
  onClose
}: {
  project: ProjectV1;
  language: AppLanguage;
  onSettings: (settings: ExportSettings) => void;
  onClose: () => void;
}) {
  const { renderState, startRender, cancelRender } = useExportRenderJob(project, language);

  return (
    <ExportWizard
      open
      project={project}
      renderState={renderState}
      onSettings={onSettings}
      onStart={(exportProject, coverImage) => void startRender(exportProject, coverImage)}
      onCancelRender={cancelRender}
      onClose={onClose}
    />
  );
}
