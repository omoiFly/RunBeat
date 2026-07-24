import { IntegratedLoudnessMeter, TRUE_PEAK_CEILING_DBTP, TruePeakMeter } from "../audio/loudness";
import { mixPlannedTimeline, mixTimeline, planTimeline, type MixOptions, type RenderableTrack, type TimelineGeometry } from "../audio/mixer";
import { streamPlannedTimeline } from "../audio/streamingMixer";
import { encodeWav16, Wav16BlobEncoder } from "../audio/wav";
import type { ProjectV1, RenderProgress, Track } from "../domain/types";
import type { AppLanguage } from "../i18n";
import { decodeFile } from "./audio";
import { getCustomBeatSample } from "./customBeat";
import { getRegisteredFile } from "./files";
import { createRenderWorkerPool, prepareTrackClip, type AudioStretcher } from "./renderAudio";
import { maximumInMemoryRenderBytes, recommendedRenderConcurrency } from "./clientPerformance";
import { resolveExportEnabled } from "./exportSelection";
import { exportBaseName } from "./exportNaming";
import { estimatedTrackGeometry, estimateProjectDuration, projectTimelineGeometry } from "./renderEstimate";
import { StreamingZipBuilder } from "./streamingZip";
import { createProjectTimeline, timelineAsCsv, timelineAsText, type ProjectTimeline } from "./timeline";

export interface RenderResult {
  blob: Blob;
  fileName: string;
  durationSeconds: number;
  timeline?: ProjectTimeline;
}

export interface RenderOptions {
  signal?: AbortSignal;
  language?: AppLanguage;
}

function outputFormat(project: ProjectV1): "mp3" | "wav" {
  return project.exportSettings.format ?? "mp3";
}

async function encodeOutput(
  wav: Blob,
  project: ProjectV1,
  signal: AbortSignal | undefined,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  if (outputFormat(project) === "wav") {
    onProgress?.(1);
    return wav;
  }
  const { encodeMp3 } = await import("./ffmpeg");
  return encodeMp3(wav, {
    bitrateKbps: project.exportSettings.mp3BitrateKbps ?? 192,
    signal,
    onProgress
  });
}

export function isTrackIncluded(track: Track, project: ProjectV1): boolean {
  return track.status === "complete"
    && track.derivedAnalysis !== undefined
    && resolveExportEnabled(track, project.maxTempoChangePercent);
}

async function prepareTracksForRender(
  tracks: Track[],
  project: ProjectV1,
  estimatedWorkingBytes: number,
  jobId: string,
  onProgress: (progress: RenderProgress) => void,
  signal?: AbortSignal
): Promise<{ track: Track; audio: RenderableTrack }[]> {
  if (!tracks.length) return [];
  const concurrency = recommendedRenderConcurrency(tracks.length, estimatedWorkingBytes);
  const workerPool = createRenderWorkerPool(concurrency, signal);
  const rendered = new Array<{ track: Track; audio: RenderableTrack }>(tracks.length);
  const credits = new Array<number>(tracks.length).fill(0);
  let nextIndex = 0;

  const report = (index: number, stage: "prepare" | "stretch", message: string) => {
    const completedWork = credits.reduce((sum, value) => sum + value, 0);
    onProgress({
      jobId,
      stage,
      progress: 0.8 * completedWork / tracks.length,
      trackId: tracks[index].id,
      message
    });
  };

  const run = async () => {
    while (nextIndex < tracks.length) {
      const index = nextIndex;
      nextIndex += 1;
      if (signal?.aborted) throw new DOMException("渲染已取消", "AbortError");
      const track = tracks[index];
      const file = getRegisteredFile(track.id);
      if (!file) throw new Error(`${track.source.fileName} 需要重新关联原始文件`);
      credits[index] = 0.05;
      report(index, "prepare", `${concurrency > 1 ? `${concurrency} 路并行 · ` : ""}解码 ${track.source.fileName}`);
      const decoded = await decodeFile(file, { createMono: false });
      if (signal?.aborted) throw new DOMException("渲染已取消", "AbortError");
      credits[index] = 0.3;
      report(index, "stretch", `${concurrency > 1 ? `${concurrency} 路并行 · ` : ""}保持音高变速 ${track.source.fileName}`);
      const prepared = await prepareTrackClip(decoded, track, project, {
        startSeconds: track.edit.sourceInSeconds,
        endSeconds: track.edit.sourceOutSeconds
      }, workerPool.stretch);
      rendered[index] = { track, audio: prepared.audio };
      credits[index] = 1;
      report(index, "stretch", `已处理 ${credits.filter((value) => value === 1).length} / ${tracks.length} 首`);
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, () => run()));
    return rendered;
  } finally {
    workerPool.dispose();
  }
}

async function prepareOneTrack(
  track: Track,
  project: ProjectV1,
  stretch: AudioStretcher,
  signal?: AbortSignal
): Promise<RenderableTrack> {
  if (signal?.aborted) throw new DOMException("渲染已取消", "AbortError");
  const file = getRegisteredFile(track.id);
  if (!file) throw new Error(`${track.source.fileName} 需要重新关联原始文件`);
  const decoded = await decodeFile(file, { createMono: false });
  if (signal?.aborted) throw new DOMException("渲染已取消", "AbortError");
  const prepared = await prepareTrackClip(decoded, track, project, {
    startSeconds: track.edit.sourceInSeconds,
    endSeconds: track.edit.sourceOutSeconds
  }, stretch);
  return prepared.audio;
}

function mixOptionsFor(
  project: ProjectV1,
  customBeatSample: ReturnType<typeof getCustomBeatSample>,
  minimumDurationSeconds?: number
): MixOptions {
  return {
    sampleRate: project.exportSettings.sampleRate,
    targetSpm: project.targetSpm,
    transitionBars: project.transitionBars,
    beatTrack: project.beatTrack,
    customBeatSample,
    normalizeLoudness: project.exportSettings.normalizeLoudness,
    loudnessLufs: project.exportSettings.loudnessLufs,
    includeBeat: project.exportSettings.includeBeat !== false,
    minimumDurationSeconds
  };
}

function transparentNormalizationGain(project: ProjectV1, inputLufs: number, inputTruePeak: number): number {
  const requestedGain = project.exportSettings.normalizeLoudness && Number.isFinite(inputLufs)
    ? 10 ** ((project.exportSettings.loudnessLufs - inputLufs) / 20)
    : 1;
  const ceiling = 10 ** (TRUE_PEAK_CEILING_DBTP / 20);
  const peakGain = inputTruePeak > 0 ? ceiling / inputTruePeak * (1 - 1e-6) : requestedGain;
  return Math.min(requestedGain, peakGain);
}

async function addTimelineArchive(
  audio: Blob,
  audioName: string,
  timeline: ProjectTimeline,
  language: AppLanguage,
  signal?: AbortSignal
): Promise<Blob> {
  const zip = new StreamingZipBuilder();
  await zip.add(audioName, audio, signal);
  await zip.add(audioName.replace(/\.[^.]+$/, "_timeline.txt"), new Blob([timelineAsText(timeline, language)], { type: "text/plain;charset=utf-8" }), signal);
  await zip.add(audioName.replace(/\.[^.]+$/, "_timeline.csv"), new Blob([`\uFEFF${timelineAsCsv(timeline, language)}`], { type: "text/csv;charset=utf-8" }), signal);
  return zip.finish();
}

async function renderSeparateProject(
  tracks: Track[],
  project: ProjectV1,
  customBeatSample: ReturnType<typeof getCustomBeatSample>,
  jobId: string,
  onProgress: (progress: RenderProgress) => void,
  signal?: AbortSignal
): Promise<RenderResult> {
  const sampleRate = project.exportSettings.sampleRate;
  const largestTrackBytes = tracks.reduce((largest, track) => (
    Math.max(largest, estimatedTrackGeometry(track, project).frameCount * 2 * 4)
  ), 0);
  const concurrency = recommendedRenderConcurrency(tracks.length, largestTrackBytes);
  const workerPool = createRenderWorkerPool(concurrency, signal);
  const zip = new StreamingZipBuilder();
  const format = outputFormat(project);
  let durationSeconds = 0;
  try {
    for (let batchStart = 0; batchStart < tracks.length; batchStart += concurrency) {
      const batch = tracks.slice(batchStart, batchStart + concurrency);
      const preparedBatch = await Promise.all(batch.map(async (track, batchIndex) => {
        const index = batchStart + batchIndex;
        onProgress({
          jobId,
          stage: "prepare",
          progress: 0.9 * batchStart / Math.max(1, tracks.length),
          trackId: track.id,
          message: `${concurrency > 1 ? `${concurrency} 路并行 · ` : ""}处理 ${index + 1} / ${tracks.length} · ${track.source.fileName}`
        });
        return prepareOneTrack(track, project, workerPool.stretch, signal);
      }));
      for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
        const index = batchStart + batchIndex;
        const track = batch[batchIndex];
        const channels = mixTimeline([preparedBatch[batchIndex]], mixOptionsFor(project, customBeatSample));
        preparedBatch[batchIndex].channels.length = 0;
        durationSeconds += channels[0].length / sampleRate;
        const wav = encodeWav16({ channels, sampleRate });
        channels.length = 0;
        const encoded = await encodeOutput(wav, project, signal, (encodingProgress) => {
          onProgress({
            jobId,
            stage: "encode",
            progress: 0.9 * (index + encodingProgress) / Math.max(1, tracks.length),
            trackId: track.id,
            message: format === "mp3" ? `编码 MP3 ${index + 1} / ${tracks.length}` : `写入 WAV ${index + 1} / ${tracks.length}`
          });
        });
        const safeName = track.source.fileName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_");
        await zip.add(`${safeName}_${project.targetSpm}SPM.${format}`, encoded, signal);
      }
    }
    onProgress({ jobId, stage: "encode", progress: 0.98, message: `打包 ${tracks.length} 首 ${format.toUpperCase()}` });
    const blob = await zip.finish();
    onProgress({ jobId, stage: "qa", progress: 1, message: "完成" });
    return {
      blob,
      fileName: `${exportBaseName(project.name, project.targetSpm, durationSeconds)}.zip`,
      durationSeconds
    };
  } finally {
    workerPool.dispose();
  }
}

export async function renderChunkedContinuousWav(
  tracks: Track[],
  geometry: TimelineGeometry,
  project: ProjectV1,
  customBeatSample: ReturnType<typeof getCustomBeatSample>,
  jobId: string,
  onProgress: (progress: RenderProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const workerPool = tracks.length ? createRenderWorkerPool(1, signal) : undefined;
  const options = mixOptionsFor(project, customBeatSample, geometry.durationFrames / project.exportSettings.sampleRate);
  const reportPassProgress = (base: number, span: number, stage: "normalize" | "mix", message: string, completedFrame: number) => {
    onProgress({
      jobId,
      stage,
      progress: base + span * Math.min(1, completedFrame / Math.max(1, geometry.durationFrames)),
      message
    });
  };
  const loader = (pass: 1 | 2): ((trackIndex: number) => Promise<RenderableTrack>) => async (trackIndex) => {
    const track = tracks[trackIndex];
    const entryStart = geometry.entries[trackIndex]?.startFrames ?? 0;
    const passBase = pass === 1 ? 0 : 0.42;
    onProgress({
      jobId,
      stage: pass === 1 ? "normalize" : "stretch",
      progress: passBase + 0.4 * entryStart / Math.max(1, geometry.durationFrames),
      trackId: track.id,
      message: `${pass === 1 ? "响度预扫描" : "低内存渲染"} ${trackIndex + 1} / ${tracks.length} · ${track.source.fileName}`
    });
    if (!workerPool) throw new Error("渲染工作线程不可用");
    return prepareOneTrack(track, project, workerPool.stretch, signal);
  };

  try {
    const wav = new Wav16BlobEncoder(geometry.durationFrames, 2, project.exportSettings.sampleRate);
    const loudness = new IntegratedLoudnessMeter(project.exportSettings.sampleRate);
    const truePeak = new TruePeakMeter();
    await streamPlannedTimeline(geometry, loader(1), options, (channels, startFrame) => {
      loudness.push(channels);
      truePeak.push(channels);
      reportPassProgress(0, 0.4, "normalize", "第一遍：测量整条时间线响度与真峰值", startFrame + channels[0].length);
    }, signal);
    const inputLufs = loudness.value();
    const inputTruePeak = truePeak.value();
    const gain = transparentNormalizationGain(project, inputLufs, inputTruePeak);
    const gainDb = 20 * Math.log10(gain);
    onProgress({
      jobId,
      stage: "normalize",
      progress: 0.42,
      message: `响度测量完成${Number.isFinite(inputLufs) ? ` · ${inputLufs.toFixed(1)} LUFS` : ""}${Number.isFinite(gainDb) ? ` · ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB` : ""}`
    });

    await streamPlannedTimeline(geometry, loader(2), options, (channels, startFrame) => {
      wav.push(channels, gain);
      reportPassProgress(0.42, 0.4, "mix", "第二遍：分块混音并写入 WAV", startFrame + channels[0].length);
    }, signal);
    return wav.finish();
  } finally {
    workerPool?.dispose();
  }
}

export async function renderProject(
  project: ProjectV1,
  onProgress: (progress: RenderProgress) => void,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const { signal, language = "zh-CN" } = options;
  const jobId = crypto.randomUUID();
  const includeBeat = project.exportSettings.includeBeat !== false;
  const customBeatSample = includeBeat && project.beatTrack.sound === "custom" ? getCustomBeatSample(project.id) : undefined;
  if (includeBeat && project.beatTrack.sound === "custom" && !customBeatSample) {
    throw new Error("自定义鼓点文件不可用，请在项目设置中重新上传");
  }
  const selected = project.tracks.filter((track) => resolveExportEnabled(track, project.maxTempoChangePercent));
  if (!selected.length) throw new Error("没有勾选可导出的歌曲");
  const unavailable = selected.find((track) => track.status === "missing" || !track.source.available);
  if (unavailable) throw new Error(`${unavailable.source.fileName} 需要重新关联原始文件`);
  const unfinished = selected.find((track) => track.status !== "complete" || !track.derivedAnalysis);
  if (unfinished) {
    const reason = unfinished.status === "failed" ? "分析失败" : "尚未完成分析";
    throw new Error(`${unfinished.source.fileName} ${reason}，请取消勾选或重新分析`);
  }
  const tracks = selected.sort((a, b) => a.order - b.order);
  const estimatedDuration = estimateProjectDuration(project);
  const estimatedWorkingBytes = estimatedDuration * project.exportSettings.sampleRate * 2 * 4;
  if (project.exportSettings.mode === "separate") {
    return renderSeparateProject(tracks, project, customBeatSample, jobId, onProgress, signal);
  }

  const mixOptions = mixOptionsFor(project, customBeatSample);
  const useChunkedPipeline = estimatedWorkingBytes > maximumInMemoryRenderBytes();
  let durationSeconds: number;
  let timeline: ProjectTimeline | undefined;
  let wav: Blob;

  if (useChunkedPipeline) {
    const geometry = projectTimelineGeometry(tracks, project);
    durationSeconds = geometry.durationFrames / project.exportSettings.sampleRate;
    timeline = createProjectTimeline(tracks, geometry, project.exportSettings.sampleRate, project.targetSpm);
    onProgress({ jobId, stage: "prepare", progress: 0, message: "启用低内存分块导出" });
    wav = await renderChunkedContinuousWav(tracks, geometry, project, customBeatSample, jobId, onProgress, signal);
  } else {
    const rendered = await prepareTracksForRender(tracks, project, estimatedWorkingBytes, jobId, onProgress, signal);
    onProgress({ jobId, stage: "mix", progress: 0.82, message: includeBeat ? "混合时间线和固定节拍" : "混合时间线" });
    const plan = planTimeline(rendered.map((item) => item.audio), mixOptions);
    durationSeconds = plan.durationFrames / project.exportSettings.sampleRate;
    timeline = createProjectTimeline(rendered.map((item) => item.track), plan, project.exportSettings.sampleRate, project.targetSpm);
    rendered.length = 0;
    const mixed = mixPlannedTimeline(plan, mixOptions);
    plan.aligned.length = 0;
    wav = encodeWav16({ channels: mixed, sampleRate: project.exportSettings.sampleRate });
    mixed.length = 0;
  }

  const format = outputFormat(project);
  const encodeStart = useChunkedPipeline ? 0.84 : 0.94;
  onProgress({ jobId, stage: "encode", progress: encodeStart, message: format === "mp3" ? "加载 FFmpeg 并编码 MP3" : "完成 WAV 文件" });
  const audio = await encodeOutput(wav, project, signal, (encodingProgress) => {
    onProgress({
      jobId,
      stage: "encode",
      progress: encodeStart + (0.99 - encodeStart) * encodingProgress,
      message: format === "mp3" ? `编码 MP3（${project.exportSettings.mp3BitrateKbps ?? 192} kbps）` : "编码 WAV"
    });
  });
  const baseName = exportBaseName(project.name, project.targetSpm, durationSeconds);
  if (timeline && project.exportSettings.includeTimeline) {
    onProgress({ jobId, stage: "encode", progress: 0.99, message: "流式打包音频与时间轴" });
    const archive = await addTimelineArchive(audio, `${baseName}.${format}`, timeline, language, signal);
    onProgress({ jobId, stage: "qa", progress: 1, message: "完成" });
    return {
      blob: archive,
      fileName: `${baseName}.zip`,
      durationSeconds,
      timeline
    };
  }
  onProgress({ jobId, stage: "qa", progress: 1, message: "完成" });
  return { blob: audio, fileName: `${baseName}.${format}`, durationSeconds, timeline };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
