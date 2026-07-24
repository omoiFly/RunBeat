/// <reference lib="webworker" />
import { stretchChannels } from "../audio/stretch";
import { rubberBandStretchChannels } from "../audio/rubberBand";

type Command = { kind: "stretch"; jobId: string; channels: Float32Array[]; timeRatio: number; sampleRate: number };
type Event = { kind: "complete"; jobId: string; channels: Float32Array[] } | { kind: "failed"; jobId: string; error: string };
const context: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

context.onmessage = async ({ data }: MessageEvent<Command>) => {
  try {
    let channels: Float32Array[];
    try {
      channels = await rubberBandStretchChannels(data.channels, data.sampleRate, data.timeRatio);
    } catch (error) {
      console.warn("Rubber Band WASM unavailable; using overlap-add fallback", error);
      channels = stretchChannels(data.channels, data.timeRatio);
    }
    const event: Event = { kind: "complete", jobId: data.jobId, channels };
    context.postMessage(event, channels.map((channel) => channel.buffer));
  } catch (error) {
    const event: Event = { kind: "failed", jobId: data.jobId, error: error instanceof Error ? error.message : String(error) };
    context.postMessage(event);
  }
};
