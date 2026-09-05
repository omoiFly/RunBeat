import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  clampTargetSpm,
  MAX_BEAT_TRACK_GAIN_DB,
  MAX_TARGET_SPM,
  MIN_BEAT_TRACK_GAIN_DB,
  MIN_TARGET_SPM,
  type BeatTrackSettings,
  type MappingMode,
  type ProjectV1
} from "../../domain/types";
import type { BeatSample } from "../../audio/beatTrack";
import { useI18n } from "../../i18n";
import { loadCustomBeatSample } from "../../services/customBeat";
import { beatSampleReference } from "../../services/beatLibrary";
import { releaseBeatResources, retainBeatResources } from "../../services/beatResourceLocks";
import { useBeatLibrary } from "../../services/useBeatLibrary";
import { BEAT_PREVIEW_SECONDS, playBeatPreview, stopPreview } from "../../services/preview";
import { ClassicIcon } from "../ClassicIcon";

export interface ProjectPropertiesDraft {
  name: string;
  targetSpm: number;
  mappingMode: MappingMode;
  maxTempoChangePercent: ProjectV1["maxTempoChangePercent"];
  beatTrack: BeatTrackSettings;
}

type PropertiesTab = "general" | "beat";

const TABS: Array<{ id: PropertiesTab; label: string }> = [
  { id: "general", label: "常规" },
  { id: "beat", label: "节拍轨" }
];

const BEAT_LABELS: Record<BeatTrackSettings["sound"], string> = {
  "soft-footstep": "柔和脚步",
  "track-footstep": "跑道脚步",
  kick: "低频鼓点",
  wood: "木质打击",
  click: "电子 Click",
  custom: "自定义鼓点"
};

function draftFromProject(project: ProjectV1): ProjectPropertiesDraft {
  return {
    name: project.name,
    targetSpm: project.targetSpm,
    mappingMode: project.mappingMode,
    maxTempoChangePercent: project.maxTempoChangePercent,
    beatTrack: structuredClone(project.beatTrack)
  };
}

function reportError(error: unknown): void {
  window.dispatchEvent(new CustomEvent("runbeat:error", {
    detail: error instanceof Error ? error.message : String(error)
  }));
}

export function ProjectPropertiesDialog({ open, project, onApply, onClose }: {
  open: boolean;
  project: ProjectV1;
  onApply: (draft: ProjectPropertiesDraft) => Promise<void> | void;
  onClose: () => void;
}) {
  const { t, translateMessage } = useI18n();
  const library = useBeatLibrary();
  const [tab, setTab] = useState<PropertiesTab>("general");
  const [draft, setDraft] = useState<ProjectPropertiesDraft>(() => draftFromProject(project));
  const [targetSpmInput, setTargetSpmInput] = useState(() => String(project.targetSpm));
  const [sampleState, setSampleState] = useState<{ resourceId: string; sample?: BeatSample; error?: string }>();
  const [applying, setApplying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const previewRequest = useRef(0);
  const sampleOwner = useRef({});
  const customResourceId = draft.beatTrack.sound === "custom" ? draft.beatTrack.customSample?.resourceId : undefined;
  const customBeatName = library.items.find((item) => item.resourceId === customResourceId)?.name ?? draft.beatTrack.customSample?.fileName;
  const customBeatSample = customResourceId && sampleState?.resourceId === customResourceId ? sampleState.sample : undefined;
  const parsedTargetSpm = Number(targetSpmInput);
  const normalizedTargetSpm = targetSpmInput.trim() && Number.isFinite(parsedTargetSpm)
    ? clampTargetSpm(parsedTargetSpm)
    : draft.targetSpm;
  const draftProject = useMemo<ProjectV1>(() => ({
    ...project,
    name: draft.name,
    targetSpm: normalizedTargetSpm,
    mappingMode: draft.mappingMode,
    maxTempoChangePercent: draft.maxTempoChangePercent,
    beatTrack: draft.beatTrack
  }), [draft, normalizedTargetSpm, project]);
  const customBeatUnavailable = draft.beatTrack.sound === "custom"
    && !customBeatSample;

  useEffect(() => {
    const owner = sampleOwner.current;
    let active = true;
    if (customResourceId) {
      void retainBeatResources(owner, [customResourceId]).then(async () => {
        if (!active) return;
        const sample = await loadCustomBeatSample(customResourceId);
        if (active) setSampleState({ resourceId: customResourceId, sample, error: sample ? undefined : "鼓点已被删除，请重新选择。" });
      }).catch((error) => {
        if (active) setSampleState({ resourceId: customResourceId, error: error instanceof Error ? error.message : String(error) });
      });
    }
    return () => { active = false; releaseBeatResources(owner); };
  }, [customResourceId]);

  useEffect(() => () => {
    previewRequest.current += 1;
    stopPreview();
  }, [project.id]);

  const updateBeat = (patch: Partial<BeatTrackSettings>) => {
    previewRequest.current += 1;
    stopPreview();
    setPreviewing(false);
    if ("sound" in patch && (patch.sound !== draft.beatTrack.sound || patch.customSample?.resourceId !== draft.beatTrack.customSample?.resourceId)) setSampleState(undefined);
    setDraft((current) => ({ ...current, beatTrack: { ...current.beatTrack, ...patch } }));
  };

  const commitTargetSpm = () => {
    setTargetSpmInput(String(normalizedTargetSpm));
    setDraft((current) => current.targetSpm === normalizedTargetSpm
      ? current
      : { ...current, targetSpm: normalizedTargetSpm });
  };

  const apply = async (): Promise<boolean> => {
    if (!draft.name.trim()) {
      setTab("general");
      window.requestAnimationFrame(() => document.getElementById("project-property-name")?.focus());
      return false;
    }
    if (customBeatUnavailable) return false;
    setApplying(true);
    try {
      const nextDraft = { ...draft, name: draft.name.trim(), targetSpm: normalizedTargetSpm };
      setDraft(nextDraft);
      setTargetSpmInput(String(normalizedTargetSpm));
      await onApply(nextDraft);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    } finally {
      setApplying(false);
    }
  };

  const togglePreview = async () => {
    if (previewing) {
      previewRequest.current += 1;
      stopPreview();
      setPreviewing(false);
      return;
    }
    const id = ++previewRequest.current;
    setPreviewing(true);
    try {
      await playBeatPreview(draftProject, customBeatSample);
    } catch (error) {
      if (previewRequest.current === id) setPreviewing(false);
      reportError(error);
      return;
    }
    window.setTimeout(() => {
      if (previewRequest.current === id) setPreviewing(false);
    }, BEAT_PREVIEW_SECONDS * 1_000);
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, current: PropertiesTab) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex((item) => item.id === current);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? TABS.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    const next = TABS[nextIndex];
    setTab(next.id);
    window.requestAnimationFrame(() => document.getElementById(`project-property-tab-${next.id}`)?.focus());
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !applying) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-input-shield" />
        <Dialog.Content className="property-dialog window" onEscapeKeyDown={(event) => { if (applying) event.preventDefault(); }}>
          <div className="title-bar">
            <Dialog.Title className="title-bar-text">{t("项目属性")}</Dialog.Title>
            <div className="title-bar-controls">
              <button type="button" aria-label={t("这是什么？")} title={t("这是什么？")} onClick={() => window.dispatchEvent(new CustomEvent("runbeat:help-mode"))}>?</button>
              <Dialog.Close asChild><button className="close" type="button" aria-label={t("关闭")} disabled={applying} /></Dialog.Close>
            </div>
          </div>

          <div className="property-dialog-body">
            <div className="property-tabs dialog-tabs" role="tablist" aria-label={t("项目属性页")}>
              {TABS.map((item) => <button
                key={item.id}
                id={`project-property-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => handleTabKey(event, item.id)}
              >{t(item.label)}</button>)}
            </div>

            <div className="property-sheet-page">
              {tab === "general" && <>
                <fieldset disabled={applying}>
                  <legend>{t("项目")}</legend>
                  <div className="classic-form-grid project-general-grid">
                    <label htmlFor="project-property-name">{t("名称:")}</label>
                    <input
                      id="project-property-name"
                      data-help="project-name"
                      value={draft.name}
                      maxLength={80}
                      spellCheck={false}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    />
                  </div>
                </fieldset>

                <fieldset disabled={applying}>
                  <legend>{t("将歌曲匹配到目标步频")}</legend>
                  <div className="classic-form-grid">
                    <label htmlFor="project-property-spm">{t("目标步频:")}</label>
                    <div className="spin-field">
                      <input
                        id="project-property-spm"
                        data-help="target-spm"
                        type="number"
                        min={MIN_TARGET_SPM}
                        max={MAX_TARGET_SPM}
                        step={1}
                        value={targetSpmInput}
                        onChange={(event) => setTargetSpmInput(event.target.value)}
                        onBlur={commitTargetSpm}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitTargetSpm();
                        }}
                      />
                      <span>SPM</span>
                    </div>
                    <label htmlFor="project-property-mapping">{t("步频映射:")}</label>
                    <select
                      id="project-property-mapping"
                      data-help="mapping-mode"
                      value={draft.mappingMode}
                      onChange={(event) => setDraft((current) => ({ ...current, mappingMode: event.target.value as MappingMode }))}
                    >
                      <option value="auto">{t("自动判断")}</option>
                      <option value="one-step-per-beat">{t("一拍一步")}</option>
                      <option value="two-steps-per-beat">{t("一拍两步")}</option>
                    </select>
                  </div>
                </fieldset>

                <fieldset disabled={applying}>
                  <legend>{t("设置新歌曲的自动匹配规则")}</legend>
                  <div className="classic-radio-list" data-help="selection-range">
                    {([
                      [4, "严格 (-4% / +6%)"],
                      [6, "自然 (-6% / +10%)"],
                      [10, "宽松 (-10% / +15%)"],
                      [15, "良好 (-15% / +20%)"],
                      [20, "可接受 (-20% / +30%)"],
                      [100, "不限"]
                    ] as const).map(([value, label]) => <div className="field-row" key={value}>
                      <input
                        id={`project-property-range-${value}`}
                        name="project-property-range"
                        type="radio"
                        checked={draft.maxTempoChangePercent === value}
                        onChange={() => setDraft((current) => ({ ...current, maxTempoChangePercent: value }))}
                      />
                      <label htmlFor={`project-property-range-${value}`}>{t(label)}</label>
                    </div>)}
                  </div>
                </fieldset>
              </>}

              {tab === "beat" && <>
                <fieldset disabled={applying}>
                  <legend>{t("选择并试听全局节拍轨")}</legend>
                  <div className="classic-form-grid">
                    <label htmlFor="project-property-beat">{t("声音:")}</label>
                    <select
                      id="project-property-beat"
                      data-help="beat-sound"
                      disabled={applying}
                      value={draft.beatTrack.sound === "custom" ? `custom:${draft.beatTrack.customSample?.resourceId ?? "missing"}` : draft.beatTrack.sound}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value.startsWith("custom:")) {
                          const item = library.items.find((entry) => entry.resourceId === value.slice(7));
                          if (item) updateBeat({ sound: "custom", customSample: beatSampleReference(item) });
                        } else updateBeat({ sound: value as BeatTrackSettings["sound"], customSample: undefined });
                      }}
                    >
                      <optgroup label={t("内置鼓点")}>
                        {Object.entries(BEAT_LABELS).filter(([value]) => value !== "custom").map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
                      </optgroup>
                      <optgroup label={t("鼓点库")}>
                        {library.items.map((item) => <option key={item.resourceId} value={`custom:${item.resourceId}`}>{item.name}</option>)}
                      </optgroup>
                      {draft.beatTrack.sound === "custom" && !library.items.some((item) => item.resourceId === customResourceId) && <option value={`custom:${customResourceId ?? "missing"}`} disabled>{draft.beatTrack.customSample?.fileName ?? t("自定义鼓点")} ({library.loading ? t("正在加载...") : t("不可用")})</option>}
                    </select>
                    <span />
                    <div className="custom-beat-field">
                      <button type="button" disabled={applying} onClick={() => { stopPreview(); setPreviewing(false); window.dispatchEvent(new Event("runbeat:open-beat-library")); }}>{t("打开鼓点库")}</button>
                      {!library.items.length && !library.loading && <span>{t("可在鼓点库上传自己的鼓点。")}</span>}
                    </div>
                    <label htmlFor="project-property-gain">{t("相对音量:")}</label>
                    <div className="range-with-value">
                      <input
                        id="project-property-gain"
                        data-help="beat-volume"
                        type="range"
                        min={MIN_BEAT_TRACK_GAIN_DB}
                        max={MAX_BEAT_TRACK_GAIN_DB}
                        step={1}
                        value={draft.beatTrack.gainDb}
                        onChange={(event) => updateBeat({ gainDb: Number(event.target.value) })}
                      />
                      <span>{draft.beatTrack.gainDb > 0 ? "+" : ""}{draft.beatTrack.gainDb} dB</span>
                    </div>
                    <label htmlFor="project-property-accent">{t("重拍:")}</label>
                    <select
                      id="project-property-accent"
                      data-help="beat-accent"
                      value={draft.beatTrack.accentEvery}
                      onChange={(event) => updateBeat({ accentEvery: Number(event.target.value) as 0 | 4 | 8 | 16 })}
                    >
                      <option value={0}>{t("无重拍")}</option>
                      <option value={4}>{t("每 {count} 步", { count: 4 })}</option>
                      <option value={8}>{t("每 {count} 步", { count: 8 })}</option>
                      <option value={16}>{t("每 {count} 步", { count: 16 })}</option>
                    </select>
                  </div>
                  <div className="field-row beat-checkbox">
                    <input
                      id="project-property-alternate"
                      data-help="alternate-feet"
                      type="checkbox"
                      checked={draft.beatTrack.alternateFeet}
                      onChange={(event) => updateBeat({ alternateFeet: event.target.checked })}
                    />
                    <label htmlFor="project-property-alternate">{t("左右脚声道交替")}</label>
                  </div>
                  <div className="beat-preview-command">
                    <button type="button" disabled={applying || customBeatUnavailable} onClick={() => void togglePreview()}>
                      <ClassicIcon name={previewing ? "stop" : "play"} />
                      {previewing ? t("停止") : t("试听")}
                    </button>
                    <span>{draft.beatTrack.sound === "custom" ? customBeatName : t(BEAT_LABELS[draft.beatTrack.sound])} · {normalizedTargetSpm} SPM</span>
                  </div>
                  {(library.error || (sampleState?.resourceId === customResourceId && sampleState?.error)) && <p role="alert">{translateMessage(library.error ?? sampleState?.error)}</p>}
                </fieldset>
              </>}
            </div>
          </div>

          <div className="dialog-command-row">
            <button className="default" type="button" disabled={applying || customBeatUnavailable} onClick={() => void apply().then((applied) => { if (applied) onClose(); })}>{t("确定")}</button>
            <button type="button" disabled={applying} onClick={onClose}>{t("取消")}</button>
            <button type="button" disabled={applying || customBeatUnavailable} onClick={() => void apply()}>{t("应用")}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
