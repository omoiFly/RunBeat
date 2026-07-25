import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, type Track } from "../domain/types";

const serviceMocks = vi.hoisted(() => ({
  decodeFile: vi.fn(),
  getRegisteredFile: vi.fn()
}));

vi.mock("./audio", () => ({
  decodeFile: serviceMocks.decodeFile
}));

vi.mock("./files", () => ({
  getRegisteredFile: serviceMocks.getRegisteredFile
}));

class FakeAudioBuffer {
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number
  ) {
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

class FakeAudioNode {
  connectedTo?: FakeAudioNode | object;
  disconnect = vi.fn();

  connect(node: FakeAudioNode | object): FakeAudioNode | object {
    this.connectedTo = node;
    return node;
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = { value: 1 };
}

class FakeCompressorNode extends FakeAudioNode {
  threshold = { value: 0 };
  knee = { value: 0 };
  ratio = { value: 0 };
  attack = { value: 0 };
  release = { value: 0 };
}

class FakeBufferSource extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  readonly start = vi.fn<(when?: number) => void>();
  readonly stop = vi.fn<() => void>();
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 10;
  state: AudioContextState = "running";
  destination = {};
  sources: FakeBufferSource[] = [];
  gains: FakeGainNode[] = [];

  resume = vi.fn(async () => {
    this.state = "running";
  });
  suspend = vi.fn(async () => {
    this.state = "suspended";
  });

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createDynamicsCompressor(): FakeCompressorNode {
    return new FakeCompressorNode();
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  readonly messages: unknown[] = [];
  readonly terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function makeTrack(seconds = 20): Track {
  return {
    id: "track-1",
    source: {
      id: "track-1",
      fileName: "track.wav",
      fileSize: 1,
      mimeType: "audio/wav",
      lastModified: 1,
      available: true
    },
    durationSeconds: seconds,
    status: "complete",
    edit: {
      exportEnabled: true,
      sourceInSeconds: 0,
      sourceOutSeconds: seconds,
      phaseNudgeBeats: 0
    },
    order: 0,
    derivedAnalysis: {
      normalizedBpm: 180,
      detectorOctaveFactor: 1,
      stepsPerBeat: 1,
      effectiveFactor: 1,
      targetSpm: 180,
      tempoRatio: 1,
      timeRatio: 1,
      tempoChangePercent: 0,
      phaseOffsetSeconds: 0.1,
      quality: "good",
      warnings: []
    }
  };
}

async function settle(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

describe("continuous track preview", () => {
  let context: FakeAudioContext;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    context = new FakeAudioContext();
    FakeWorker.instances = [];
    const currentContext = context;
    vi.stubGlobal("AudioContext", class {
      constructor() {
        return currentContext;
      }
    });
    vi.stubGlobal("Worker", FakeWorker);
    serviceMocks.getRegisteredFile.mockReturnValue(new File(["audio"], "track.wav", { type: "audio/wav" }));
    serviceMocks.decodeFile.mockResolvedValue({
      channels: [new Float32Array(200), new Float32Array(200)],
      mono: new Float32Array(0),
      sampleRate: 10,
      duration: 20
    });
  });

  afterEach(async () => {
    const preview = await import("./preview");
    preview.stopPreview();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps scheduling original-audio chunks beyond the initial buffer until the trim out point", async () => {
    serviceMocks.decodeFile.mockResolvedValueOnce({
      channels: [new Float32Array(280), new Float32Array(280)],
      mono: new Float32Array(0),
      sampleRate: 10,
      duration: 28
    });
    const { startPreview } = await import("./preview");
    const session = startPreview(makeTrack(28), createProject("Test"), "original", 0);
    await settle();

    expect(session.getSnapshot().status).toBe("playing");
    let music = context.sources.filter((source) => source.buffer?.length === 40);
    expect(music).toHaveLength(3);
    expect(music.map((source) => source.start.mock.calls[0][0])).toEqual([0.08, 4.08, 8.08]);

    context.currentTime = 5;
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    music = context.sources.filter((source) => source.buffer?.length === 40);
    expect(music).toHaveLength(5);
    expect(music.map((source) => source.start.mock.calls[0][0])).toEqual([0.08, 4.08, 8.08, 12.08, 16.08]);

    context.currentTime = 13;
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    music = context.sources.filter((source) => source.buffer?.length === 40);
    expect(music).toHaveLength(7);
    expect(music.at(-1)?.start.mock.calls[0][0]).toBeCloseTo(24.08, 8);

    music.at(-1)?.onended?.();
    expect(session.getSnapshot()).toMatchObject({
      status: "ended",
      sourcePositionSeconds: 28,
      sourceEndSeconds: 28
    });
  });

  it("reschedules future beat nodes without touching music and rebuilds on seek", async () => {
    const project = createProject("Test");
    const { startPreview } = await import("./preview");
    const session = startPreview(makeTrack(), project, "processed-beat", 0);
    await settle();

    const worker = FakeWorker.instances[0];
    const initialize = worker.messages[0] as { sessionId: string };
    worker.emit({ kind: "initialized", sessionId: initialize.sessionId });
    const start = worker.messages.find((message) => (message as { kind?: string }).kind === "start") as {
      sessionId: string;
      renderId: number;
    };
    worker.emit({
      kind: "ready",
      sessionId: start.sessionId,
      renderId: start.renderId,
      outputFrames: 200,
      fallback: false
    });
    worker.emit({
      kind: "chunk",
      sessionId: start.sessionId,
      renderId: start.renderId,
      startFrame: 0,
      channels: [new Float32Array(40), new Float32Array(40)],
      final: false
    });
    worker.emit({
      kind: "chunk",
      sessionId: start.sessionId,
      renderId: start.renderId,
      startFrame: 40,
      channels: [new Float32Array(40), new Float32Array(40)],
      final: false
    });
    await settle();

    expect(session.getSnapshot().status).toBe("playing");
    const music = context.sources.filter((source) => source.buffer?.length === 40);
    const oldBeats = context.sources.filter((source) => source.buffer?.length === 1);
    expect(music).toHaveLength(2);
    expect(oldBeats.length).toBeGreaterThan(1);

    session.updateAlignment({ phaseOffsetSeconds: 0.2, phaseNudgeBeats: 0 });
    expect(music.every((source) => source.stop.mock.calls.length === 0)).toBe(true);
    expect(oldBeats.some((source) => source.stop.mock.calls.length > 0)).toBe(true);
    expect(context.sources.filter((source) => source.buffer?.length === 1).length).toBeGreaterThan(oldBeats.length);

    session.seek(10);
    expect(music.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    expect(session.getSnapshot()).toMatchObject({
      status: "buffering",
      sourcePositionSeconds: 10
    });
    const restart = worker.messages.filter((message) => (message as { kind?: string }).kind === "start").at(-1) as {
      startFrame: number;
      renderId: number;
    };
    expect(restart.startFrame).toBe(100);
    expect(restart.renderId).toBeGreaterThan(start.renderId);
  });
});
