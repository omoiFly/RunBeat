import type { TimelineGeometry } from "../audio/mixer";
import { QUALITY_LABELS, type Quality, type Track } from "../domain/types";
import type { AppLanguage } from "../i18n";

export interface ProjectTimelineItem {
  index: number;
  trackId: string;
  title: string;
  transitionStartSeconds: number;
  startSeconds: number;
  endSeconds: number;
  rawBpm?: number;
  mappedBpm?: number;
  tempoChangePercent?: number;
  quality?: Quality;
}

export interface ProjectTimeline {
  targetSpm: number;
  durationSeconds: number;
  items: ProjectTimelineItem[];
}

interface TimelineCopy {
  totalDuration: string;
  csvHeaders: readonly string[];
  qualityLabels: Record<Quality, string>;
}

const TIMELINE_COPY = {
  "zh-CN": {
    totalDuration: "总时长",
    csvHeaders: ["序号", "过渡开始", "歌曲开始", "歌曲结束", "歌曲", "原始 BPM", "映射 BPM", "变速百分比", "综合质量"],
    qualityLabels: QUALITY_LABELS
  },
  en: {
    totalDuration: "Total duration",
    csvHeaders: ["Index", "Transition Start", "Track Start", "Track End", "Track", "Original BPM", "Mapped BPM", "Tempo Change (%)", "Overall Quality"],
    qualityLabels: {
      excellent: "Excellent",
      good: "Good",
      acceptable: "Acceptable",
      "not-recommended": "Not recommended",
      "needs-calibration": "Needs calibration"
    }
  }
} satisfies Record<AppLanguage, TimelineCopy>;

function trackTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function createProjectTimeline(
  tracks: Track[],
  plan: TimelineGeometry,
  sampleRate: number,
  targetSpm: number
): ProjectTimeline {
  return {
    targetSpm,
    durationSeconds: plan.durationFrames / sampleRate,
    items: plan.entries.map((entry, index) => {
      const track = tracks[entry.trackIndex];
      return {
        index: index + 1,
        trackId: track.id,
        title: trackTitle(track.source.fileName),
        transitionStartSeconds: entry.startFrames / sampleRate,
        startSeconds: entry.audibleStartFrames / sampleRate,
        endSeconds: entry.endFrames / sampleRate,
        rawBpm: track.rawAnalysis?.rawBpm,
        mappedBpm: track.derivedAnalysis?.normalizedBpm,
        tempoChangePercent: track.derivedAnalysis?.tempoChangePercent,
        quality: track.derivedAnalysis?.quality
      };
    })
  };
}

export function formatTimelineTimestamp(seconds: number, milliseconds = false): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1_000));
  const totalSeconds = Math.floor(totalMilliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const wholeSeconds = totalSeconds % 60;
  const base = [hours, minutes, wholeSeconds].map((value) => String(value).padStart(2, "0")).join(":");
  return milliseconds ? `${base}.${String(totalMilliseconds % 1_000).padStart(3, "0")}` : base;
}

function csvCell(value: string | number | undefined): string {
  if (value == null) return "";
  const text = String(value);
  const safe = /^[=+@]/.test(text) || text.startsWith("-") && !/^-\d/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function timelineAsText(timeline: ProjectTimeline, language: AppLanguage): string {
  const copy = TIMELINE_COPY[language];
  const rows = timeline.items.map((item) => `${String(item.index).padStart(2, "0")}  ${formatTimelineTimestamp(item.startSeconds)}  ${item.title}`);
  return [`RunBeat ${timeline.targetSpm} SPM`, `${copy.totalDuration} ${formatTimelineTimestamp(timeline.durationSeconds)}`, "", ...rows, ""].join("\n");
}

export function timelineAsCsv(timeline: ProjectTimeline, language: AppLanguage): string {
  const copy = TIMELINE_COPY[language];
  const rows = timeline.items.map((item) => [
    item.index,
    formatTimelineTimestamp(item.transitionStartSeconds, true),
    formatTimelineTimestamp(item.startSeconds, true),
    formatTimelineTimestamp(item.endSeconds, true),
    item.title,
    item.rawBpm?.toFixed(2),
    item.mappedBpm?.toFixed(2),
    item.tempoChangePercent?.toFixed(2),
    item.quality ? copy.qualityLabels[item.quality] : ""
  ].map(csvCell).join(","));
  return [copy.csvHeaders.map(csvCell).join(","), ...rows, ""].join("\r\n");
}
