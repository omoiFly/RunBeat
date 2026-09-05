import type { BeatSample } from "../audio/beatTrack";
import type { CustomBeatSampleRef } from "../domain/types";
import { decodeFile } from "./audio";
import { loadCustomBeatResource, saveCustomBeatResource } from "./db";

const MAX_CUSTOM_BEAT_BYTES = 10 * 1024 * 1024;
const MAX_CUSTOM_BEAT_SECONDS = 3;
type CustomBeatSlot = {
  working?: BeatSample;
  saved?: BeatSample;
};

const customBeatSamples = new Map<string, CustomBeatSlot>();

export async function decodeCustomBeatFile(file: File): Promise<BeatSample & { durationSeconds: number }> {
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
  return { channels, sampleRate: decoded.sampleRate, durationSeconds: decoded.duration };
}

export async function registerCustomBeatSample(projectId: string, file: File): Promise<CustomBeatSampleRef> {
  const decoded = await decodeCustomBeatFile(file);
  const resourceId = crypto.randomUUID();
  const sample: BeatSample = { channels: decoded.channels, sampleRate: decoded.sampleRate };
  await saveCustomBeatResource({ id: resourceId, ...sample });
  const slot = customBeatSamples.get(projectId) ?? {};
  customBeatSamples.set(projectId, { ...slot, working: sample });
  return {
    resourceId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    lastModified: file.lastModified,
    durationSeconds: decoded.durationSeconds,
    available: true
  };
}

export async function restoreCustomBeatSample(projectId: string, reference: CustomBeatSampleRef): Promise<boolean> {
  if (!reference.resourceId) return false;
  const resource = await loadCustomBeatResource(reference.resourceId);
  if (!resource || !resource.channels.length || resource.sampleRate <= 0) return false;
  const sample: BeatSample = { channels: resource.channels, sampleRate: resource.sampleRate };
  customBeatSamples.set(projectId, { working: sample, saved: sample });
  return true;
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
  if (slot.saved) {
    customBeatSamples.set(projectId, { ...slot, working: slot.saved });
  } else {
    customBeatSamples.delete(projectId);
  }
}

export function cloneCustomBeatSample(sourceProjectId: string, targetProjectId: string): void {
  const source = customBeatSamples.get(sourceProjectId);
  if (!source) return;
  customBeatSamples.set(targetProjectId, { working: source.working, saved: source.working });
}

export function clearCustomBeatSamples(): void {
  customBeatSamples.clear();
}

export function clearCustomBeatSample(projectId: string): void {
  customBeatSamples.delete(projectId);
}
