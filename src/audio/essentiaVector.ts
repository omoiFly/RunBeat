interface EmbindNumberVector {
  size(): number;
  get(index: number): unknown;
  delete?: () => void;
}

function isEmbindNumberVector(value: unknown): value is EmbindNumberVector {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as Partial<EmbindNumberVector>;
  return typeof candidate.size === "function" && typeof candidate.get === "function";
}

/** Reads arrays, typed arrays and Essentia/Embind VectorFloat results. */
export function essentiaVectorToNumbers(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>, Number);
  }
  if (!isEmbindNumberVector(value)) return [];
  const length = Number(value.size());
  if (!Number.isSafeInteger(length) || length < 0 || length > 10_000_000) return [];
  return Array.from({ length }, (_, index) => Number(value.get(index)));
}

/** Releases an Embind-owned vector without affecting plain JavaScript arrays. */
export function disposeEssentiaVector(value: unknown): void {
  if (!isEmbindNumberVector(value) || typeof value.delete !== "function") return;
  value.delete();
}

/** Reads an Essentia vector and releases its WASM-side storage afterwards. */
export function consumeEssentiaVector(value: unknown): number[] {
  try {
    return essentiaVectorToNumbers(value);
  } finally {
    disposeEssentiaVector(value);
  }
}
