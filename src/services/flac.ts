const FLAC_MARKER = [0x66, 0x4c, 0x61, 0x43] as const;
const METADATA_TYPE_PADDING = 1;
const METADATA_TYPE_PICTURE = 6;

export interface FlacSanitizationResult {
  audioData: ArrayBuffer;
  isFlac: boolean;
  ignoredPictureCount: number;
}

function readUint24(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 65_536 + bytes[offset + 1] * 256 + bytes[offset + 2];
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 16_777_216 + bytes[offset + 1] * 65_536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

function isValidPictureBlock(bytes: Uint8Array, start: number, end: number): boolean {
  let cursor = start;
  const readLength = (): number | undefined => {
    if (cursor + 4 > end) return undefined;
    const value = readUint32(bytes, cursor);
    cursor += 4;
    return value;
  };

  if (readLength() == null) return false; // Picture type.
  const mediaTypeLength = readLength();
  if (mediaTypeLength == null || mediaTypeLength === 0 || cursor + mediaTypeLength > end) return false;
  const mediaTypeBytes = bytes.subarray(cursor, cursor + mediaTypeLength);
  cursor += mediaTypeLength;
  let containsSlash = false;
  for (const byte of mediaTypeBytes) {
    if (byte < 0x20 || byte > 0x7e) return false;
    if (byte === 0x2f) containsSlash = true;
  }
  const isPictureUri = mediaTypeBytes.length === 3
    && mediaTypeBytes[0] === 0x2d
    && mediaTypeBytes[1] === 0x2d
    && mediaTypeBytes[2] === 0x3e;
  if (!isPictureUri && !containsSlash) return false;

  const descriptionLength = readLength();
  if (descriptionLength == null || cursor + descriptionLength > end) return false;
  cursor += descriptionLength;

  // Width, height, color depth, indexed color count and picture-data length.
  if (cursor + 20 > end) return false;
  cursor += 16;
  const pictureDataLength = readLength();
  return pictureDataLength != null && cursor + pictureDataLength === end;
}

/**
 * Neutralizes malformed FLAC picture metadata in the file-backed ArrayBuffer.
 * The original File is untouched and the byte length stays constant, avoiding
 * a second full-size allocation before Web Audio decoding.
 */
export function sanitizeFlacForWebAudio(audioData: ArrayBuffer): FlacSanitizationResult {
  const bytes = new Uint8Array(audioData);
  const isFlac = bytes.length >= 8 && FLAC_MARKER.every((byte, index) => bytes[index] === byte);
  if (!isFlac) return { audioData, isFlac: false, ignoredPictureCount: 0 };

  let offset = 4;
  let completeMetadataChain = false;
  const ignoredPictures: Array<{ start: number; end: number }> = [];
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const last = Boolean(header & 0x80);
    const type = header & 0x7f;
    const length = readUint24(bytes, offset + 1);
    const payloadStart = offset + 4;
    const blockEnd = payloadStart + length;
    const firstBlock = offset === 4;
    if ((firstBlock && (type !== 0 || length !== 34)) || type === 127 || blockEnd > bytes.length) {
      return { audioData, isFlac: true, ignoredPictureCount: 0 };
    }

    if (type === METADATA_TYPE_PICTURE && !isValidPictureBlock(bytes, payloadStart, blockEnd)) {
      ignoredPictures.push({ start: offset, end: blockEnd });
    }

    offset = blockEnd;
    if (last) {
      completeMetadataChain = true;
      break;
    }
  }

  if (!completeMetadataChain) return { audioData, isFlac: true, ignoredPictureCount: 0 };
  for (const picture of ignoredPictures) {
    bytes[picture.start] = (bytes[picture.start] & 0x80) | METADATA_TYPE_PADDING;
    bytes.fill(0, picture.start + 4, picture.end);
  }
  return { audioData, isFlac: true, ignoredPictureCount: ignoredPictures.length };
}
