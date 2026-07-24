import type { RawTrackAnalysis } from "../domain/types";

export const WORKER_PROTOCOL_VERSION = 1 as const;

export type AnalysisCommand = {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  kind: "analyze";
  jobId: string;
  trackId: string;
  pcm: Float32Array;
  sampleRate: number;
};

export type AnalysisEvent =
  | { protocolVersion: 1; kind: "progress"; jobId: string; trackId: string; stage: string; progress: number }
  | { protocolVersion: 1; kind: "complete"; jobId: string; trackId: string; analysis: RawTrackAnalysis }
  | { protocolVersion: 1; kind: "failed"; jobId: string; trackId: string; error: string };
