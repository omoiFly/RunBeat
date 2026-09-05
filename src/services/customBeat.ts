import type { BeatSample } from "../audio/beatTrack";
import type { CustomBeatSampleRef } from "../domain/types";
import { decodeFile } from "./audio";
import { loadCustomBeatResource } from "./db";

const MAX_CUSTOM_BEAT_BYTES = 10 * 1024 * 1024;
const MAX_CUSTOM_BEAT_SECONDS = 3;
const samples = new Map<string, BeatSample>();

export async function decodeCustomBeatFile(file: File): Promise<BeatSample & { durationSeconds: number }> {
  if (file.size > MAX_CUSTOM_BEAT_BYTES) throw new Error("自定义鼓点文件不能超过 10 MB");
  const decoded = await decodeFile(file, { createMono: false });
  if (!decoded.channels.length || !Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error("没有从文件中解码出可用的鼓点音频");
  if (decoded.duration > MAX_CUSTOM_BEAT_SECONDS) throw new Error("请上传不超过 3 秒的单次鼓点音频");

  let peak = 0;
  for (const channel of decoded.channels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  }
  if (!Number.isFinite(peak) || peak < 1e-4) throw new Error("鼓点音频音量过低或接近静音");
  const normalization = 0.9 / peak;
  const channels = decoded.channels.map((channel) => {
    const normalized = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) normalized[index] = channel[index] * normalization;
    return normalized;
  });
  return { channels, sampleRate: decoded.sampleRate, durationSeconds: decoded.duration };
}

export async function loadCustomBeatSample(resourceId: string): Promise<BeatSample | undefined> {
  const resource = await loadCustomBeatResource(resourceId);
  if (!resource?.channels[0]?.length || !Number.isFinite(resource.sampleRate) || resource.sampleRate <= 0) {
    samples.delete(resourceId);
    return undefined;
  }
  const sample: BeatSample = { channels: resource.channels, sampleRate: resource.sampleRate };
  samples.set(resourceId, sample);
  return sample;
}

// Resolve by the project's exact resource reference, including after undo/redo.
export function getCustomBeatSample(reference?: CustomBeatSampleRef): BeatSample | undefined {
  return reference?.resourceId ? samples.get(reference.resourceId) : undefined;
}

export function clearCustomBeatSamples(): void { samples.clear(); }
export function clearCustomBeatSample(resourceId: string): void { samples.delete(resourceId); }
