import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import type { ExportSettings, ProjectV1 } from "../../domain/types";
import { useI18n } from "../../i18n";
import { COVER_IMAGE_ACCEPT, coverImageValidationError } from "../../services/coverVideo";
import { MAX_EXPORT_TRACKS, resolveExportEnabled } from "../../services/exportSelection";
import { isTrackIncluded } from "../../services/render";
import { estimateProjectDuration } from "../../services/renderEstimate";
import { formatTimelineTimestamp } from "../../services/timeline";
import { ClassicIcon } from "../ClassicIcon";
import type { ExportRenderState } from "./useExportRenderJob";

type WizardStep = "content" | "cover" | "format" | "summary";

const PAGE_TITLES: Record<WizardStep, string> = {
  content: "选择要导出的内容",
  cover: "选择可选的封面视频",
  format: "选择格式和响度",
  summary: "完成导出设置"
};

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
  onStart: (project: ProjectV1, coverImage?: File) => void;
  onCancelRender: () => void;
  onClose: () => void;
}) {
  const { t, translateMessage } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);
  const [settings, setSettings] = useState<ExportSettings>(project.exportSettings);
  const [coverImage, setCoverImage] = useState<File>();
  const [coverError, setCoverError] = useState<string>();
  const [started, setStarted] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const steps = useMemo<WizardStep[]>(() => (
    settings.mode === "continuous"
      ? ["content", "cover", "format", "summary"]
      : ["content", "format", "summary"]
  ), [settings.mode]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const exportProject = useMemo<ProjectV1>(() => ({ ...project, exportSettings: settings }), [project, settings]);
  const selectedTracks = exportProject.tracks.filter((track) => resolveExportEnabled(track, exportProject.maxTempoChangePercent));
  const readyTracks = selectedTracks.filter((track) => isTrackIncluded(track, exportProject));
  const exportLimitExceeded = selectedTracks.length > MAX_EXPORT_TRACKS;
  const canExport = readyTracks.length > 0 && !exportLimitExceeded;
  const estimatedDuration = estimateProjectDuration(exportProject);
  const rendering = renderState.status === "rendering";
  const progress = renderState.progress?.progress ?? 0;
  const videoCover = settings.mode === "continuous" ? coverImage : undefined;

  const finish = () => {
    onSettings(settings);
    setStarted(true);
    onStart(exportProject, videoCover);
  };

  const selectCoverImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const error = coverImageValidationError(file);
    setCoverError(error);
    if (error) {
      setCoverImage(undefined);
      event.currentTarget.value = "";
      return;
    }
    setCoverImage(file);
    void import("../../services/runtimePreload").then(({ prefetchFfmpegRuntime }) => {
      prefetchFfmpegRuntime(undefined, true);
    });
  };

  const removeCoverImage = () => {
    setCoverImage(undefined);
    setCoverError(undefined);
    if (coverInputRef.current) coverInputRef.current.value = "";
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
                <h2>{t(PAGE_TITLES[step])}</h2>
                <p>{t("导出音频向导 - 第 {page} 页，共 {total} 页", { page: stepIndex + 1, total: steps.length })}</p>
              </div>
              <ClassicIcon name="export" size={32} />
            </header>
            <div className="wizard-page">
              {step === "content" && <fieldset>
                <legend>{t("导出内容")}</legend>
                <div className="classic-radio-list" data-help="export-mode">
                  <div className="field-row"><input id="export-mode-continuous-beat" type="radio" name="export-mode" checked={settings.mode === "continuous" && settings.includeBeat} onChange={() => setSettings((current) => ({ ...current, mode: "continuous", includeBeat: true }))} /><label htmlFor="export-mode-continuous-beat">{t("连续跑步音乐（带节拍）")}</label></div>
                  <div className="field-row"><input id="export-mode-continuous-plain" type="radio" name="export-mode" checked={settings.mode === "continuous" && !settings.includeBeat} onChange={() => setSettings((current) => ({ ...current, mode: "continuous", includeBeat: false }))} /><label htmlFor="export-mode-continuous-plain">{t("连续跑步音乐（不带节拍）")}</label></div>
                  <div className="field-row"><input id="export-mode-separate-beat" type="radio" name="export-mode" checked={settings.mode === "separate" && settings.includeBeat} onChange={() => setSettings((current) => ({ ...current, mode: "separate", includeBeat: true }))} /><label htmlFor="export-mode-separate-beat">{t("分别导出处理后的歌曲（带节拍）")}</label></div>
                  <div className="field-row"><input id="export-mode-separate-plain" type="radio" name="export-mode" checked={settings.mode === "separate" && !settings.includeBeat} onChange={() => setSettings((current) => ({ ...current, mode: "separate", includeBeat: false }))} /><label htmlFor="export-mode-separate-plain">{t("分别导出处理后的歌曲（不带节拍）")}</label></div>
                </div>
              </fieldset>}

              {step === "cover" && <fieldset className="cover-video-options" data-help="export-cover-video">
                <legend>{t("封面视频（可选）")}</legend>
                <p>{t("选择一张图片后，合并音频会导出为带静态封面的 MP4；不选择则继续导出普通音频。")}</p>
                <div className="classic-form-grid">
                  <label htmlFor="export-wizard-cover">{t("封面图片:")}</label>
                  <div className={`cover-file-picker${coverImage ? " has-selection" : ""}`}>
                    <span
                      id="export-wizard-cover-name"
                      className="cover-file-name sunken-panel"
                      title={coverImage?.name}
                    >{coverImage?.name ?? t("未选择文件")}</span>
                    <button type="button" onClick={() => coverInputRef.current?.click()}>{t("浏览...")}</button>
                    {coverImage && <button className="cover-file-remove" type="button" onClick={removeCoverImage}>{t("移除图片")}</button>}
                    <input
                      ref={coverInputRef}
                      id="export-wizard-cover"
                      className="visually-hidden"
                      type="file"
                      accept={COVER_IMAGE_ACCEPT}
                      aria-describedby="export-wizard-cover-name"
                      onChange={selectCoverImage}
                    />
                  </div>
                </div>
                {coverImage && <p className="cover-file-size">{(coverImage.size / 1024 / 1024).toFixed(1)} MB</p>}
                {coverError && <p className="wizard-error"><ClassicIcon name="warning" />{t(coverError)}</p>}
                <p className="wizard-note">{t("支持 JPG、PNG、WebP，最大 20 MB。图片只在本机处理，不会上传；视频为 1920×1080，图片会等比缩放并留黑边。")}</p>
              </fieldset>}

              {step === "format" && <>
                <fieldset>
                  <legend>{t(videoCover ? "视频格式" : "音频格式")}</legend>
                  {videoCover
                    ? <div className="classic-form-grid">
                      <span>{t("格式:")}</span>
                      <span>MP4 · H.264 · 1920×1080</span>
                      <label htmlFor="export-wizard-bitrate">{t("音频码率:")}</label>
                      <select id="export-wizard-bitrate" value={settings.mp3BitrateKbps} onChange={(event) => setSettings((current) => ({ ...current, mp3BitrateKbps: Number(event.target.value) as ExportSettings["mp3BitrateKbps"] }))}>
                        <option value={128}>128 kbps</option>
                        <option value={192}>192 kbps</option>
                        <option value={256}>256 kbps</option>
                        <option value={320}>320 kbps</option>
                      </select>
                      <span>{t("音频编码:")}</span>
                      <span>AAC</span>
                    </div>
                    : <div className="classic-form-grid">
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
                    </div>}
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

              {step === "summary" && <fieldset>
                <legend>{t("导出摘要")}</legend>
                <dl className="wizard-summary">
                  <dt>{t("项目:")}</dt><dd>{project.name}</dd>
                  <dt>{t("内容:")}</dt><dd>{t(exportContentLabel(settings))}</dd>
                  <dt>{t("歌曲:")}</dt><dd>{t("{count} 首", { count: readyTracks.length })}</dd>
                  <dt>{t("格式:")}</dt><dd>{videoCover
                    ? `MP4, H.264 + AAC, ${settings.mp3BitrateKbps} kbps`
                    : settings.format === "mp3" ? `MP3, ${settings.mp3BitrateKbps} kbps` : "WAV, 16-bit"}</dd>
                  {videoCover && <><dt>{t("封面:")}</dt><dd>{videoCover.name}</dd></>}
                  <dt>{t("目标步频:")}</dt><dd>{project.targetSpm} SPM</dd>
                  <dt>{t("预计时长:")}</dt><dd>{formatTimelineTimestamp(estimatedDuration)}</dd>
                </dl>
                {readyTracks.length === 0 && <p className="wizard-error"><ClassicIcon name="warning" />{t("没有可导出的歌曲。请取消向导并在歌曲列表中勾选至少一首分析完成的歌曲。")}</p>}
                {exportLimitExceeded && <p className="wizard-error"><ClassicIcon name="warning" />{t(
                  "一次最多导出 {limit} 首歌曲。当前已勾选 {count} 首，请取消向导并调整导出选择。",
                  { limit: MAX_EXPORT_TRACKS, count: selectedTracks.length }
                )}</p>}
                {selectedTracks.length !== readyTracks.length && <p className="wizard-warning"><ClassicIcon name="warning" />{t("{count} 首所选歌曲尚未就绪，不会导出。", { count: selectedTracks.length - readyTracks.length })}</p>}
              </fieldset>}
            </div>
            <div className="wizard-command-row">
              <button type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>{t("< 上一步")}</button>
              {stepIndex < steps.length - 1
                ? <button className="default" type="button" onClick={() => setStepIndex((current) => Math.min(steps.length - 1, current + 1))}>{t("下一步 >")}</button>
                : <button className="default" type="button" disabled={!canExport} onClick={finish}>{t("完成")}</button>}
              <span />
              <button type="button" onClick={onClose}>{t("取消")}</button>
            </div>
          </>}

          {started && <div className="export-progress-page">
            <div className="export-progress-icon"><ClassicIcon name={renderState.status === "completed" ? "check" : renderState.status === "failed" ? "error" : "export"} size={32} /></div>
            <div>
              <h2>{renderState.status === "completed"
                ? t("导出完成")
                : renderState.status === "failed"
                  ? t("无法完成导出")
                  : t(videoCover ? "正在生成封面视频" : "正在导出音频")}</h2>
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
            {renderState.status === "failed" && <button type="button" onClick={() => onStart(exportProject, videoCover)}>{t("重试")}</button>}
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
