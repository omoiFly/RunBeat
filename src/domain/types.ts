export const PROJECT_SCHEMA_VERSION = 1 as const;

export type TrackStatus =
  | "queued"
  | "decoding"
  | "analyzing-bpm"
  | "analyzing-beats"
  | "complete"
  | "failed"
  | "missing";

export type Quality = "excellent" | "good" | "acceptable" | "not-recommended" | "needs-calibration";
export const QUALITY_ORDER: Quality[] = ["excellent", "good", "acceptable", "not-recommended", "needs-calibration"];
export const QUALITY_LABELS: Record<Quality, string> = {
  excellent: "优秀",
  good: "良好",
  acceptable: "可接受",
  "not-recommended": "不推荐",
  "needs-calibration": "需校准"
};
export type MappingMode = "auto" | "one-step-per-beat" | "two-steps-per-beat";
export type InclusionMode = "auto" | "include" | "exclude";
export type AudioExportFormat = "mp3" | "wav";
export type Mp3BitrateKbps = 128 | 192 | 256 | 320;
export type ProjectNameMode = "auto" | "custom";

export const DEFAULT_PROJECT_NAME = "未命名项目";
export const MIN_TARGET_SPM = 60;
export const MAX_TARGET_SPM = 230;
export const MIN_BEAT_TRACK_GAIN_DB = -40;
export const MAX_BEAT_TRACK_GAIN_DB = 10;
export const DEFAULT_BEAT_TRACK_GAIN_DB = -10;

export function clampTargetSpm(targetSpm: number): number {
  return Math.max(MIN_TARGET_SPM, Math.min(MAX_TARGET_SPM, Math.round(targetSpm)));
}

export interface TrackSourceRef {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  lastModified: number;
  handleKey?: string;
  available: boolean;
}

export interface RawTrackAnalysis {
  rawBpm: number;
  rhythmBpm?: number;
  beatTicks: number[];
  bpmConfidence?: number;
  bpmIntervals: number[];
  windowBpms: number[];
  bpmStdDev?: number;
  maxBpmDrift?: number;
  waveformPeaks: number[];
  analyzedAt: number;
}

export interface DerivedTrackAnalysis {
  normalizedBpm: number;
  detectorOctaveFactor: 0.5 | 1 | 2 | 4;
  stepsPerBeat: 1 | 2;
  effectiveFactor: number;
  targetSpm: number;
  tempoRatio: number;
  timeRatio: number;
  tempoChangePercent: number;
  bpmAgreement?: number;
  /** Automatically fitted phase before any manual first-beat override, in processed-audio seconds. */
  automaticPhaseOffsetSeconds?: number;
  phaseOffsetSeconds?: number;
  /** The model that supplied the phase used by preview and export. */
  phaseAlignmentModel?: "global-bpm" | "beat-refined" | "manual";
  /** Confidence in the phase lock, independent of global BPM confidence. */
  phaseConfidence?: number;
  /** Share of detected ticks within 12% of one target-grid interval. */
  phaseCoverage?: number;
  phaseMedianErrorMs?: number;
  /** Relative BPM correction selected from stable beat-tick windows. */
  bpmRefinementPercent?: number;
  quality: Quality;
  /** The three independent inputs whose worst level becomes the overall quality. */
  qualityFactors?: {
    tempoChange: Quality;
    bpmConfidence: Quality;
    phaseAlignment: Quality;
  };
  warnings: string[];
}

export interface TrackEdit {
  /** 最终导出选择。存在时不再受项目变速阈值动态影响。 */
  exportEnabled?: boolean;
  /** 旧项目兼容字段；新写入的数据应使用 exportEnabled。 */
  inclusionMode?: InclusionMode;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  manualBpm?: number;
  mappingMode?: MappingMode;
  manualFirstBeat?: number;
  phaseNudgeBeats: -0.5 | 0 | 0.5;
}

export interface Track {
  id: string;
  source: TrackSourceRef;
  durationSeconds: number;
  status: TrackStatus;
  error?: string;
  rawAnalysis?: RawTrackAnalysis;
  derivedAnalysis?: DerivedTrackAnalysis;
  edit: TrackEdit;
  order: number;
}

export interface CustomBeatSampleRef {
  fileName: string;
  fileSize: number;
  mimeType: string;
  lastModified: number;
  durationSeconds: number;
  available: boolean;
}

export interface BeatTrackSettings {
  sound: "soft-footstep" | "track-footstep" | "kick" | "wood" | "click" | "custom";
  customSample?: CustomBeatSampleRef;
  gainDb: number;
  accentEvery: 0 | 4 | 8 | 16;
  alternateFeet: boolean;
  duckingEnabled: boolean;
}

export interface ExportSettings {
  mode: "continuous" | "separate";
  includeBeat: boolean;
  format: AudioExportFormat;
  mp3BitrateKbps: Mp3BitrateKbps;
  includeTimeline: boolean;
  loudnessLufs: -16 | -14 | -12;
  normalizeLoudness: boolean;
  sampleRate: 44100;
  bitDepth: 16;
}

export interface ProjectV1 {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  name: string;
  /** Optional for backward compatibility with projects saved before automatic naming. */
  nameMode?: ProjectNameMode;
  createdAt: number;
  updatedAt: number;
  targetSpm: number;
  mappingMode: MappingMode;
  /** Preset key for the direction-aware tempo range; speed-up limits are intentionally wider. */
  maxTempoChangePercent: 4 | 6 | 10 | 15 | 20 | 100;
  pitchPreservation: true;
  transitionBars: 8;
  tracks: Track[];
  beatTrack: BeatTrackSettings;
  exportSettings: ExportSettings;
}

export interface RenderProgress {
  jobId: string;
  stage: "prepare" | "stretch" | "beat" | "mix" | "normalize" | "encode" | "qa";
  progress: number;
  trackId?: string;
  message: string;
}

export function createProject(name?: string): ProjectV1 {
  const now = Date.now();
  const normalizedName = name?.trim();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name: normalizedName || DEFAULT_PROJECT_NAME,
    nameMode: normalizedName ? "custom" : "auto",
    createdAt: now,
    updatedAt: now,
    targetSpm: 180,
    mappingMode: "auto",
    maxTempoChangePercent: 20,
    pitchPreservation: true,
    transitionBars: 8,
    tracks: [],
    beatTrack: {
      sound: "wood",
      gainDb: DEFAULT_BEAT_TRACK_GAIN_DB,
      accentEvery: 0,
      alternateFeet: true,
      duckingEnabled: false
    },
    exportSettings: {
      mode: "continuous",
      includeBeat: true,
      format: "mp3",
      mp3BitrateKbps: 192,
      includeTimeline: true,
      loudnessLufs: -14,
      normalizeLoudness: true,
      sampleRate: 44100,
      bitDepth: 16
    }
  };
}
