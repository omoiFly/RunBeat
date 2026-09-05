import { beatTrackGainForReference, generateBeatHit, generateBeatTrack, type BeatSample } from "../audio/beatTrack";
import { beatGridPhaseAfterSourceOffset } from "../audio/bpm";
import { dbToGain } from "../audio/grid";
import { measureIntegratedLoudness, measureTruePeak, truePeakProtectionGain } from "../audio/loudness";
import { encodeWav16 } from "../audio/wav";
import { MAX_BEAT_TRACK_GAIN_DB, type ProjectV1, type Track } from "../domain/types";
import type { PreviewWorkerCommand, PreviewWorkerEvent } from "../workers/previewProtocol";
import { decodeFile, type DecodedAudio } from "./audio";
import { getCustomBeatSample } from "./customBeat";
import { getRegisteredFile } from "./files";
import { getPreviewAudioContext } from "./previewContext";

export type TrackPreviewMode = "original" | "processed" | "processed-beat";
export type TrackPreviewStatus = "preparing" | "buffering" | "playing" | "ended" | "failed";

export interface TrackPreviewSnapshot {
  status: TrackPreviewStatus;
  mode: TrackPreviewMode;
  sourcePositionSeconds: number;
  bufferedThroughSeconds: number;
  sourceEndSeconds: number;
  error?: string;
}

export interface PreviewAlignment {
  phaseOffsetSeconds?: number;
  phaseNudgeBeats: -0.5 | 0 | 0.5;
}

export interface TrackPreviewSession {
  getSnapshot(): TrackPreviewSnapshot;
  subscribe(listener: (snapshot: TrackPreviewSnapshot) => void): () => void;
  seek(sourceSeconds: number): void;
  updateAlignment(alignment: PreviewAlignment): void;
  stop(): void;
}

interface PreviewChunk {
  channels: Float32Array[];
  final: boolean;
}

interface ScheduledBeat {
  source: AudioBufferSourceNode;
  when: number;
}

const CHUNK_SECONDS = 4;
const INITIAL_BUFFER_SECONDS = 8;
const TARGET_BUFFER_SECONDS = 12;
const UNDERFLOW_SECONDS = 0.5;
const RESUME_BUFFER_SECONDS = 4;
const START_LEAD_SECONDS = 0.08;
const BEAT_SCHEDULE_SECONDS = 2.5;
const BEAT_RESCHEDULE_GUARD_SECONDS = 0.05;
const PREVIEW_MASTER_GAIN = 10 ** (-3 / 20);

let beatPreviewAudio: HTMLAudioElement | undefined;
let beatPreviewUrl: string | undefined;
let activeTrackSession: ContinuousTrackPreview | undefined;
let previewGeneration = 0;
let sessionSequence = 0;

export const BEAT_PREVIEW_SECONDS = 6;

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Renders the independent beat preview against the project's normalized music
 * target. One fixed headroom gain is derived from the +10 dB endpoint and then
 * shared by every slider value. This preserves the full dB differences in the
 * solo preview while keeping its temporary 16-bit WAV below the peak ceiling.
 */
export function generateBeatPreviewChannels(
  project: ProjectV1,
  customBeatSample?: BeatSample
): [Float32Array, Float32Array] {
  const sampleRate = project.exportSettings.sampleRate;
  const channels = generateBeatTrack(
    BEAT_PREVIEW_SECONDS,
    project.targetSpm,
    sampleRate,
    { ...project.beatTrack, gainDb: 0 },
    0,
    customBeatSample
  );
  const outputGain = beatTrackGainForReference(
    project.beatTrack,
    sampleRate,
    project.exportSettings.loudnessLufs,
    customBeatSample
  );
  const maximumGain = beatTrackGainForReference(
    { ...project.beatTrack, gainDb: MAX_BEAT_TRACK_GAIN_DB },
    sampleRate,
    project.exportSettings.loudnessLufs,
    customBeatSample
  );
  const previewHeadroomGain = truePeakProtectionGain(measureTruePeak(channels) * maximumGain);
  for (const channel of channels) {
    for (let frame = 0; frame < channel.length; frame += 1) {
      channel[frame] *= outputGain * previewHeadroomGain;
    }
  }
  return channels;
}

function audioBufferFromChannels(
  context: AudioContext,
  channels: Float32Array[],
  sampleRate: number
): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  const buffer = context.createBuffer(Math.max(1, channels.length), length, sampleRate);
  channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
  return buffer;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function beatPatternLength(project: ProjectV1): number {
  const accent = project.beatTrack.accentEvery || 1;
  const feet = project.beatTrack.alternateFeet ? 2 : 1;
  return accent * feet / greatestCommonDivisor(accent, feet);
}

class ContinuousTrackPreview implements TrackPreviewSession {
  private readonly listeners = new Set<(snapshot: TrackPreviewSnapshot) => void>();
  private readonly sessionId = `preview-${++sessionSequence}`;
  private readonly timeRatio: number;
  private readonly customBeatSample?: BeatSample;
  private readonly beatBuffers = new Map<number, AudioBuffer>();
  private readonly musicSources = new Set<AudioBufferSourceNode>();
  private readonly beatSources = new Set<ScheduledBeat>();
  private readonly context: AudioContext;
  private readonly musicBus: GainNode;
  private readonly beatBus: GainNode;
  private readonly master: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly monitor: ReturnType<typeof setInterval>;

  private snapshot: TrackPreviewSnapshot;
  private alignment: PreviewAlignment;
  private decoded?: DecodedAudio;
  private worker?: Worker;
  private workerInitialized = false;
  private renderId = 0;
  private sessionSourceStart: number;
  private sourceInSeconds: number;
  private sourceOutSeconds: number;
  private expectedOutputFrames = 0;
  private receivedOutputFrames = 0;
  private originalOutputOffset = 0;
  private pendingChunks: PreviewChunk[] = [];
  private renderReady = false;
  private requestInFlight = false;
  private receivedFinal = false;
  private startingPlayback = false;
  private musicStartContext?: number;
  private scheduledThroughContext?: number;
  private beatOriginContext?: number;
  private beatOriginIndex = 0;
  private nextBeatIndex = 0;
  private stopped = false;
  private suspendPending = false;

  constructor(
    private readonly track: Track,
    private readonly project: ProjectV1,
    private readonly mode: TrackPreviewMode,
    requestedStartSeconds?: number
  ) {
    this.sourceInSeconds = clamp(track.edit.sourceInSeconds, 0, track.durationSeconds);
    this.sourceOutSeconds = clamp(track.edit.sourceOutSeconds, this.sourceInSeconds, track.durationSeconds);
    this.sessionSourceStart = clamp(
      requestedStartSeconds ?? this.sourceInSeconds,
      this.sourceInSeconds,
      this.sourceOutSeconds
    );
    this.timeRatio = mode === "original" ? 1 : track.derivedAnalysis?.timeRatio ?? 1;
    this.alignment = {
      phaseOffsetSeconds: track.derivedAnalysis?.phaseOffsetSeconds,
      phaseNudgeBeats: track.edit.phaseNudgeBeats
    };
    this.customBeatSample = mode === "processed-beat" && project.beatTrack.sound === "custom"
      ? getCustomBeatSample(project.id)
      : undefined;
    if (mode === "processed-beat" && project.beatTrack.sound === "custom" && !this.customBeatSample) {
      throw new Error("自定义鼓点文件不可用，请重新上传后试听");
    }

    this.snapshot = {
      status: "preparing",
      mode,
      sourcePositionSeconds: this.sessionSourceStart,
      bufferedThroughSeconds: this.sessionSourceStart,
      sourceEndSeconds: this.sourceOutSeconds
    };
    this.context = getPreviewAudioContext();
    this.musicBus = this.context.createGain();
    this.beatBus = this.context.createGain();
    this.master = this.context.createGain();
    this.compressor = this.context.createDynamicsCompressor();
    this.musicBus.connect(this.master);
    this.beatBus.connect(this.master);
    this.master.connect(this.compressor);
    this.compressor.connect(this.context.destination);
    this.master.gain.value = PREVIEW_MASTER_GAIN;
    this.compressor.threshold.value = -1;
    this.compressor.knee.value = 0;
    this.compressor.ratio.value = 20;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.1;
    this.monitor = setInterval(() => this.monitorPlayback(), 100);
    void this.initialize();
  }

  getSnapshot(): TrackPreviewSnapshot {
    return { ...this.snapshot };
  }

  subscribe(listener: (snapshot: TrackPreviewSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  seek(sourceSeconds: number): void {
    if (this.stopped || this.snapshot.status === "failed") return;
    const next = clamp(
      Number.isFinite(sourceSeconds) ? sourceSeconds : this.sessionSourceStart,
      this.sourceInSeconds,
      this.sourceOutSeconds
    );
    this.sessionSourceStart = next;
    if (!this.decoded) {
      this.updateSnapshot({
        status: "preparing",
        sourcePositionSeconds: next,
        bufferedThroughSeconds: next,
        error: undefined
      });
      return;
    }
    this.restartRender(next);
  }

  updateAlignment(alignment: PreviewAlignment): void {
    if (this.stopped) return;
    this.alignment = alignment;
    if (this.mode === "processed-beat" && this.musicStartContext != null) {
      this.resetBeatSchedule(this.context.currentTime + BEAT_RESCHEDULE_GUARD_SECONDS);
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.renderId += 1;
    clearInterval(this.monitor);
    this.stopScheduledAudio();
    this.worker?.terminate();
    this.worker = undefined;
    this.musicBus.disconnect();
    this.beatBus.disconnect();
    this.master.disconnect();
    this.compressor.disconnect();
    this.updateSnapshot({ status: "ended" });
    this.listeners.clear();
  }

  private async initialize(): Promise<void> {
    try {
      await this.context.resume();
      if (this.stopped) return;
      const file = getRegisteredFile(this.track.id);
      if (!file) throw new Error("请先重新关联原始文件");
      const decoded = await decodeFile(file, { createMono: false });
      if (this.stopped) return;
      this.decoded = decoded;
      this.sourceInSeconds = clamp(this.track.edit.sourceInSeconds, 0, decoded.duration);
      this.sourceOutSeconds = clamp(this.track.edit.sourceOutSeconds, this.sourceInSeconds, decoded.duration);
      this.sessionSourceStart = clamp(this.sessionSourceStart, this.sourceInSeconds, this.sourceOutSeconds);
      this.updateSnapshot({
        sourcePositionSeconds: this.sessionSourceStart,
        bufferedThroughSeconds: this.sessionSourceStart,
        sourceEndSeconds: this.sourceOutSeconds
      });

      if (this.mode === "original") {
        this.restartRender(this.sessionSourceStart);
        return;
      }

      const startFrame = Math.round(this.sourceInSeconds * decoded.sampleRate);
      const endFrame = Math.round(this.sourceOutSeconds * decoded.sampleRate);
      const musicLufs = measureIntegratedLoudness(
        decoded.channels.map((channel) => channel.subarray(startFrame, endFrame)),
        decoded.sampleRate
      );
      const requestedMusicGainDb = this.project.exportSettings.normalizeLoudness && Number.isFinite(musicLufs)
        ? this.project.exportSettings.loudnessLufs - musicLufs
        : 0;
      this.musicBus.gain.value = dbToGain(requestedMusicGainDb);
      const beatReferenceLufs = Number.isFinite(musicLufs)
        ? musicLufs + requestedMusicGainDb
        : this.project.exportSettings.loudnessLufs;
      if (this.mode === "processed-beat") {
        this.beatBus.gain.value = beatTrackGainForReference(
          this.project.beatTrack,
          this.context.sampleRate,
          beatReferenceLufs,
          this.customBeatSample
        );
      }

      const worker = new Worker(new URL("../workers/preview.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = ({ data }: MessageEvent<PreviewWorkerEvent>) => this.handleWorkerEvent(data);
      worker.onerror = (event) => this.fail(event.message || "试听变速 Worker 运行失败");
      const command: PreviewWorkerCommand = {
        kind: "initialize",
        sessionId: this.sessionId,
        channels: decoded.channels,
        sampleRate: decoded.sampleRate
      };
      worker.postMessage(command, decoded.channels.map((channel) => channel.buffer as ArrayBuffer));
      this.restartRender(this.sessionSourceStart);
    } catch (error) {
      this.fail(errorMessage(error));
    }
  }

  private restartRender(sourceSeconds: number): void {
    if (!this.decoded || this.stopped) return;
    this.renderId += 1;
    this.stopScheduledAudio();
    this.sessionSourceStart = clamp(sourceSeconds, this.sourceInSeconds, this.sourceOutSeconds);
    this.expectedOutputFrames = 0;
    this.receivedOutputFrames = 0;
    this.originalOutputOffset = 0;
    this.pendingChunks = [];
    this.renderReady = false;
    this.requestInFlight = false;
    this.receivedFinal = false;
    this.startingPlayback = false;
    this.musicStartContext = undefined;
    this.scheduledThroughContext = undefined;
    this.beatOriginContext = undefined;
    this.beatOriginIndex = 0;
    this.nextBeatIndex = 0;
    this.updateSnapshot({
      status: "buffering",
      sourcePositionSeconds: this.sessionSourceStart,
      bufferedThroughSeconds: this.sessionSourceStart,
      sourceEndSeconds: this.sourceOutSeconds,
      error: undefined
    });

    if (this.sessionSourceStart >= this.sourceOutSeconds - 1 / this.decoded.sampleRate) {
      this.updateSnapshot({
        status: "ended",
        sourcePositionSeconds: this.sourceOutSeconds,
        bufferedThroughSeconds: this.sourceOutSeconds
      });
      return;
    }

    if (this.mode === "original") {
      const startFrame = Math.round(this.sessionSourceStart * this.decoded.sampleRate);
      const endFrame = Math.round(this.sourceOutSeconds * this.decoded.sampleRate);
      this.expectedOutputFrames = Math.max(0, endFrame - startFrame);
      this.renderReady = true;
      this.requestNextChunk();
    } else if (this.workerInitialized) {
      this.startWorkerRender();
    }
  }

  private startWorkerRender(): void {
    if (!this.worker || !this.decoded || this.stopped || this.mode === "original") return;
    const command: PreviewWorkerCommand = {
      kind: "start",
      sessionId: this.sessionId,
      renderId: this.renderId,
      startFrame: Math.round(this.sessionSourceStart * this.decoded.sampleRate),
      endFrame: Math.round(this.sourceOutSeconds * this.decoded.sampleRate),
      timeRatio: this.timeRatio,
      chunkFrames: Math.round(CHUNK_SECONDS * this.decoded.sampleRate)
    };
    this.worker.postMessage(command);
  }

  private handleWorkerEvent(event: PreviewWorkerEvent): void {
    if (this.stopped || event.sessionId !== this.sessionId) return;
    if (event.kind === "initialized") {
      this.workerInitialized = true;
      this.startWorkerRender();
      return;
    }
    if (event.renderId !== this.renderId) return;
    if (event.kind === "failed") {
      this.fail(event.error);
      return;
    }
    if (event.kind === "ready") {
      this.expectedOutputFrames = event.outputFrames;
      if (event.outputFrames <= 0) {
        this.updateSnapshot({
          status: "ended",
          sourcePositionSeconds: this.sourceOutSeconds,
          bufferedThroughSeconds: this.sourceOutSeconds
        });
        return;
      }
      this.renderReady = true;
      this.updateSnapshot({ status: "buffering" });
      this.requestNextChunk();
      return;
    }
    this.requestInFlight = false;
    this.handleChunk({
      channels: event.channels,
      final: event.final
    });
  }

  private requestNextChunk(): void {
    if (
      this.stopped
      || !this.decoded
      || !this.renderReady
      || this.requestInFlight
      || this.receivedFinal
      || this.snapshot.status === "failed"
      || this.snapshot.status === "ended"
    ) return;

    const initialTarget = Math.min(
      this.expectedOutputFrames,
      Math.round(INITIAL_BUFFER_SECONDS * this.decoded.sampleRate)
    );
    if (this.musicStartContext == null && this.receivedOutputFrames >= initialTarget) {
      void this.beginPlayback();
      return;
    }
    if (this.musicStartContext != null && this.bufferedAheadSeconds() >= TARGET_BUFFER_SECONDS) return;

    this.requestInFlight = true;
    const token = this.renderId;
    if (this.mode === "original") {
      queueMicrotask(() => {
        if (this.stopped || token !== this.renderId || !this.decoded) return;
        const startFrame = Math.round(this.sessionSourceStart * this.decoded.sampleRate);
        const chunkFrames = Math.round(CHUNK_SECONDS * this.decoded.sampleRate);
        const start = startFrame + this.originalOutputOffset;
        const end = Math.min(startFrame + this.expectedOutputFrames, start + chunkFrames);
        const channels = this.decoded.channels.map((channel) => channel.slice(start, end));
        this.originalOutputOffset += end - start;
        this.requestInFlight = false;
        this.handleChunk({
          channels,
          final: this.originalOutputOffset >= this.expectedOutputFrames
        });
      });
      return;
    }
    this.worker?.postMessage({
      kind: "next",
      sessionId: this.sessionId,
      renderId: this.renderId
    } satisfies PreviewWorkerCommand);
  }

  private handleChunk(chunk: PreviewChunk): void {
    if (this.stopped || !this.decoded || !chunk.channels[0]?.length) return;
    this.receivedOutputFrames += chunk.channels[0].length;
    this.receivedFinal = chunk.final;
    this.pendingChunks.push(chunk);
    this.updateSnapshot({
      bufferedThroughSeconds: Math.min(
        this.sourceOutSeconds,
        this.sessionSourceStart + this.receivedOutputFrames / this.decoded.sampleRate / this.timeRatio
      )
    });

    const initialTarget = Math.min(
      this.expectedOutputFrames,
      Math.round(INITIAL_BUFFER_SECONDS * this.decoded.sampleRate)
    );
    if (this.musicStartContext == null) {
      if (this.receivedOutputFrames >= initialTarget || this.receivedFinal) void this.beginPlayback();
    } else {
      this.flushPendingChunks();
      this.maybeResumeAfterBuffering();
    }
    this.requestNextChunk();
  }

  private async beginPlayback(): Promise<void> {
    if (
      this.startingPlayback
      || this.stopped
      || !this.decoded
      || this.musicStartContext != null
      || !this.pendingChunks.length
    ) return;
    this.startingPlayback = true;
    const token = this.renderId;
    try {
      await this.context.resume();
      if (this.stopped || token !== this.renderId || !this.pendingChunks.length) return;
      const shift = this.mode === "processed-beat" ? this.phaseShiftSeconds() : 0;
      this.musicStartContext = this.context.currentTime + Math.max(START_LEAD_SECONDS, shift + 0.03);
      this.scheduledThroughContext = this.musicStartContext;
      this.flushPendingChunks();
      if (this.mode === "processed-beat") {
        this.resetBeatSchedule(this.context.currentTime + 0.01);
      }
      this.updateSnapshot({ status: "playing" });
      this.requestNextChunk();
    } catch (error) {
      this.fail(errorMessage(error));
    } finally {
      this.startingPlayback = false;
    }
  }

  private flushPendingChunks(): void {
    if (!this.decoded || this.musicStartContext == null || this.scheduledThroughContext == null) return;
    while (this.pendingChunks.length) {
      const chunk = this.pendingChunks.shift()!;
      const buffer = audioBufferFromChannels(this.context, chunk.channels, this.decoded.sampleRate);
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.musicBus);
      const token = this.renderId;
      source.onended = () => {
        this.musicSources.delete(source);
        if (chunk.final && token === this.renderId && !this.stopped) {
          this.stopBeatAudio();
          this.updateSnapshot({
            status: "ended",
            sourcePositionSeconds: this.sourceOutSeconds,
            bufferedThroughSeconds: this.sourceOutSeconds
          });
        }
      };
      this.musicSources.add(source);
      source.start(this.scheduledThroughContext);
      this.scheduledThroughContext += buffer.duration;
    }
  }

  private monitorPlayback(): void {
    if (this.stopped || !this.decoded) return;
    if (this.musicStartContext != null && (this.snapshot.status === "playing" || this.snapshot.status === "buffering")) {
      this.updateSnapshot({ sourcePositionSeconds: this.currentSourcePosition() });
      if (this.mode === "processed-beat") this.scheduleBeatHorizon();
      const ahead = this.bufferedAheadSeconds();
      if (
        this.snapshot.status === "playing"
        && !this.receivedFinal
        && ahead < UNDERFLOW_SECONDS
        && !this.suspendPending
      ) {
        this.suspendPending = true;
        this.updateSnapshot({ status: "buffering" });
        void this.context.suspend()
          .catch((error) => this.fail(errorMessage(error)))
          .finally(() => {
            this.suspendPending = false;
            this.maybeResumeAfterBuffering();
          });
      }
      this.requestNextChunk();
    }
  }

  private maybeResumeAfterBuffering(): void {
    if (
      this.stopped
      || this.musicStartContext == null
      || this.snapshot.status !== "buffering"
      || this.suspendPending
    ) return;
    const enough = this.bufferedAheadSeconds() >= RESUME_BUFFER_SECONDS || this.receivedFinal;
    if (!enough) return;
    if (this.mode === "processed-beat") this.scheduleBeatHorizon();
    const token = this.renderId;
    void this.context.resume()
      .then(() => {
        if (!this.stopped && token === this.renderId && this.snapshot.status === "buffering") {
          this.updateSnapshot({ status: "playing" });
        }
      })
      .catch((error) => this.fail(errorMessage(error)));
  }

  private bufferedAheadSeconds(): number {
    if (this.scheduledThroughContext == null) return 0;
    return Math.max(0, this.scheduledThroughContext - this.context.currentTime);
  }

  private currentSourcePosition(): number {
    if (this.musicStartContext == null) return this.sessionSourceStart;
    const outputElapsed = Math.max(0, this.context.currentTime - this.musicStartContext);
    return Math.min(this.sourceOutSeconds, this.sessionSourceStart + outputElapsed / this.timeRatio);
  }

  private phaseShiftSeconds(sourceOffsetSeconds = this.sessionSourceStart): number {
    const interval = 60 / this.project.targetSpm;
    const localPhase = beatGridPhaseAfterSourceOffset(
      this.alignment.phaseOffsetSeconds,
      sourceOffsetSeconds,
      this.timeRatio,
      this.project.targetSpm
    );
    let shift = localPhase == null ? 0 : positiveModulo(-localPhase, interval);
    if (localPhase != null && shift * (this.decoded?.sampleRate ?? 44_100) < 0.5) shift = 0;
    shift += this.alignment.phaseNudgeBeats * interval;
    return shift;
  }

  private resetBeatSchedule(cutoff: number): void {
    if (this.mode !== "processed-beat" || this.musicStartContext == null) return;
    for (const beat of [...this.beatSources]) {
      if (beat.when < cutoff) continue;
      beat.source.onended = null;
      try {
        beat.source.stop();
      } catch {
        // The node may already have naturally ended.
      }
      beat.source.disconnect();
      this.beatSources.delete(beat);
    }
    const interval = 60 / this.project.targetSpm;
    const shift = this.phaseShiftSeconds();
    const masterTimeAtSourceStart = this.phaseShiftSeconds(this.sourceInSeconds)
      + (this.sessionSourceStart - this.sourceInSeconds) * this.timeRatio;
    this.beatOriginContext = this.musicStartContext - shift;
    this.beatOriginIndex = Math.round((masterTimeAtSourceStart - shift) / interval);
    this.nextBeatIndex = Math.max(
      0,
      this.beatOriginIndex + Math.ceil((cutoff - this.beatOriginContext) / interval - 1e-9)
    );
    this.scheduleBeatHorizon();
  }

  private scheduleBeatHorizon(): void {
    if (
      this.mode !== "processed-beat"
      || this.musicStartContext == null
      || this.beatOriginContext == null
      || this.snapshot.status === "ended"
      || this.snapshot.status === "failed"
    ) return;
    const interval = 60 / this.project.targetSpm;
    const horizon = Math.min(
      this.context.currentTime + BEAT_SCHEDULE_SECONDS,
      this.scheduledThroughContext ?? Number.POSITIVE_INFINITY
    );
    while (
      this.beatOriginContext + (this.nextBeatIndex - this.beatOriginIndex) * interval
      < horizon - 0.001
    ) {
      const beat = this.nextBeatIndex;
      const when = this.beatOriginContext + (beat - this.beatOriginIndex) * interval;
      this.nextBeatIndex += 1;
      if (when < this.context.currentTime + 0.005) continue;
      const source = this.context.createBufferSource();
      source.buffer = this.beatBuffer(beat);
      source.connect(this.beatBus);
      const scheduled: ScheduledBeat = { source, when };
      source.onended = () => {
        source.disconnect();
        this.beatSources.delete(scheduled);
      };
      this.beatSources.add(scheduled);
      source.start(when);
    }
  }

  private beatBuffer(beat: number): AudioBuffer {
    const pattern = beatPatternLength(this.project);
    const key = positiveModulo(beat, pattern);
    const cached = this.beatBuffers.get(key);
    if (cached) return cached;
    const channels = generateBeatHit(
      beat,
      this.context.sampleRate,
      { ...this.project.beatTrack, gainDb: 0 },
      this.customBeatSample
    );
    const buffer = audioBufferFromChannels(this.context, channels, this.context.sampleRate);
    this.beatBuffers.set(key, buffer);
    return buffer;
  }

  private stopScheduledAudio(): void {
    for (const source of this.musicSources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The node may not have started yet.
      }
      source.disconnect();
    }
    this.musicSources.clear();
    this.stopBeatAudio();
  }

  private stopBeatAudio(): void {
    for (const beat of this.beatSources) {
      beat.source.onended = null;
      try {
        beat.source.stop();
      } catch {
        // The node may not have started yet.
      }
      beat.source.disconnect();
    }
    this.beatSources.clear();
  }

  private fail(message: string): void {
    if (this.stopped) return;
    this.renderId += 1;
    clearInterval(this.monitor);
    this.stopScheduledAudio();
    this.worker?.terminate();
    this.worker = undefined;
    this.updateSnapshot({ status: "failed", error: message });
  }

  private updateSnapshot(patch: Partial<TrackPreviewSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    const copy = this.getSnapshot();
    for (const listener of this.listeners) listener(copy);
  }
}

export function startPreview(
  track: Track,
  project: ProjectV1,
  mode: TrackPreviewMode,
  startSeconds?: number
): TrackPreviewSession {
  stopPreview();
  const session = new ContinuousTrackPreview(track, project, mode, startSeconds);
  activeTrackSession = session;
  return session;
}

/** Compatibility helper for callers that only need to know when audible playback starts. */
export function playPreview(
  track: Track,
  project: ProjectV1,
  mode: TrackPreviewMode,
  startSeconds?: number
): Promise<void> {
  const session = startPreview(track, project, mode, startSeconds);
  return new Promise((resolve, reject) => {
    const unsubscribe = session.subscribe((snapshot) => {
      if (snapshot.status === "playing" || snapshot.status === "ended") {
        unsubscribe();
        resolve();
      } else if (snapshot.status === "failed") {
        unsubscribe();
        reject(new Error(snapshot.error));
      }
    });
  });
}

export async function playBeatPreview(project: ProjectV1, customBeatSample?: BeatSample): Promise<void> {
  stopPreview();
  const generation = previewGeneration;
  const resolvedCustomBeatSample = project.beatTrack.sound === "custom"
    ? customBeatSample ?? getCustomBeatSample(project.id)
    : undefined;
  if (project.beatTrack.sound === "custom" && !resolvedCustomBeatSample) {
    throw new Error("自定义鼓点文件不可用，请重新上传后试听");
  }
  const sampleRate = project.exportSettings.sampleRate;
  const channels = generateBeatPreviewChannels(project, resolvedCustomBeatSample);
  if (generation !== previewGeneration) return;
  const blob = encodeWav16({ channels, sampleRate });
  beatPreviewUrl = URL.createObjectURL(blob);
  beatPreviewAudio = new Audio(beatPreviewUrl);
  await beatPreviewAudio.play();
}

export function stopPreview(): void {
  previewGeneration += 1;
  activeTrackSession?.stop();
  activeTrackSession = undefined;
  beatPreviewAudio?.pause();
  beatPreviewAudio = undefined;
  if (beatPreviewUrl) URL.revokeObjectURL(beatPreviewUrl);
  beatPreviewUrl = undefined;
}
