import type { BeatSample } from "../audio/beatTrack";
import type { CustomBeatSampleRef } from "../domain/types";
import { decodeFile } from "./audio";

const MAX_CUSTOM_BEAT_BYTES = 10 * 1024 * 1024;
const MAX_CUSTOM_BEAT_SECONDS = 3;
type CustomBeatSlot = {
  working?: BeatSample;
  saved?: BeatSample;
};

const customBeatSamples = new Map<string, CustomBeatSlot>();

export async function registerCustomBeatSample(projectId: string, file: File): Promise<CustomBeatSampleRef> {
  if (file.size > MAX_CUSTOM_BEAT_BYTES) throw new Error("自定义鼓点文件不能超过 10 MB");
  const decoded = await decodeFile(file, { createMono: false });
  if (!decoded.channels.length || decoded.duration <= 0) throw new Error("没有从文件中解码出可用的鼓点音频");
  if (decoded.duration > MAX_CUSTOM_BEAT_SECONDS) throw new Error("请上传不超过 3 秒的单次鼓点音频");

  let peak = 0;
  for (const channel of decoded.channels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  }
  if (peak < 1e-4) throw new Error("鼓点音频音量过低或接近静音");
  const normalization = 0.9 / peak;
  const channels = decoded.channels.map((channel) => {
    const normalized = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) normalized[index] = channel[index] * normalization;
    return normalized;
  });
  const slot = customBeatSamples.get(projectId) ?? {};
  customBeatSamples.set(projectId, { ...slot, working: { channels, sampleRate: decoded.sampleRate } });
  return {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    lastModified: file.lastModified,
    durationSeconds: decoded.duration,
    available: true
  };
}

export function getCustomBeatSample(projectId: string): BeatSample | undefined {
  return customBeatSamples.get(projectId)?.working;
}

export function commitCustomBeatSample(projectId: string): void {
  const slot = customBeatSamples.get(projectId);
  if (!slot) return;
  customBeatSamples.set(projectId, { ...slot, saved: slot.working });
}

export function discardCustomBeatSample(projectId: string): void {
  const slot = customBeatSamples.get(projectId);
  if (!slot) return;
  customBeatSamples.set(projectId, { ...slot, working: slot.saved });
}

export function cloneCustomBeatSample(sourceProjectId: string, targetProjectId: string): void {
  const source = customBeatSamples.get(sourceProjectId);
  if (!source) return;
  customBeatSamples.set(targetProjectId, { working: source.working, saved: source.working });
}

export function clearCustomBeatSamples(): void {
  customBeatSamples.clear();
}
