import { generateBeatTrackRange } from "./beatTrack";
import { equalPowerGains, transitionDurationSeconds } from "./grid";
import type { MixOptions, RenderableTrack, TimelineGeometry } from "./mixer";

export const STREAM_MIX_CHUNK_FRAMES = 1 << 18;

export type TimelineTrackLoader = (trackIndex: number) => Promise<RenderableTrack>;
export type TimelineChunkConsumer = (channels: [Float32Array, Float32Array], startFrame: number) => void | Promise<void>;

function abortError(): DOMException {
  return new DOMException("渲染已取消", "AbortError");
}

/**
 * Mixes an already planned timeline while retaining no more than one prepared
 * song plus the not-yet-final crossfade tail.
 */
export async function streamPlannedTimeline(
  geometry: TimelineGeometry,
  loadTrack: TimelineTrackLoader,
  options: MixOptions,
  consume: TimelineChunkConsumer,
  signal?: AbortSignal
): Promise<void> {
  if (!geometry.entries.length && !options.includeBeat) throw new Error("时间线中没有可渲染歌曲");
  const transitionFrames = Math.round(transitionDurationSeconds(options.transitionBars, options.targetSpm) * options.sampleRate);
  let bufferStart = 0;
  let left = new Float32Array(0);
  let right = new Float32Array(0);

  const flushTo = async (targetFrame: number) => {
    const safeTarget = Math.min(geometry.durationFrames, Math.max(bufferStart, targetFrame));
    for (let cursor = bufferStart; cursor < safeTarget; cursor += STREAM_MIX_CHUNK_FRAMES) {
      if (signal?.aborted) throw abortError();
      const frames = Math.min(STREAM_MIX_CHUNK_FRAMES, safeTarget - cursor);
      const chunk: [Float32Array, Float32Array] = [new Float32Array(frames), new Float32Array(frames)];
      const sourceOffset = cursor - bufferStart;
      const available = Math.max(0, Math.min(frames, left.length - sourceOffset));
      if (available) {
        chunk[0].set(left.subarray(sourceOffset, sourceOffset + available));
        chunk[1].set(right.subarray(sourceOffset, sourceOffset + available));
      }
      if (options.includeBeat) {
        const beat = generateBeatTrackRange(
          cursor,
          frames,
          options.targetSpm,
          options.sampleRate,
          options.beatTrack,
          options.customBeatSample
        );
        for (let frame = 0; frame < frames; frame += 1) {
          chunk[0][frame] += beat[0][frame];
          chunk[1][frame] += beat[1][frame];
        }
      }
      await consume(chunk, cursor);
    }

    const consumed = safeTarget - bufferStart;
    if (consumed > 0) {
      left = consumed < left.length ? left.slice(consumed) : new Float32Array(0);
      right = consumed < right.length ? right.slice(consumed) : new Float32Array(0);
      bufferStart = safeTarget;
    }
  };

  for (let index = 0; index < geometry.entries.length; index += 1) {
    if (signal?.aborted) throw abortError();
    const entry = geometry.entries[index];
    await flushTo(entry.startFrames);
    const track = await loadTrack(entry.trackIndex);
    const sourceFrames = Math.min(...track.channels.map((channel) => channel.length));
    const leadingSilence = Math.max(0, entry.phaseShiftFrames);
    const sourceOffset = Math.max(0, -entry.phaseShiftFrames);
    const alignedFrames = entry.endFrames - entry.startFrames;
    const expectedSourceFrames = alignedFrames - leadingSilence + sourceOffset;
    if (sourceFrames !== expectedSourceFrames) {
      throw new Error(`歌曲渲染长度与时间线计划不一致（${sourceFrames} / ${expectedSourceFrames}）`);
    }

    const requiredFrames = Math.max(left.length, alignedFrames);
    if (left.length < requiredFrames) {
      const expandedLeft = new Float32Array(requiredFrames);
      const expandedRight = new Float32Array(requiredFrames);
      expandedLeft.set(left);
      expandedRight.set(right);
      left = expandedLeft;
      right = expandedRight;
    }

    const previousOverlap = index > 0 ? Math.min(transitionFrames, alignedFrames, entry.startFrames) : 0;
    const nextOverlap = index < geometry.entries.length - 1 ? Math.min(transitionFrames, alignedFrames) : 0;
    const sourceLeft = track.channels[0];
    const sourceRight = track.channels[1] ?? sourceLeft;
    for (let frame = 0; frame < alignedFrames; frame += 1) {
      const sourceFrame = frame - leadingSilence + sourceOffset;
      if (sourceFrame < 0 || sourceFrame >= sourceFrames) continue;
      let gain = 1;
      if (previousOverlap && frame < previousOverlap) gain *= equalPowerGains(frame / previousOverlap)[1];
      if (nextOverlap && frame >= alignedFrames - nextOverlap) gain *= equalPowerGains((frame - (alignedFrames - nextOverlap)) / nextOverlap)[0];
      left[frame] += sourceLeft[sourceFrame] * gain;
      right[frame] += sourceRight[sourceFrame] * gain;
    }
    track.channels.length = 0;
  }

  await flushTo(geometry.durationFrames);
}
