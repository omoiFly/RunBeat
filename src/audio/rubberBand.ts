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

async function loadModule(): Promise<RubberBandModule> {
  if (!modulePromise) {
    const base = new URL("/wasm/", self.location.origin).href;
    modulePromise = import(/* @vite-ignore */ `${base}rubberband.js`).then(
      (entry: { default: RubberBandFactory }) => entry.default({ locateFile: (path) => `${base}${path}` })
    );
  }
  return modulePromise;
}

function joinChunks(chunks: Float32Array[], length: number): Float32Array {
  const result = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    const count = Math.min(chunk.length, length - offset);
    result.set(chunk.subarray(0, count), offset);
    offset += count;
    if (offset >= length) break;
  }
  return result;
}

export async function rubberBandStretchChannels(channels: Float32Array[], sampleRate: number, timeRatio: number): Promise<Float32Array[]> {
  const module = await loadModule();
  const channelCount = channels.length;
  const frames = Math.min(...channels.map((channel) => channel.length));
  const expectedOutput = Math.round(frames * timeRatio);
  const blockFrames = 8192;
  const inputPointer = module._malloc(blockFrames * channelCount * 4);
  const outputPointer = module._malloc(blockFrames * channelCount * 4);
  const state = module._runbeat_rb_create(sampleRate, channelCount, timeRatio, frames);
  const outputChunks = Array.from({ length: channelCount }, () => [] as Float32Array[]);
  const writeInput = (offset: number, count: number) => {
    const view = module.HEAPF32.subarray(inputPointer / 4, inputPointer / 4 + count * channelCount);
    for (let frame = 0; frame < count; frame += 1) for (let channel = 0; channel < channelCount; channel += 1) view[frame * channelCount + channel] = channels[channel][offset + frame];
  };
  const retrieve = () => {
    while (module._runbeat_rb_available(state) > 0) {
      const count = module._runbeat_rb_retrieve(state, outputPointer, blockFrames);
      if (count <= 0) break;
      const view = module.HEAPF32.subarray(outputPointer / 4, outputPointer / 4 + count * channelCount);
      for (let channel = 0; channel < channelCount; channel += 1) {
        const chunk = new Float32Array(count);
        for (let frame = 0; frame < count; frame += 1) chunk[frame] = view[frame * channelCount + channel];
        outputChunks[channel].push(chunk);
      }
    }
  };
  try {
    for (let offset = 0; offset < frames; offset += blockFrames) {
      const count = Math.min(blockFrames, frames - offset);
      writeInput(offset, count);
      module._runbeat_rb_study(state, inputPointer, count, offset + count >= frames ? 1 : 0);
    }
    for (let offset = 0; offset < frames; offset += blockFrames) {
      const count = Math.min(blockFrames, frames - offset);
      writeInput(offset, count);
      module._runbeat_rb_process(state, inputPointer, count, offset + count >= frames ? 1 : 0);
      retrieve();
    }
    retrieve();
    return outputChunks.map((chunks) => joinChunks(chunks, expectedOutput));
  } finally {
    module._runbeat_rb_destroy(state);
    module._free(inputPointer);
    module._free(outputPointer);
  }
}
