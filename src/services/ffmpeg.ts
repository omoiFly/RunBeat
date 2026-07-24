import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import type { Mp3BitrateKbps } from "../domain/types";

export interface Mp3EncodeOptions {
  bitrateKbps?: Mp3BitrateKbps;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

interface ActiveFfmpegOperation {
  ffmpeg: FFmpeg;
  cancelled: boolean;
  kind: "encode-mp3" | "decode-audio";
}

const SUPPORTED_BITRATES: readonly Mp3BitrateKbps[] = [128, 192, 256, 320];

let ffmpegInstance: FFmpeg | undefined;
let loadPromise: Promise<void> | undefined;
let activeOperation: ActiveFfmpegOperation | undefined;
let operationQueue: Promise<void> = Promise.resolve();

function abortError(message = "MP3 编码已取消"): DOMException {
  return new DOMException(message, "AbortError");
}

function resetInstance(instance: FFmpeg): void {
  instance.terminate();
  if (ffmpegInstance === instance) {
    ffmpegInstance = undefined;
    loadPromise = undefined;
  }
}

function cancelActiveJob(job: ActiveFfmpegOperation): void {
  job.cancelled = true;
  resetInstance(job.ffmpeg);
}

function enqueueFfmpegOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function getFfmpegInstance(): FFmpeg {
  return ffmpegInstance ??= new FFmpeg();
}

async function ensureFfmpegLoaded(instance: FFmpeg): Promise<void> {
  if (!instance.loaded) {
    loadPromise ??= instance.load({ coreURL, wasmURL }).then(() => undefined);
    try {
      await loadPromise;
    } catch (error) {
      resetInstance(instance);
      throw error;
    }
  }
}

async function deleteTemporaryFile(ffmpeg: FFmpeg, path: string): Promise<void> {
  if (!ffmpeg.loaded) return;
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // The file may not have been written, or cancellation may have reset MEMFS.
  }
}

async function encodeMp3Now(wav: Blob, options: Mp3EncodeOptions): Promise<Blob> {
  const bitrateKbps = options.bitrateKbps ?? 192;
  if (!SUPPORTED_BITRATES.includes(bitrateKbps)) throw new Error(`不支持的 MP3 码率：${bitrateKbps} kbps`);
  if (options.signal?.aborted) throw abortError();

  const ffmpeg = getFfmpegInstance();
  const job: ActiveFfmpegOperation = { ffmpeg, cancelled: false, kind: "encode-mp3" };
  activeOperation = job;
  const jobId = crypto.randomUUID();
  const mountPoint = `/input-${jobId}`;
  const inputPath = `${mountPoint}/source.wav`;
  const outputPath = `${jobId}.mp3`;
  let lastLogLine = "";
  let listenersAttached = false;
  let mounted = false;

  const onAbort = () => cancelActiveJob(job);
  const onLog = ({ message }: { message: string }) => { if (message.trim()) lastLogLine = message.trim(); };
  const onProgress = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) options.onProgress?.(Math.max(0, Math.min(1, progress)));
  };

  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await ensureFfmpegLoaded(ffmpeg);
    if (job.cancelled || options.signal?.aborted) throw abortError();
    ffmpeg.on("log", onLog);
    ffmpeg.on("progress", onProgress);
    listenersAttached = true;
    await ffmpeg.createDir(mountPoint);
    mounted = await ffmpeg.mount(FFFSType.WORKERFS, { blobs: [{ name: "source.wav", data: wav }] }, mountPoint);
    if (!mounted) throw new Error("FFmpeg 无法挂载音频输入");
    if (job.cancelled || options.signal?.aborted) throw abortError();
    const exitCode = await ffmpeg.exec([
      "-hide_banner",
      "-loglevel", "error",
      "-i", inputPath,
      "-map", "0:a:0",
      "-map_metadata", "-1",
      "-vn",
      "-c:a", "libmp3lame",
      "-b:a", `${bitrateKbps}k`,
      outputPath
    ]);
    if (job.cancelled || options.signal?.aborted) throw abortError();
    if (exitCode !== 0) {
      const detail = lastLogLine ? `：${lastLogLine}` : "";
      throw new Error(`MP3 编码失败（FFmpeg 退出码 ${exitCode}）${detail}`);
    }
    const output = await ffmpeg.readFile(outputPath);
    if (!(output instanceof Uint8Array)) throw new Error("FFmpeg 未返回有效的 MP3 数据");
    options.onProgress?.(1);
    return new Blob([output as Uint8Array<ArrayBuffer>], { type: "audio/mpeg" });
  } catch (error) {
    if (job.cancelled || options.signal?.aborted) throw abortError();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (listenersAttached) {
      ffmpeg.off("log", onLog);
      ffmpeg.off("progress", onProgress);
    }
    await deleteTemporaryFile(ffmpeg, outputPath);
    if (mounted && ffmpeg.loaded) {
      try {
        await ffmpeg.unmount(mountPoint);
      } catch {
        // Cancellation may already have destroyed the virtual file system.
      }
    }
    if (ffmpeg.loaded) {
      try {
        await ffmpeg.deleteDir(mountPoint);
      } catch {
        // The mount point may already be gone after a failed initialization.
      }
    }
    if (activeOperation === job) activeOperation = undefined;
  }
}

/**
 * Encodes a PCM WAV Blob to MP3 using the locally bundled, single-threaded
 * FFmpeg WebAssembly core. Calls are serialized because FFmpeg shares MEMFS.
 */
export function encodeMp3(wav: Blob, options: Mp3EncodeOptions = {}): Promise<Blob> {
  return enqueueFfmpegOperation(() => encodeMp3Now(wav, options));
}

export interface AudioDecodeFallbackOptions {
  channels: 1 | 2;
  sampleRate: number;
}

async function decodeAudioToWavNow(file: File, options: AudioDecodeFallbackOptions): Promise<ArrayBuffer> {
  const ffmpeg = getFfmpegInstance();
  const job: ActiveFfmpegOperation = { ffmpeg, cancelled: false, kind: "decode-audio" };
  activeOperation = job;
  const jobId = crypto.randomUUID();
  const mountPoint = `/decode-${jobId}`;
  const extension = file.name.match(/\.[a-z0-9]{1,10}$/i)?.[0].toLowerCase() ?? ".audio";
  const inputName = `source${extension}`;
  const inputPath = `${mountPoint}/${inputName}`;
  const outputPath = `${jobId}.wav`;
  let lastLogLine = "";
  let listenerAttached = false;
  let mounted = false;
  const onLog = ({ message }: { message: string }) => { if (message.trim()) lastLogLine = message.trim(); };

  try {
    await ensureFfmpegLoaded(ffmpeg);
    if (job.cancelled) throw abortError("音频解码已取消");
    ffmpeg.on("log", onLog);
    listenerAttached = true;
    await ffmpeg.createDir(mountPoint);
    mounted = await ffmpeg.mount(FFFSType.WORKERFS, { blobs: [{ name: inputName, data: file }] }, mountPoint);
    if (!mounted) throw new Error("FFmpeg 无法挂载音频输入");
    const exitCode = await ffmpeg.exec([
      "-hide_banner",
      "-loglevel", "error",
      "-i", inputPath,
      "-map", "0:a:0",
      "-map_metadata", "-1",
      "-vn",
      "-sn",
      "-dn",
      "-ar", String(options.sampleRate),
      "-ac", String(options.channels),
      "-c:a", "pcm_f32le",
      "-f", "wav",
      outputPath
    ]);
    if (job.cancelled) throw abortError("音频解码已取消");
    if (exitCode !== 0) {
      const detail = lastLogLine ? `：${lastLogLine}` : "";
      throw new Error(`FFmpeg 音频解码失败（退出码 ${exitCode}）${detail}`);
    }
    const output = await ffmpeg.readFile(outputPath);
    if (!(output instanceof Uint8Array)) throw new Error("FFmpeg 未返回有效的 WAV 数据");
    const bytes = output as Uint8Array<ArrayBuffer>;
    return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
  } catch (error) {
    if (job.cancelled) throw abortError("音频解码已取消");
    throw error;
  } finally {
    if (listenerAttached) ffmpeg.off("log", onLog);
    await deleteTemporaryFile(ffmpeg, outputPath);
    if (mounted && ffmpeg.loaded) {
      try {
        await ffmpeg.unmount(mountPoint);
      } catch {
        // Cancellation may already have destroyed the virtual file system.
      }
    }
    if (ffmpeg.loaded) {
      try {
        await ffmpeg.deleteDir(mountPoint);
      } catch {
        // The mount point may not exist after a failed initialization.
      }
    }
    if (activeOperation === job) activeOperation = undefined;
  }
}

/** Uses the bundled FFmpeg core when Web Audio cannot decode a FLAC directly. */
export function decodeAudioToWav(file: File, options: AudioDecodeFallbackOptions): Promise<ArrayBuffer> {
  return enqueueFfmpegOperation(() => decodeAudioToWavNow(file, options));
}

/** Cancels the currently running MP3 encode, if any. */
export function cancelMp3Encoding(): void {
  if (activeOperation?.kind === "encode-mp3") cancelActiveJob(activeOperation);
}

/** Releases the FFmpeg worker and its WebAssembly memory. */
export function disposeFfmpeg(): void {
  if (activeOperation) {
    cancelActiveJob(activeOperation);
    return;
  }
  if (ffmpegInstance) resetInstance(ffmpegInstance);
}
