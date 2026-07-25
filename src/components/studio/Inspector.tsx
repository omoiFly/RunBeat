import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { ProjectV1, Track } from "../../domain/types";
import { useI18n } from "../../i18n";
import type {
  PreviewAlignment,
  TrackPreviewMode,
  TrackPreviewSession,
  TrackPreviewSnapshot
} from "../../services/preview";
import { unlockPreviewAudio } from "../../services/previewContext";
import { formatDuration } from "../../utils/format";
import { ClassicIcon } from "../ClassicIcon";

type InspectorTab = "analysis" | "preview";
interface TrackPreviewRequest {
  trackId: string;
  mode: Exclude<TrackPreviewMode, "original">;
}

interface ActivePreview {
  id: number;
  trackId: string;
  mode: TrackPreviewMode;
  snapshot: TrackPreviewSnapshot;
}

interface TrackEditDraft {
  manualBpm?: string;
  sourceIn?: string;
  sourceOut?: string;
}

const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: "analysis", label: "分析" },
  { id: "preview", label: "试听" }
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
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
  const [previewPositions, setPreviewPositions] = useState<Record<string, number>>({});
  const [previewing, setPreviewing] = useState<ActivePreview>();
  const [sliderEditing, setSliderEditing] = useState(false);
  const [editDrafts, setEditDrafts] = useState<Record<string, TrackEditDraft>>({});
  const previewPositionsRef = useRef<Record<string, number>>({});
  const previewRequest = useRef(0);
  const previewSession = useRef<TrackPreviewSession | undefined>(undefined);
  const unsubscribePreview = useRef<(() => void) | undefined>(undefined);
  const sliderPointerDown = useRef(false);
  const sliderInputActive = useRef(false);
  const sliderDraft = useRef(0);
  const seekTimer = useRef<number | undefined>(undefined);
  const reportedPreviewError = useRef("");
  const latestAlignment = useRef<PreviewAlignment>({
    phaseOffsetSeconds: track?.derivedAnalysis?.phaseOffsetSeconds,
    phaseNudgeBeats: track?.edit.phaseNudgeBeats ?? 0
  });

  const phaseSummary = track ? phaseAlignmentSummary(track, t) : undefined;
  const sourceIn = track ? clamp(track.edit.sourceInSeconds, 0, track.durationSeconds) : 0;
  const sourceOut = track ? clamp(track.edit.sourceOutSeconds, sourceIn, track.durationSeconds) : 0;
  const editDraft = track ? editDrafts[track.id] : undefined;
  const manualBpmDraft = editDraft?.manualBpm ?? track?.edit.manualBpm?.toString() ?? "";
  const sourceInDraft = editDraft?.sourceIn ?? (track ? track.edit.sourceInSeconds.toFixed(1) : "");
  const sourceOutDraft = editDraft?.sourceOut ?? (track ? track.edit.sourceOutSeconds.toFixed(1) : "");
  const storedPosition = track ? clamp(previewPositions[track.id] ?? sourceIn, sourceIn, sourceOut) : 0;
  const sessionPosition = previewing && previewing.trackId === track?.id
    ? clamp(previewing.snapshot.sourcePositionSeconds, sourceIn, sourceOut)
    : undefined;
  const previewPosition = sliderEditing ? storedPosition : sessionPosition ?? storedPosition;
  const previewProgress = sourceOut > sourceIn
    ? (previewPosition - sourceIn) / (sourceOut - sourceIn) * 100
    : 0;
  const activePreviewMode = previewing
    && previewing.trackId === track?.id
    && !["ended", "failed"].includes(previewing.snapshot.status)
    ? previewing.mode
    : undefined;

  const stop = useCallback(() => {
    previewRequest.current += 1;
    if (seekTimer.current != null) window.clearTimeout(seekTimer.current);
    seekTimer.current = undefined;
    unsubscribePreview.current?.();
    unsubscribePreview.current = undefined;
    previewSession.current?.stop();
    previewSession.current = undefined;
    sliderInputActive.current = false;
    void previewServicePromise?.then(({ stopPreview }) => stopPreview());
    setPreviewing(undefined);
    setSliderEditing(false);
  }, []);

  const trackId = track?.id;
  const phaseOffsetSeconds = track?.derivedAnalysis?.phaseOffsetSeconds;
  const phaseNudgeBeats = track?.edit.phaseNudgeBeats;
  useEffect(() => {
    if (phaseNudgeBeats == null) return;
    const alignment = { phaseOffsetSeconds, phaseNudgeBeats };
    latestAlignment.current = alignment;
    const session = previewSession.current;
    if (!session || previewing?.trackId !== trackId) return;
    session.updateAlignment(alignment);
  }, [
    previewing?.trackId,
    trackId,
    phaseOffsetSeconds,
    phaseNudgeBeats
  ]);

  const preview = useCallback(async (mode: TrackPreviewMode) => {
    if (!track) return;
    unlockPreviewAudio();
    const requestedPosition = clamp(
      previewPositionsRef.current[track.id] ?? track.edit.sourceInSeconds,
      track.edit.sourceInSeconds,
      track.edit.sourceOutSeconds
    );
    const startSeconds = requestedPosition >= track.edit.sourceOutSeconds - 0.01
      ? track.edit.sourceInSeconds
      : requestedPosition;
    stop();
    const id = previewRequest.current + 1;
    previewRequest.current = id;
    const initialSnapshot: TrackPreviewSnapshot = {
      status: "preparing",
      mode,
      sourcePositionSeconds: startSeconds,
      bufferedThroughSeconds: startSeconds,
      sourceEndSeconds: track.edit.sourceOutSeconds
    };
    setPreviewing({ id, trackId: track.id, mode, snapshot: initialSnapshot });
    previewPositionsRef.current[track.id] = startSeconds;
    setPreviewPositions((current) => ({ ...current, [track.id]: startSeconds }));
    sliderDraft.current = startSeconds;
    reportedPreviewError.current = "";
    try {
      const { startPreview } = await loadPreviewService();
      if (previewRequest.current !== id) return;
      const session = startPreview(track, project, mode, startSeconds);
      if (previewRequest.current !== id) {
        session.stop();
        return;
      }
      previewSession.current = session;
      session.updateAlignment(latestAlignment.current);
      const latestPosition = clamp(
        sliderDraft.current,
        track.edit.sourceInSeconds,
        track.edit.sourceOutSeconds
      );
      if (Math.abs(latestPosition - startSeconds) >= 0.001) session.seek(latestPosition);
      unsubscribePreview.current = session.subscribe((snapshot) => {
        if (previewRequest.current !== id) return;
        setPreviewing({ id, trackId: track.id, mode, snapshot });
        if (!sliderInputActive.current) {
          sliderDraft.current = snapshot.sourcePositionSeconds;
          previewPositionsRef.current[track.id] = snapshot.sourcePositionSeconds;
          setPreviewPositions((current) => ({
            ...current,
            [track.id]: snapshot.sourcePositionSeconds
          }));
        }
        if (snapshot.status === "failed" && snapshot.error && reportedPreviewError.current !== snapshot.error) {
          reportedPreviewError.current = snapshot.error;
          reportError(snapshot.error);
        }
      });
    } catch (error) {
      if (previewRequest.current === id) setPreviewing(undefined);
      reportError(error);
    }
  }, [project, stop, track]);

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

  const commitSeek = (requested: number) => {
    if (!track) return;
    if (seekTimer.current != null) window.clearTimeout(seekTimer.current);
    seekTimer.current = undefined;
    const next = clamp(requested, sourceIn, sourceOut);
    sliderDraft.current = next;
    sliderInputActive.current = false;
    previewPositionsRef.current[track.id] = next;
    setPreviewPositions((current) => ({ ...current, [track.id]: next }));
    previewSession.current?.seek(next);
    setSliderEditing(false);
  };

  const scheduleKeyboardSeek = () => {
    if (seekTimer.current != null) window.clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => {
      seekTimer.current = undefined;
      commitSeek(sliderDraft.current);
    }, 250);
  };

  const updatePreviewSlider = (value: number) => {
    if (!track) return;
    sliderDraft.current = value;
    sliderInputActive.current = true;
    previewPositionsRef.current[track.id] = value;
    setSliderEditing(true);
    setPreviewPositions((current) => ({ ...current, [track.id]: value }));
    if (!sliderPointerDown.current) scheduleKeyboardSeek();
  };

  const commitEdit = (patch: Partial<Track["edit"]>) => {
    stop();
    onTrackEdit(patch);
  };

  const setEditDraft = (field: keyof TrackEditDraft, value?: string) => {
    if (!track) return;
    setEditDrafts((current) => {
      const nextTrack = { ...current[track.id] };
      if (value == null) delete nextTrack[field];
      else nextTrack[field] = value;
      return { ...current, [track.id]: nextTrack };
    });
  };

  const commitManualBpm = () => {
    if (!track) return;
    const parsed = manualBpmDraft.trim() === "" ? undefined : Number(manualBpmDraft);
    if (parsed != null && !Number.isFinite(parsed)) {
      setEditDraft("manualBpm");
      return;
    }
    const next = parsed == null ? undefined : clamp(parsed, 40, 240);
    setEditDraft("manualBpm");
    if (next !== track.edit.manualBpm) commitEdit({ manualBpm: next });
  };

  const commitSourceIn = () => {
    if (!track) return;
    if (sourceInDraft.trim() === "") {
      setEditDraft("sourceIn");
      return;
    }
    const parsed = Number(sourceInDraft);
    if (!Number.isFinite(parsed)) {
      setEditDraft("sourceIn");
      return;
    }
    const next = clamp(parsed, 0, track.edit.sourceOutSeconds);
    setEditDraft("sourceIn");
    if (next !== track.edit.sourceInSeconds) commitEdit({ sourceInSeconds: next });
  };

  const commitSourceOut = () => {
    if (!track) return;
    if (sourceOutDraft.trim() === "") {
      setEditDraft("sourceOut");
      return;
    }
    const parsed = Number(sourceOutDraft);
    if (!Number.isFinite(parsed)) {
      setEditDraft("sourceOut");
      return;
    }
    const next = clamp(parsed, track.edit.sourceInSeconds, track.durationSeconds);
    setEditDraft("sourceOut");
    if (next !== track.edit.sourceOutSeconds) commitEdit({ sourceOutSeconds: next });
  };

  const handleDraftKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };

  const hotUpdateAlignment = (alignment: PreviewAlignment) => {
    latestAlignment.current = alignment;
    previewSession.current?.updateAlignment(alignment);
  };

  const changeFirstBeat = (rawValue: string) => {
    if (!track) return;
    const parsed = rawValue === "" ? undefined : Number(rawValue);
    if (parsed != null && !Number.isFinite(parsed)) return;
    const manualFirstBeat = parsed == null
      ? undefined
      : clamp(parsed, 0, track.durationSeconds);
    if (manualFirstBeat != null && Number.isFinite(manualFirstBeat)) {
      const interval = 60 / project.targetSpm;
      hotUpdateAlignment({
        phaseOffsetSeconds: positiveModulo(
          manualFirstBeat * (track.derivedAnalysis?.timeRatio ?? 1),
          interval
        ),
        phaseNudgeBeats: track.edit.phaseNudgeBeats
      });
    }
    onTrackEdit({ manualFirstBeat });
  };

  const changePhaseNudge = (phaseNudgeBeats: -0.5 | 0 | 0.5) => {
    if (!track) return;
    hotUpdateAlignment({
      phaseOffsetSeconds: track.derivedAnalysis?.phaseOffsetSeconds,
      phaseNudgeBeats
    });
    onTrackEdit({ phaseNudgeBeats });
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

  const previewStatusLabel = previewing ? {
    preparing: t("正在准备试听片段..."),
    buffering: t("正在缓冲试听..."),
    playing: t("试听中"),
    ended: t("试听已结束"),
    failed: t("试听失败")
  }[previewing.snapshot.status] : undefined;

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
          {track.status === "failed" && <fieldset className="analysis-error-panel" role="alert">
            <legend><span><ClassicIcon name="error" />{t("分析失败")}</span></legend>
            <p className="analysis-error-message">
              {translateMessage(track.error) || t("未提供错误详情。")}
            </p>
            <button type="button" disabled={busy} onClick={onReanalyze}>
              {busy ? t("正在分析...") : t("重新分析")}
            </button>
          </fieldset>}
          {!!track.derivedAnalysis?.warnings.length && <fieldset>
            <legend>{t("警告")}</legend>
            <ul className="classic-warning-list">{track.derivedAnalysis.warnings.map((warning) => <li key={warning}>{translateMessage(warning)}</li>)}</ul>
          </fieldset>}
          {track.status !== "failed" && track.rawAnalysis?.beatTicks.length === 0 && <button type="button" disabled={busy} onClick={onReanalyze}>
            {busy ? t("正在分析...") : t("重新分析")}
          </button>}
        </div>}

        {track && tab === "preview" && <div className="inspector-tab-content" data-help="track-preview">
          <fieldset>
            <legend>{t("试听位置")}</legend>
            <div className="field-row preview-start-row">
              <label htmlFor={`preview-start-${track.id}`}>{t("播放头:")}</label>
              <strong>{formatDuration(previewPosition)}</strong>
            </div>
            <input
              id={`preview-start-${track.id}`}
              className="preview-position-slider"
              type="range"
              min={sourceIn}
              max={sourceOut}
              step={0.1}
              value={previewPosition}
              aria-valuetext={formatDuration(previewPosition)}
              disabled={sourceOut <= sourceIn}
              style={{ "--preview-progress": `${previewProgress}%` } as CSSProperties}
              onPointerDown={() => {
                sliderDraft.current = previewPosition;
                sliderPointerDown.current = true;
                sliderInputActive.current = true;
                setSliderEditing(true);
              }}
              onFocus={() => {
                if (!sliderInputActive.current) sliderDraft.current = previewPosition;
              }}
              onPointerUp={() => {
                sliderPointerDown.current = false;
                commitSeek(sliderDraft.current);
              }}
              onPointerCancel={() => {
                sliderPointerDown.current = false;
                commitSeek(sliderDraft.current);
              }}
              onChange={(event) => updatePreviewSlider(Number(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitSeek(sliderDraft.current);
                }
              }}
              onBlur={() => {
                if (!sliderPointerDown.current && sliderInputActive.current) commitSeek(sliderDraft.current);
              }}
            />
            <div className="preview-time-scale"><span>{formatDuration(sourceIn)}</span><span>{formatDuration(sourceOut)}</span></div>
            <div className="preview-source-range">{formatDuration(previewPosition)} - {formatDuration(sourceOut)}</div>
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
          {previewStatusLabel && <div className="classic-progress-label" role="status">
            {previewStatusLabel}
          </div>}
          <fieldset>
            <legend>{t("手动校准")}</legend>
            <div className="classic-form-grid">
              <label htmlFor={`manual-bpm-${track.id}`}>BPM:</label>
              <input
                id={`manual-bpm-${track.id}`}
                type="number"
                min={40}
                max={240}
                placeholder={track.rawAnalysis?.rawBpm.toFixed(2)}
                value={manualBpmDraft}
                onChange={(event) => setEditDraft("manualBpm", event.target.value)}
                onBlur={commitManualBpm}
                onKeyDown={handleDraftKey}
              />
              <label htmlFor={`first-beat-${track.id}`}>{t("首拍(秒):")}</label>
              <input
                id={`first-beat-${track.id}`}
                type="number"
                min={0}
                max={track.durationSeconds}
                step={0.01}
                placeholder={t("自动检测")}
                value={track.edit.manualFirstBeat ?? ""}
                onChange={(event) => changeFirstBeat(event.target.value)}
              />
              <label htmlFor={`phase-${track.id}`}>{t("相位:")}</label>
              <select
                id={`phase-${track.id}`}
                value={track.edit.phaseNudgeBeats}
                onChange={(event) => changePhaseNudge(Number(event.target.value) as -0.5 | 0 | 0.5)}
              >
                <option value={-0.5}>{t("提前半拍")}</option>
                <option value={0}>{t("自动")}</option>
                <option value={0.5}>{t("延后半拍")}</option>
              </select>
            </div>
            <p className="preview-calibration-hint">{t("试听中修改首拍或相位，会从下一个节拍开始生效。")}</p>
          </fieldset>
          <fieldset>
            <legend>{t("裁剪")}</legend>
            <div className="classic-form-grid">
              <label htmlFor={`trim-in-${track.id}`}>{t("入点(秒):")}</label>
              <input
                id={`trim-in-${track.id}`}
                type="number"
                min={0}
                max={track.edit.sourceOutSeconds}
                step={0.1}
                value={sourceInDraft}
                onChange={(event) => setEditDraft("sourceIn", event.target.value)}
                onBlur={commitSourceIn}
                onKeyDown={handleDraftKey}
              />
              <label htmlFor={`trim-out-${track.id}`}>{t("出点(秒):")}</label>
              <input
                id={`trim-out-${track.id}`}
                type="number"
                min={track.edit.sourceInSeconds}
                max={track.durationSeconds}
                step={0.1}
                value={sourceOutDraft}
                onChange={(event) => setEditDraft("sourceOut", event.target.value)}
                onBlur={commitSourceOut}
                onKeyDown={handleDraftKey}
              />
            </div>
            <p className="preview-calibration-hint">{t("修改 BPM 或裁剪后，需重新开始试听。")}</p>
          </fieldset>
        </div>}
      </div>
    </aside>
  );
}
