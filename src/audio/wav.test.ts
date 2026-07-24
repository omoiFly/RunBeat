import { describe, expect, it, vi } from "vitest";
import { encodeWav16, Wav16BlobEncoder } from "./wav";

describe("WAV encoder", () => {
  it("writes a stereo PCM RIFF header and correct size", async () => {
    const blob = encodeWav16({ channels: [new Float32Array(100), new Float32Array(100)], sampleRate: 44_100 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WAVE");
    expect(blob.size).toBe(44 + 100 * 2 * 2);
  });

  it("writes chunked PCM without allocating a full-size output buffer", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const channels = [Float32Array.from([0, 0.25, -0.5, 0.75]), Float32Array.from([0.1, -0.2, 0.3, -0.4])];
    const expected = encodeWav16({ channels, sampleRate: 44_100 });
    const encoder = new Wav16BlobEncoder(4, 2, 44_100);
    encoder.push(channels.map((channel) => channel.slice(0, 1)));
    encoder.push(channels.map((channel) => channel.slice(1)));
    const actual = encoder.finish();
    expect(new Uint8Array(await actual.arrayBuffer())).toEqual(new Uint8Array(await expected.arrayBuffer()));
    vi.restoreAllMocks();
  });
});
