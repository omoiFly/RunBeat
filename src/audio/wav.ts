export interface PcmChannels {
  channels: Float32Array[];
  sampleRate: number;
}

function wavHeader(frameCount: number, channelCount: number, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytesPerSample = 2;
  const dataBytes = frameCount * channelCount * bytesPerSample;
  if (!Number.isSafeInteger(dataBytes) || dataBytes < 1 || dataBytes > 0xffff_ffff - 36) {
    throw new Error("WAV 时长超过标准 RIFF 文件上限");
  }
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
}

function pcm16Chunk(channels: Float32Array[], frameCount: number, gain = 1): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(frameCount * channels.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      const dither = (Math.random() + Math.random() - 1) / 65536;
      const sample = Number.isFinite(channels[channel][frame]) ? channels[channel][frame] : 0;
      const value = Math.max(-1, Math.min(1, sample * gain + dither));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

/** Builds a WAV from small immutable Blob parts so long exports do not require one giant ArrayBuffer. */
export class Wav16BlobEncoder {
  private readonly parts: Blob[] = [];
  private writtenFrames = 0;

  constructor(
    private readonly frameCount: number,
    private readonly channelCount: number,
    private readonly sampleRate: number
  ) {
    wavHeader(frameCount, channelCount, sampleRate);
  }

  push(channels: Float32Array[], gain = 1): void {
    if (channels.length !== this.channelCount) throw new Error("WAV 编码期间声道数量发生变化");
    const frames = Math.min(...channels.map((channel) => channel.length));
    if (!frames) return;
    if (this.writtenFrames + frames > this.frameCount) throw new Error("WAV 实际音频长于时间线计划");
    this.parts.push(new Blob([pcm16Chunk(channels, frames, gain)]));
    this.writtenFrames += frames;
  }

  finish(): Blob {
    if (this.writtenFrames !== this.frameCount) {
      throw new Error(`WAV 实际帧数与时间线计划不一致（${this.writtenFrames} / ${this.frameCount}）`);
    }
    return new Blob([wavHeader(this.frameCount, this.channelCount, this.sampleRate), ...this.parts], { type: "audio/wav" });
  }
}

export function encodeWav16({ channels, sampleRate }: PcmChannels): Blob {
  if (!channels.length || !channels[0].length) throw new Error("没有可导出的音频");
  const frameCount = Math.min(...channels.map((channel) => channel.length));
  const channelCount = channels.length;
  return new Blob([wavHeader(frameCount, channelCount, sampleRate), pcm16Chunk(channels, frameCount)], { type: "audio/wav" });
}
