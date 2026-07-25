import rubberBandModuleUrl from "../assets/wasm/rubberband.js?url";
import rubberBandWasmUrl from "../assets/wasm/rubberband.wasm?url";

interface RubberBandModule {
  HEAPF32: Float32Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _runbeat_rb_create(sampleRate: number, channels: number, timeRatio: number, expectedFrames: number): number;
  _runbeat_rb_destroy(state: number): void;
  _runbeat_rb_study(state: number, input: number, frames: number, final: number): void;
  _runbeat_rb_process(state: number, input: number, frames: number, final: number): void;
  _runbeat_rb_available(state: number): number;
  _runbeat_rb_retrieve(state: number, output: number, frames: number): number;
}

type RubberBandFactory = (options?: { locateFile?: (path: string) => string }) => Promise<RubberBandModule>;
let modulePromise: Promise<RubberBandModule> | undefined;
const BLOCK_FRAMES = 8192;

async function loadModule(): Promise<RubberBandModule> {
  if (!modulePromise) {
    modulePromise = import(/* @vite-ignore */ rubberBandModuleUrl).then(
      (entry: { default: RubberBandFactory }) => entry.default({
        locateFile: (path) => path.endsWith(".wasm")
          ? rubberBandWasmUrl
          : new URL(path, rubberBandModuleUrl).href
      })
    );
  }
  return modulePromise;
}

/**
 * Stateful wrapper around Rubber Band's two-pass offline API.
 *
 * Keeping one instance alive lets preview request bounded output chunks without
 * resetting the stretch analysis at every playback boundary. The one-shot
 * export adapter below uses the same implementation.
 */
export class RubberBandOfflineSession {
  readonly expectedOutputFrames: number;
  readonly channelCount: number;

  private studyOffset = 0;
  private processOffset = 0;
  private outputOffset = 0;
  private studied = false;
  private disposed = false;

  private constructor(
    private readonly module: RubberBandModule,
    private readonly channels: Float32Array[],
    private readonly startFrame: number,
    private readonly inputFrames: number,
    private readonly state: number,
    private readonly inputPointer: number,
    private readonly outputPointer: number,
    timeRatio: number
  ) {
    this.channelCount = channels.length;
    this.expectedOutputFrames = Math.max(0, Math.round(inputFrames * timeRatio));
  }

  static async create(
    channels: Float32Array[],
    sampleRate: number,
    timeRatio: number,
    startFrame = 0,
    endFrame = Math.min(...channels.map((channel) => channel.length))
  ): Promise<RubberBandOfflineSession> {
    if (!channels.length) throw new Error("没有可变速的音频声道");
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("无效的音频采样率");
    if (!Number.isFinite(timeRatio) || timeRatio <= 0) throw new Error("无效的变速比例");
    const availableFrames = Math.min(...channels.map((channel) => channel.length));
    const firstFrame = Math.max(0, Math.min(availableFrames, Math.round(startFrame)));
    const lastFrame = Math.max(firstFrame, Math.min(availableFrames, Math.round(endFrame)));
    const inputFrames = lastFrame - firstFrame;
    if (!inputFrames) throw new Error("音频片段为空");

    const module = await loadModule();
    const channelCount = channels.length;
    const inputPointer = module._malloc(BLOCK_FRAMES * channelCount * 4);
    const outputPointer = module._malloc(BLOCK_FRAMES * channelCount * 4);
    const state = module._runbeat_rb_create(sampleRate, channelCount, timeRatio, inputFrames);
    return new RubberBandOfflineSession(
      module,
      channels,
      firstFrame,
      inputFrames,
      state,
      inputPointer,
      outputPointer,
      timeRatio
    );
  }

  /** Studies a bounded number of input blocks and returns true when complete. */
  studyNext(maxBlocks = 32): boolean {
    this.assertActive();
    if (this.studied) return true;
    let blocks = 0;
    while (this.studyOffset < this.inputFrames && blocks < Math.max(1, maxBlocks)) {
      const count = Math.min(BLOCK_FRAMES, this.inputFrames - this.studyOffset);
      this.writeInput(this.studyOffset, count);
      this.module._runbeat_rb_study(
        this.state,
        this.inputPointer,
        count,
        this.studyOffset + count >= this.inputFrames ? 1 : 0
      );
      this.studyOffset += count;
      blocks += 1;
    }
    this.studied = this.studyOffset >= this.inputFrames;
    return this.studied;
  }

  /**
   * Returns the next exact-length output block. The final block is shortened to
   * the remaining expected duration and zero-padded only if Rubber Band itself
   * produces fewer frames than promised.
   */
  renderNext(maxFrames: number): Float32Array[] | undefined {
    this.assertActive();
    if (!this.studied) throw new Error("Rubber Band 尚未完成预扫描");
    const requested = Math.min(
      Math.max(1, Math.floor(maxFrames)),
      this.expectedOutputFrames - this.outputOffset
    );
    if (requested <= 0) return undefined;

    const result = Array.from({ length: this.channelCount }, () => new Float32Array(requested));
    let written = 0;
    while (written < requested) {
      const available = this.module._runbeat_rb_available(this.state);
      if (available > 0) {
        const count = this.module._runbeat_rb_retrieve(
          this.state,
          this.outputPointer,
          Math.min(BLOCK_FRAMES, available, requested - written)
        );
        if (count <= 0) break;
        const view = this.module.HEAPF32.subarray(
          this.outputPointer / 4,
          this.outputPointer / 4 + count * this.channelCount
        );
        for (let channel = 0; channel < this.channelCount; channel += 1) {
          for (let frame = 0; frame < count; frame += 1) {
            result[channel][written + frame] = view[frame * this.channelCount + channel];
          }
        }
        written += count;
        continue;
      }
      if (this.processOffset >= this.inputFrames) break;
      const count = Math.min(BLOCK_FRAMES, this.inputFrames - this.processOffset);
      this.writeInput(this.processOffset, count);
      this.module._runbeat_rb_process(
        this.state,
        this.inputPointer,
        count,
        this.processOffset + count >= this.inputFrames ? 1 : 0
      );
      this.processOffset += count;
    }
    this.outputOffset += requested;
    return result;
  }

  get complete(): boolean {
    return this.outputOffset >= this.expectedOutputFrames;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.module._runbeat_rb_destroy(this.state);
    this.module._free(this.inputPointer);
    this.module._free(this.outputPointer);
  }

  private writeInput(offset: number, count: number): void {
    const view = this.module.HEAPF32.subarray(
      this.inputPointer / 4,
      this.inputPointer / 4 + count * this.channelCount
    );
    for (let frame = 0; frame < count; frame += 1) {
      for (let channel = 0; channel < this.channelCount; channel += 1) {
        view[frame * this.channelCount + channel] = this.channels[channel][this.startFrame + offset + frame];
      }
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Rubber Band 会话已释放");
  }
}

export async function rubberBandStretchChannels(
  channels: Float32Array[],
  sampleRate: number,
  timeRatio: number
): Promise<Float32Array[]> {
  const session = await RubberBandOfflineSession.create(channels, sampleRate, timeRatio);
  const chunks = Array.from({ length: channels.length }, () => [] as Float32Array[]);
  try {
    while (!session.studyNext()) {
      // One-shot rendering deliberately completes the study synchronously.
    }
    while (!session.complete) {
      const next = session.renderNext(BLOCK_FRAMES);
      if (!next) break;
      next.forEach((channel, index) => chunks[index].push(channel));
    }
    return chunks.map((channelChunks) => {
      const output = new Float32Array(session.expectedOutputFrames);
      let offset = 0;
      for (const chunk of channelChunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    });
  } finally {
    session.dispose();
  }
}
