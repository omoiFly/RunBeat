import { sanitizeFlacForWebAudio } from "./flac";
import { decodeAudioToWav } from "./ffmpeg";

export interface DecodedAudio {
  channels: Float32Array[];
  mono: Float32Array;
  sampleRate: number;
  duration: number;
}

export interface DecodeFileOptions {
  /** Preview/export need channel PCM; analysis can build mono directly. */
  createChannels?: boolean;
  /** Analysis needs mono PCM; preview and export can skip this extra allocation. */
  createMono?: boolean;
}

let decodeContext: AudioContext | undefined;

function decodedAudio(buffer: AudioBuffer, options: DecodeFileOptions): DecodedAudio {
  const sourceChannels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, index) => buffer.getChannelData(index));
  const channels = options.createChannels === false
    ? []
    : sourceChannels.map((channel) => new Float32Array(channel));
  if (options.createChannels !== false && channels.length === 1) channels.push(new Float32Array(channels[0]));
  const mono = options.createMono === false ? new Float32Array(0) : new Float32Array(buffer.length);
  if (options.createMono !== false) {
    if (sourceChannels.length === 1) mono.set(sourceChannels[0]);
    else for (let i = 0; i < buffer.length; i += 1) mono[i] = (sourceChannels[0][i] + sourceChannels[1][i]) / 2;
  }
  return { channels, mono, sampleRate: buffer.sampleRate, duration: buffer.duration };
}

export async function decodeFile(file: File, options: DecodeFileOptions = {}): Promise<DecodedAudio> {
  decodeContext ??= new AudioContext({ sampleRate: 44100 });
  const prepared = sanitizeFlacForWebAudio(await file.arrayBuffer());
  try {
    return decodedAudio(await decodeContext.decodeAudioData(prepared.audioData), options);
  } catch (nativeError) {
    if (!prepared.isFlac) throw nativeError;
    try {
      const wav = await decodeAudioToWav(file, {
        channels: options.createChannels === false ? 1 : 2,
        sampleRate: 44_100
      });
      return decodedAudio(await decodeContext.decodeAudioData(wav), options);
    } catch (fallbackError) {
      const detail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`无法解码 ${file.name}；浏览器和 FFmpeg 均无法读取该 FLAC：${detail}`, { cause: fallbackError });
    }
  }
}
