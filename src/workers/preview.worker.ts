/// <reference lib="webworker" />
import { RubberBandOfflineSession } from "../audio/rubberBand";
import { stretchChannels } from "../audio/stretch";
import type { PreviewWorkerCommand, PreviewWorkerEvent } from "./previewProtocol";

const context: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
let sessionId = "";
let channels: Float32Array[] = [];
let sampleRate = 44_100;
let activeRenderId = 0;
let activeSession: RubberBandOfflineSession | undefined;
let fallbackChannels: Float32Array[] | undefined;
let fallbackOffset = 0;
let chunkFrames = 0;
let outputOffset = 0;

function emit(event: PreviewWorkerEvent, transfer: Transferable[] = []): void {
  context.postMessage(event, transfer);
}

function yieldToCommands(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function disposeRender(): void {
  activeSession?.dispose();
  activeSession = undefined;
  fallbackChannels = undefined;
  fallbackOffset = 0;
  outputOffset = 0;
}

async function startRender(command: Extract<PreviewWorkerCommand, { kind: "start" }>): Promise<void> {
  const token = command.renderId;
  activeRenderId = token;
  disposeRender();
  chunkFrames = Math.max(1, command.chunkFrames);
  try {
    try {
      const session = await RubberBandOfflineSession.create(
        channels,
        sampleRate,
        command.timeRatio,
        command.startFrame,
        command.endFrame
      );
      if (token !== activeRenderId) {
        session.dispose();
        return;
      }
      activeSession = session;
      while (!session.studyNext(24)) {
        await yieldToCommands();
        if (token !== activeRenderId) {
          session.dispose();
          if (activeSession === session) activeSession = undefined;
          return;
        }
      }
      emit({
        kind: "ready",
        sessionId,
        renderId: token,
        outputFrames: session.expectedOutputFrames,
        fallback: false
      });
    } catch (error) {
      if (token !== activeRenderId) return;
      console.warn("Rubber Band preview unavailable; using overlap-add fallback", error);
      const start = Math.max(0, Math.min(command.startFrame, command.endFrame));
      const end = Math.max(start, command.endFrame);
      const clipped = channels.map((channel) => channel.slice(start, end));
      fallbackChannels = stretchChannels(clipped, command.timeRatio);
      emit({
        kind: "ready",
        sessionId,
        renderId: token,
        outputFrames: fallbackChannels[0]?.length ?? 0,
        fallback: true
      });
    }
  } catch (error) {
    if (token !== activeRenderId) return;
    emit({
      kind: "failed",
      sessionId,
      renderId: token,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function nextChunk(command: Extract<PreviewWorkerCommand, { kind: "next" }>): void {
  if (command.renderId !== activeRenderId) return;
  try {
    let next: Float32Array[] | undefined;
    if (activeSession) {
      next = activeSession.renderNext(chunkFrames);
    } else if (fallbackChannels) {
      const end = Math.min(fallbackChannels[0]?.length ?? 0, fallbackOffset + chunkFrames);
      if (end > fallbackOffset) {
        next = fallbackChannels.map((channel) => channel.slice(fallbackOffset, end));
        fallbackOffset = end;
      }
    }
    if (!next?.length || !next[0].length) return;
    const startFrame = outputOffset;
    outputOffset += next[0].length;
    const totalFrames = activeSession?.expectedOutputFrames ?? fallbackChannels?.[0]?.length ?? outputOffset;
    const final = outputOffset >= totalFrames;
    emit({
      kind: "chunk",
      sessionId,
      renderId: command.renderId,
      startFrame,
      channels: next,
      final
    }, next.map((channel) => channel.buffer));
    if (final) disposeRender();
  } catch (error) {
    emit({
      kind: "failed",
      sessionId,
      renderId: command.renderId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

context.onmessage = ({ data }: MessageEvent<PreviewWorkerCommand>) => {
  if (data.kind === "initialize") {
    disposeRender();
    sessionId = data.sessionId;
    channels = data.channels;
    sampleRate = data.sampleRate;
    emit({ kind: "initialized", sessionId });
    return;
  }
  if (data.sessionId !== sessionId) return;
  if (data.kind === "start") {
    void startRender(data);
    return;
  }
  nextChunk(data);
};
