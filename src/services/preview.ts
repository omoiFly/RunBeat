import { mixTimeline } from "../audio/mixer";
import { encodeWav16 } from "../audio/wav";
import type { ProjectV1, Track } from "../domain/types";
import { decodeFile } from "./audio";
import { getCustomBeatSample } from "./customBeat";
import { getRegisteredFile } from "./files";
import { previewSourceRange } from "./previewRange";
import { prepareTrackClip } from "./renderAudio";

let currentAudio: HTMLAudioElement | undefined;
let currentUrl: string | undefined;
let previewGeneration = 0;

export const BEAT_PREVIEW_SECONDS = 6;

export async function playBeatPreview(project: ProjectV1): Promise<void> {
  stopPreview();
  const generation = previewGeneration;
  const customBeatSample = project.beatTrack.sound === "custom" ? getCustomBeatSample(project.id) : undefined;
  if (project.beatTrack.sound === "custom" && !customBeatSample) {
    throw new Error("自定义鼓点文件不可用，请重新上传后试听");
  }
  const sampleRate = project.exportSettings.sampleRate;
  const channels = mixTimeline([], {
    sampleRate,
    targetSpm: project.targetSpm,
    transitionBars: project.transitionBars,
    beatTrack: project.beatTrack,
    customBeatSample,
    normalizeLoudness: project.exportSettings.normalizeLoudness,
    loudnessLufs: project.exportSettings.loudnessLufs,
    includeBeat: true,
    minimumDurationSeconds: BEAT_PREVIEW_SECONDS
  });
  if (generation !== previewGeneration) return;
  const blob = encodeWav16({ channels, sampleRate });
  currentUrl = URL.createObjectURL(blob);
  currentAudio = new Audio(currentUrl);
  await currentAudio.play();
}

export async function playPreview(
  track: Track,
  project: ProjectV1,
  mode: "original" | "processed" | "processed-beat",
  startSeconds?: number
): Promise<void> {
  stopPreview();
  const generation = previewGeneration;
  const file = getRegisteredFile(track.id);
  if (!file) throw new Error("请先重新关联原始文件");
  const decoded = await decodeFile(file, { createMono: false });
  if (generation !== previewGeneration) return;
  const range = previewSourceRange(track, decoded.duration, startSeconds);
  let channels: Float32Array[];
  if (mode === "original") {
    const start = Math.round(range.startSeconds * decoded.sampleRate);
    const end = Math.round(range.endSeconds * decoded.sampleRate);
    if (end <= start) throw new Error("试听音频片段为空，请检查入点和出点");
    channels = decoded.channels.map((channel) => channel.slice(start, end));
  } else {
    const prepared = await prepareTrackClip(decoded, track, project, range);
    channels = mixTimeline([prepared.audio], {
      sampleRate: decoded.sampleRate,
      targetSpm: project.targetSpm,
      transitionBars: project.transitionBars,
      beatTrack: project.beatTrack,
      customBeatSample: mode === "processed-beat" ? getCustomBeatSample(project.id) : undefined,
      normalizeLoudness: project.exportSettings.normalizeLoudness,
      loudnessLufs: project.exportSettings.loudnessLufs,
      includeBeat: mode === "processed-beat"
    });
  }
  if (generation !== previewGeneration) return;
  const blob = encodeWav16({ channels, sampleRate: decoded.sampleRate });
  currentUrl = URL.createObjectURL(blob);
  currentAudio = new Audio(currentUrl);
  await currentAudio.play();
}

export function stopPreview(): void {
  previewGeneration += 1;
  currentAudio?.pause();
  currentAudio = undefined;
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = undefined;
}
