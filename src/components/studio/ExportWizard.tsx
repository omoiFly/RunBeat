import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import type { ExportSettings, ProjectV1 } from "../../domain/types";
import { useI18n } from "../../i18n";
import { resolveExportEnabled } from "../../services/exportSelection";
import { isTrackIncluded } from "../../services/render";
import { estimateProjectDuration } from "../../services/renderEstimate";
import { formatTimelineTimestamp } from "../../services/timeline";
import { ClassicIcon } from "../ClassicIcon";
import type { ExportRenderState } from "./useExportRenderJob";

type WizardPage = 0 | 1 | 2;

const PAGE_TITLES = [
  "选择要导出的内容",
  "选择音频格式和响度",
  "完成导出设置"
] as const;

function exportContentLabel(settings: ExportSettings): string {
  if (settings.mode === "continuous") {
    return settings.includeBeat ? "连续跑步音乐（带节拍）" : "连续跑步音乐（不带节拍）";
  }
  return settings.includeBeat ? "分别导出处理后的歌曲（带节拍）" : "分别导出处理后的歌曲（不带节拍）";
}

export function ExportWizard({
  open,
  project,
  renderState,
  onSettings,
  onStart,
  onCancelRender,
  onClose
}: {
  open: boolean;
  project: ProjectV1;
  renderState: ExportRenderState;
  onSettings: (settings: ExportSettings) => void;
  onStart: (project: ProjectV1) => void;
  onCancelRender: () => void;
  onClose: () => void;
}) {
  const { t, translateMessage } = useI18n();
  const [page, setPage] = useState<WizardPage>(0);
  const [settings, setSettings] = useState<ExportSettings>(project.exportSettings);
  const [started, setStarted] = useState(false);
  const exportProject = useMemo<ProjectV1>(() => ({ ...project, exportSettings: settings }), [project, settings]);
  const selectedTracks = exportProject.tracks.filter((track) => resolveExportEnabled(track, exportProject.maxTempoChangePercent));
  const readyTracks = selectedTracks.filter((track) => isTrackIncluded(track, exportProject));
  const canExport = readyTracks.length > 0;
  const estimatedDuration = estimateProjectDuration(exportProject);
  const rendering = renderState.status === "rendering";
  const progress = renderState.progress?.progress ?? 0;

  const finish = () => {
    onSettings(settings);
    setStarted(true);
    onStart(exportProject);
  };

  const close = () => {
    if (rendering) return;
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-input-shield" />
        <Dialog.Content
          className="export-wizard window"
          onEscapeKeyDown={(event) => {
            if (rendering) event.preventDefault();
          }}
        >
          <div className="title-bar">
            <Dialog.Title className="title-bar-text">{t("导出音频向导")}</Dialog.Title>
            <div className="title-bar-controls"><Dialog.Close asChild><button className="close" type="button" aria-label={t("关闭")} disabled={rendering} /></Dialog.Close></div>
          </div>

          {!started && <>
            <header className="wizard-banner">
              <div>
                <h2>{t(PAGE_TITLES[page])}</h2>
                <p>{t("导出音频向导 - 第 {page} 页，共 3 页", { page: page + 1 })}</p>
              </div>
              <ClassicIcon name="export" size={32} />
            </header>
            <div className="wizard-page">
              {page === 0 && <fieldset>
                <legend>{t("导出内容")}</legend>
                <div className="classic-radio-list" data-help="export-mode">
                  <div className="field-row"><input id="export-mode-continuous-beat" type="radio" name="export-mode" checked={settings.mode === "continuous" && settings.includeBeat} onChange={() => setSettings((current) => ({ ...current, mode: "continuous", includeBeat: true }))} /><label htmlFor="export-mode-continuous-beat">{t("连续跑步音乐（带节拍）")}</label></div>
                  <div className="field-row"><input id="export-mode-continuous-plain" type="radio" name="export-mode" checked={settings.mode === "continuous" && !settings.includeBeat} onChange={() => setSettings((current) => ({ ...current, mode: "continuous", includeBeat: false }))} /><label htmlFor="export-mode-continuous-plain">{t("连续跑步音乐（不带节拍）")}</label></div>
                  <div className="field-row"><input id="export-mode-separate-beat" type="radio" name="export-mode" checked={settings.mode === "separate" && settings.includeBeat} onChange={() => setSettings((current) => ({ ...current, mode: "separate", includeBeat: true }))} /><label htmlFor="export-mode-separate-beat">{t("分别导出处理后的歌曲（带节拍）")}</label></div>
                  <div className="field-row"><input id="export-mode-separate-plain" type="radio" name="export-mode" checked={settings.mode === "separate" && !settings.includeBeat} onChange={() => setSettings((current) => ({ ...current, mode: "separate", includeBeat: false }))} /><label htmlFor="export-mode-separate-plain">{t("分别导出处理后的歌曲（不带节拍）")}</label></div>
                </div>
              </fieldset>}

              {page === 1 && <>
                <fieldset>
                  <legend>{t("音频格式")}</legend>
                  <div className="classic-form-grid">
                    <label htmlFor="export-wizard-format">{t("格式:")}</label>
                    <select id="export-wizard-format" data-help="export-format" value={settings.format} onChange={(event) => setSettings((current) => ({ ...current, format: event.target.value as ExportSettings["format"] }))}>
                      <option value="mp3">MP3</option>
                      <option value="wav">WAV</option>
                    </select>
                    {settings.format === "mp3" && <>
                      <label htmlFor="export-wizard-bitrate">{t("码率:")}</label>
                      <select id="export-wizard-bitrate" value={settings.mp3BitrateKbps} onChange={(event) => setSettings((current) => ({ ...current, mp3BitrateKbps: Number(event.target.value) as ExportSettings["mp3BitrateKbps"] }))}>
                        <option value={128}>128 kbps</option>
                        <option value={192}>192 kbps</option>
                        <option value={256}>256 kbps</option>
                        <option value={320}>320 kbps</option>
                      </select>
                    </>}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>{t("响度")}</legend>
                  <div className="classic-form-grid">
                    <label htmlFor="export-wizard-loudness">{t("目标:")}</label>
                    <select id="export-wizard-loudness" data-help="export-loudness" value={settings.loudnessLufs} onChange={(event) => setSettings((current) => ({ ...current, loudnessLufs: Number(event.target.value) as ExportSettings["loudnessLufs"] }))}>
                      <option value={-16}>-16 LUFS</option>
                      <option value={-14}>-14 LUFS</option>
                      <option value={-12}>-12 LUFS</option>
                    </select>
                  </div>
                  <div className="field-row">
                    <input id="export-wizard-normalize" type="checkbox" checked={settings.normalizeLoudness} onChange={(event) => setSettings((current) => ({ ...current, normalizeLoudness: event.target.checked }))} />
                    <label htmlFor="export-wizard-normalize">{t("响度标准化")}</label>
                  </div>
                  {settings.mode === "continuous" && <div className="field-row">
                    <input id="export-wizard-timeline" type="checkbox" checked={settings.includeTimeline} onChange={(event) => setSettings((current) => ({ ...current, includeTimeline: event.target.checked }))} />
                    <label htmlFor="export-wizard-timeline">{t("同时导出 TXT / CSV 时间轴")}</label>
                  </div>}
                </fieldset>
              </>}

              {page === 2 && <fieldset>
                <legend>{t("导出摘要")}</legend>
                <dl className="wizard-summary">
                  <dt>{t("项目:")}</dt><dd>{project.name}</dd>
                  <dt>{t("内容:")}</dt><dd>{t(exportContentLabel(settings))}</dd>
                  <dt>{t("歌曲:")}</dt><dd>{t("{count} 首", { count: readyTracks.length })}</dd>
                  <dt>{t("格式:")}</dt><dd>{settings.format === "mp3" ? `MP3, ${settings.mp3BitrateKbps} kbps` : "WAV, 16-bit"}</dd>
                  <dt>{t("目标步频:")}</dt><dd>{project.targetSpm} SPM</dd>
                  <dt>{t("预计时长:")}</dt><dd>{formatTimelineTimestamp(estimatedDuration)}</dd>
                </dl>
                {!canExport && <p className="wizard-error"><ClassicIcon name="warning" />{t("没有可导出的歌曲。请取消向导并在歌曲列表中勾选至少一首分析完成的歌曲。")}</p>}
                {selectedTracks.length !== readyTracks.length && <p className="wizard-warning"><ClassicIcon name="warning" />{t("{count} 首所选歌曲尚未就绪，不会导出。", { count: selectedTracks.length - readyTracks.length })}</p>}
              </fieldset>}
            </div>
            <div className="wizard-command-row">
              <button type="button" disabled={page === 0} onClick={() => setPage((page - 1) as WizardPage)}>{t("< 上一步")}</button>
              {page < 2
                ? <button className="default" type="button" onClick={() => setPage((page + 1) as WizardPage)}>{t("下一步 >")}</button>
                : <button className="default" type="button" disabled={!canExport} onClick={finish}>{t("完成")}</button>}
              <span />
              <button type="button" onClick={onClose}>{t("取消")}</button>
            </div>
          </>}

          {started && <div className="export-progress-page">
            <div className="export-progress-icon"><ClassicIcon name={renderState.status === "completed" ? "check" : renderState.status === "failed" ? "error" : "export"} size={32} /></div>
            <div>
              <h2>{renderState.status === "completed" ? t("导出完成") : renderState.status === "failed" ? t("无法完成导出") : t("正在导出音频")}</h2>
              <p>{renderState.status === "completed"
                ? t("文件已开始下载。最终时长 {duration}。", { duration: formatTimelineTimestamp(renderState.completedDuration ?? estimatedDuration) })
                : renderState.status === "failed"
                  ? translateMessage(renderState.error)
                  : translateMessage(renderState.progress?.message) || t("正在准备...")}</p>
              {rendering && <>
                <div className="classic-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${progress * 100}%` }} />
                </div>
                <p>{Math.round(progress * 100)}%</p>
              </>}
            </div>
          </div>}

          {started && <div className="wizard-command-row progress-commands">
            {renderState.status === "failed" && <button type="button" onClick={() => onStart(exportProject)}>{t("重试")}</button>}
            <span />
            {rendering
              ? <button type="button" onClick={onCancelRender}>{t("取消")}</button>
              : <button className="default" type="button" onClick={onClose}>{t("完成")}</button>}
          </div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
