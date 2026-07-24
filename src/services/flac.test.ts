import { describe, expect, it } from "vitest";
import { sanitizeFlacForWebAudio } from "./flac";

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function picturePayload(mediaType: string): number[] {
  const mediaTypeBytes = Array.from(new TextEncoder().encode(mediaType));
  const image = [0xff, 0xd8, 0xff, 0xd9];
  return [
    ...uint32(3),
    ...uint32(mediaTypeBytes.length), ...mediaTypeBytes,
    ...uint32(0),
    ...uint32(100), ...uint32(100), ...uint32(24), ...uint32(0),
    ...uint32(image.length), ...image
  ];
}

function flacWithPicture(mediaType: string): ArrayBuffer {
  const picture = picturePayload(mediaType);
  return new Uint8Array([
    0x66, 0x4c, 0x61, 0x43,
    0x00, 0x00, 0x00, 0x22, ...new Array(34).fill(0),
    0x86, (picture.length >>> 16) & 0xff, (picture.length >>> 8) & 0xff, picture.length & 0xff,
    ...picture,
    0xff, 0xf8, 0x69, 0x00
  ]).buffer;
}

describe("sanitizeFlacForWebAudio", () => {
  it("turns a picture with an empty media type into same-size padding", () => {
    const input = flacWithPicture("");
    const originalLength = input.byteLength;
    const result = sanitizeFlacForWebAudio(input);
    const bytes = new Uint8Array(result.audioData);

    expect(result).toMatchObject({ isFlac: true, ignoredPictureCount: 1 });
    expect(result.audioData).toBe(input);
    expect(result.audioData.byteLength).toBe(originalLength);
    expect(bytes[42]).toBe(0x81);
    expect(bytes.slice(46, -4).every((byte) => byte === 0)).toBe(true);
    expect(Array.from(bytes.slice(-4))).toEqual([0xff, 0xf8, 0x69, 0x00]);
  });

  it("preserves a structurally valid embedded picture", () => {
    const input = flacWithPicture("image/jpeg");
    const before = new Uint8Array(input).slice();
    const result = sanitizeFlacForWebAudio(input);

    expect(result).toMatchObject({ isFlac: true, ignoredPictureCount: 0 });
    expect(new Uint8Array(result.audioData)).toEqual(before);
  });

  it("leaves non-FLAC audio untouched", () => {
    const input = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer;
    expect(sanitizeFlacForWebAudio(input)).toEqual({ audioData: input, isFlac: false, ignoredPictureCount: 0 });
  });

  it("does not modify an incomplete metadata chain", () => {
    const input = flacWithPicture("");
    const bytes = new Uint8Array(input);
    bytes[42] &= 0x7f;
    const before = bytes.slice();

    const result = sanitizeFlacForWebAudio(input);

    expect(result).toMatchObject({ isFlac: true, ignoredPictureCount: 0 });
    expect(new Uint8Array(result.audioData)).toEqual(before);
  });
});
