export type PreviewWorkerCommand =
  | {
      kind: "initialize";
      sessionId: string;
      channels: Float32Array[];
      sampleRate: number;
    }
  | {
      kind: "start";
      sessionId: string;
      renderId: number;
      startFrame: number;
      endFrame: number;
      timeRatio: number;
      chunkFrames: number;
    }
  | {
      kind: "next";
      sessionId: string;
      renderId: number;
    };

export type PreviewWorkerEvent =
  | {
      kind: "initialized";
      sessionId: string;
    }
  | {
      kind: "ready";
      sessionId: string;
      renderId: number;
      outputFrames: number;
      fallback: boolean;
    }
  | {
      kind: "chunk";
      sessionId: string;
      renderId: number;
      startFrame: number;
      channels: Float32Array[];
      final: boolean;
    }
  | {
      kind: "failed";
      sessionId: string;
      renderId?: number;
      error: string;
    };
