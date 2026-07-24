import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { ProjectV1, Track } from "../../domain/types";
import { useI18n } from "../../i18n";
import { previewSourceRange, previewStartBounds } from "../../services/previewRange";
import { formatDuration } from "../../utils/format";
import { ClassicIcon } from "../ClassicIcon";

type PreviewMode = "original" | "processed" | "processed-beat";
type InspectorTab = "analysis" | "preview" | "advanced";
type PreviewStatus = "preparing" | "playing";
interface TrackPreviewRequest {
  trackId: string;
  mode: Exclude<PreviewMode, "original">;
}

const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: "analysis", label: "分析" },
  { id: "preview", label: "试听" },
  { id: "advanced", label: "高级" }
];

let previewServicePromise: Promise<typeof import("../../services/preview")> | undefined;

function loadPreviewService(): Promise<typeof import("../../services/preview")> {
  previewServicePromise ??= import("../../services/preview");
  return previewServicePromise;
}

type Translate = ReturnType<typeof useI18n>["t"];

function phaseAlignmentSummary(track: Track, t: Translate): { label: string; detail?: string } {
  const analysis = track.derivedAnalysis;
  if (!analysis) return { label: "--" };
  const coverage = analysis.phaseCoverage;
  const error = analysis.phaseMedianErrorMs;
  const metrics = [
    analysis.phaseConfidence == null ? undefined : t("相位置信度 {value}%", { value: (analysis.phaseConfidence * 100).toFixed(0) }),
    coverage == null ? undefined : t("可靠拍点覆盖 {value}%", { value: (coverage * 100).toFixed(0) }),
    error == null ? undefined : t("中位误差 {value} ms", { value: error.toFixed(0) }),
    analysis.bpmRefinementPercent == null
      ? undefined
      : t("映射 BPM 精修 {value}%", { value: `${analysis.bpmRefinementPercent >= 0 ? "+" : ""}${analysis.bpmRefinementPercent.toFixed(2)}` })
  ].filter((value): value is string => value != null).join("; ");
  if (analysis.phaseOffsetSeconds == null) {
    return { label: coverage == null ? t("需校准 · 未锁定") : `${t("需校准")} · ${(coverage * 100).toFixed(0)}%`, detail: metrics };
  }
  if (analysis.phaseAlignmentModel === "manual") return { label: t("手动锁定"), detail: t("使用手动指定的歌曲首拍") };
  if (analysis.qualityFactors?.phaseAlignment === "needs-calibration") {
    return { label: coverage == null ? t("需校准") : `${t("需校准")} · ${(coverage * 100).toFixed(0)}%`, detail: metrics };
  }
  const model = analysis.phaseAlignmentModel === "beat-refined" ? t("拍点精修") : t("全局锁定");
  const stability = analysis.qualityFactors?.phaseAlignment === "acceptable" ? t("需试听") : t("稳定");
  return { label: `${model} · ${stability}`, detail: metrics };
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  window.dispatchEvent(new CustomEvent("runbeat:error", { detail: message }));
}

export function Inspector({ project, track, busy, onTrackEdit, onReanalyze }: {
  project: ProjectV1;
  track?: Track;
  busy: boolean;
  onTrackEdit: (patch: Partial<Track["edit"]>) => void;
  onReanalyze: () => void;
}) {
  const { t, translateMessage } = useI18n();
  const [tab, setTab] = useState<InspectorTab>("analysis");
  const [previewStarts, setPreviewStarts] = useState<Record<string, number>>({});
  const [previewing, setPreviewing] = useState<{ id: number; trackId: string; mode: PreviewMode; status: PreviewStatus }>();
  const previewRequest = useRef(0);
  const phaseSummary = track ? phaseAlignmentSummary(track, t) : undefined;
  const previewBounds = track?.durationSeconds
    ? previewStartBounds(track, track.durationSeconds)
    : undefined;
  const previewRange = track?.durationSeconds
    ? previewSourceRange(track, track.durationSeconds, previewStarts[track.id])
    : undefined;
  const previewProgress = previewBounds && previewRange && previewBounds.maxSeconds > previewBounds.minSeconds
    ? (previewRange.startSeconds - previewBounds.minSeconds) / (previewBounds.maxSeconds - previewBounds.minSeconds) * 100
    : 0;
  const activePreviewMode = previewing && previewing.trackId === track?.id ? previewing.mode : undefined;

  const stop = useCallback(() => {
    previewRequest.current += 1;
    void previewServicePromise?.then(({ stopPreview }) => stopPreview());
    setPreviewing(undefined);
  }, []);

  const preview = useCallback(async (mode: PreviewMode) => {
    if (!track) return;
    const id = previewRequest.current + 1;
    previewRequest.current = id;
    setPreviewing({ id, trackId: track.id, mode, status: "preparing" });
    try {
      const { playPreview } = await loadPreviewService();
      if (previewRequest.current !== id) return;
      await playPreview(track, project, mode, previewRange?.startSeconds);
    } catch (error) {
      if (previewRequest.current === id) setPreviewing(undefined);
      reportError(error);
      return;
    }
    setPreviewing((current) => current?.id === id ? { ...current, status: "playing" } : current);
    window.setTimeout(() => {
      if (previewRequest.current === id) setPreviewing(undefined);
    }, 20_000);
  }, [project, track, previewRange]);

  useEffect(() => {
    const handlePreviewRequest = (event: Event) => {
      const request = (event as CustomEvent<TrackPreviewRequest>).detail;
      if (track?.id !== request.trackId) return;
      setTab("preview");
      void preview(request.mode);
    };
    window.addEventListener("runbeat:preview-track", handlePreviewRequest);
    return () => window.removeEventListener("runbeat:preview-track", handlePreviewRequest);
  }, [preview, track?.id]);

  useEffect(() => () => stop(), [stop, track?.id]);

  const selectPreviewStart = (startSeconds: number) => {
    if (!track) return;
    stop();
    setPreviewStarts((current) => ({ ...current, [track.id]: startSeconds }));
  };

  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, current: InspectorTab) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = INSPECTOR_TABS.findIndex((item) => item.id === current);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? INSPECTOR_TABS.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
    const next = INSPECTOR_TABS[nextIndex];
    setTab(next.id);
    window.requestAnimationFrame(() => document.getElementById(`inspector-tab-${next.id}`)?.focus());
  };

  return (
    <aside className="inspector-pane" aria-label={t("歌曲检查器")}>
      <div className="inspector-caption">{t("歌曲属性")}</div>
      <div className="inspector-filename sunken-panel" title={track?.source.fileName}>
        {track?.source.fileName ?? t("未选择歌曲")}
      </div>
      <div className="property-tabs" role="tablist" aria-label={t("歌曲属性页")}>
        {INSPECTOR_TABS.map((item) => <button
          key={item.id}
          id={`inspector-tab-${item.id}`}
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          tabIndex={tab === item.id ? 0 : -1}
          onClick={() => setTab(item.id)}
          onKeyDown={(event) => moveTabFocus(event, item.id)}
        >{t(item.label)}</button>)}
      </div>

      <div className="inspector-page sunken-panel">
        {!track && <div className="inspector-empty">{t("在歌曲列表中选择一首歌曲。")}</div>}

        {track && tab === "analysis" && <div className="inspector-tab-content">
          <fieldset>
            <legend>{t("分析结果")}</legend>
            <dl className="classic-property-grid">
              <dt>{t("原始 BPM")}:</dt><dd>{track.rawAnalysis?.rawBpm.toFixed(2) ?? "--"}</dd>
              <dt>{t("映射 BPM")}:</dt><dd>{track.derivedAnalysis?.normalizedBpm.toFixed(2) ?? "--"}</dd>
              <dt>{t("变速")}:</dt><dd>{track.derivedAnalysis ? `${track.derivedAnalysis.tempoChangePercent > 0 ? "+" : ""}${track.derivedAnalysis.tempoChangePercent.toFixed(2)}%` : "--"}</dd>
              <dt>{t("时长:")}</dt><dd>{formatDuration(track.durationSeconds)}</dd>
              <dt>{t("拍点:")}</dt><dd>{track.rawAnalysis?.beatTicks.length ? t("{count} 个", { count: track.rawAnalysis.beatTicks.length }) : "--"}</dd>
              <dt>{t("相位:")}</dt><dd title={phaseSummary?.detail}>{phaseSummary?.label ?? "--"}</dd>
            </dl>
          </fieldset>
          {!!track.derivedAnalysis?.warnings.length && <fieldset>
            <legend>{t("警告")}</legend>
            <ul className="classic-warning-list">{track.derivedAnalysis.warnings.map((warning) => <li key={warning}>{translateMessage(warning)}</li>)}</ul>
          </fieldset>}
          {(track.status === "failed" || track.rawAnalysis?.beatTicks.length === 0) && <button type="button" disabled={busy} onClick={onReanalyze}>
            {busy ? t("正在分析...") : t("重新分析")}
          </button>}
        </div>}

        {track && tab === "preview" && <div className="inspector-tab-content" data-help="track-preview">
          <fieldset>
            <legend>{t("试听位置")}</legend>
            {previewRange && previewBounds ? <>
              <div className="field-row preview-start-row">
                <label htmlFor={`preview-start-${track.id}`}>{t("起点:")}</label>
                <strong>{formatDuration(previewRange.startSeconds)}</strong>
              </div>
              <input
                id={`preview-start-${track.id}`}
                className="preview-position-slider"
                type="range"
                min={previewBounds.minSeconds}
                max={previewBounds.maxSeconds}
                step={0.5}
                value={previewRange.startSeconds}
                aria-valuetext={formatDuration(previewRange.startSeconds)}
                disabled={previewBounds.maxSeconds <= previewBounds.minSeconds}
                style={{ "--preview-progress": `${previewProgress}%` } as CSSProperties}
                onChange={(event) => selectPreviewStart(Number(event.target.value))}
              />
              <div className="preview-time-scale"><span>{formatDuration(previewBounds.minSeconds)}</span><span>{formatDuration(previewBounds.maxSeconds)}</span></div>
              <div className="preview-source-range">{formatDuration(previewRange.startSeconds)} - {formatDuration(previewRange.endSeconds)}</div>
            </> : <p>{t("分析完成后可以试听。")}</p>}
          </fieldset>
          <fieldset>
            <legend>{t("试听版本")}</legend>
            <div className="classic-button-column">
              <button type="button" className={activePreviewMode === "original" ? "pressed" : ""} onClick={() => void preview("original")}><ClassicIcon name="play" />{t("原始音频")}</button>
              <button type="button" className={activePreviewMode === "processed" ? "pressed" : ""} onClick={() => void preview("processed")}><ClassicIcon name="play" />{t("处理后")}</button>
              <button type="button" className={activePreviewMode === "processed-beat" ? "pressed" : ""} onClick={() => void preview("processed-beat")}><ClassicIcon name="play" />{t("处理后 + 节拍轨")}</button>
              <button type="button" disabled={!activePreviewMode} onClick={stop}><ClassicIcon name="stop" />{t("停止")}</button>
            </div>
          </fieldset>
          {activePreviewMode && <div className="classic-progress-label" role="status">
            {t(previewing?.status === "playing" ? "试听中" : "正在准备试听片段...")}
          </div>}
        </div>}

        {track && tab === "advanced" && <div className="inspector-tab-content">
          <fieldset>
            <legend>{t("手动校准")}</legend>
            <div className="classic-form-grid">
              <label htmlFor={`manual-bpm-${track.id}`}>BPM:</label>
              <input id={`manual-bpm-${track.id}`} type="number" min={40} max={240} placeholder={track.rawAnalysis?.rawBpm.toFixed(2)} value={track.edit.manualBpm ?? ""} onChange={(event) => onTrackEdit({ manualBpm: event.target.value ? Number(event.target.value) : undefined })} />
              <label htmlFor={`first-beat-${track.id}`}>{t("首拍(秒):")}</label>
              <input id={`first-beat-${track.id}`} type="number" min={0} max={track.durationSeconds} step={0.01} placeholder={t("自动检测")} value={track.edit.manualFirstBeat ?? ""} onChange={(event) => onTrackEdit({ manualFirstBeat: event.target.value ? Math.max(0, Math.min(Number(event.target.value), track.durationSeconds)) : undefined })} />
              <label htmlFor={`phase-${track.id}`}>{t("相位:")}</label>
              <select id={`phase-${track.id}`} value={track.edit.phaseNudgeBeats} onChange={(event) => onTrackEdit({ phaseNudgeBeats: Number(event.target.value) as -0.5 | 0 | 0.5 })}>
                <option value={-0.5}>{t("提前半拍")}</option>
                <option value={0}>{t("自动")}</option>
                <option value={0.5}>{t("延后半拍")}</option>
              </select>
            </div>
          </fieldset>
          <fieldset>
            <legend>{t("裁剪")}</legend>
            <div className="classic-form-grid">
              <label htmlFor={`trim-in-${track.id}`}>{t("入点(秒):")}</label>
              <input id={`trim-in-${track.id}`} type="number" min={0} max={track.edit.sourceOutSeconds} step={0.1} value={track.edit.sourceInSeconds.toFixed(1)} onChange={(event) => onTrackEdit({ sourceInSeconds: Math.max(0, Math.min(Number(event.target.value), track.edit.sourceOutSeconds)) })} />
              <label htmlFor={`trim-out-${track.id}`}>{t("出点(秒):")}</label>
              <input id={`trim-out-${track.id}`} type="number" min={track.edit.sourceInSeconds} max={track.durationSeconds} step={0.1} value={track.edit.sourceOutSeconds.toFixed(1)} onChange={(event) => onTrackEdit({ sourceOutSeconds: Math.max(track.edit.sourceInSeconds, Math.min(Number(event.target.value), track.durationSeconds)) })} />
            </div>
          </fieldset>
        </div>}
      </div>
    </aside>
  );
}
