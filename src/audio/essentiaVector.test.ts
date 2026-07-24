import { describe, expect, it, vi } from "vitest";
import { consumeEssentiaVector, disposeEssentiaVector, essentiaVectorToNumbers } from "./essentiaVector";

describe("Essentia vector conversion", () => {
  it("reads normal arrays and typed arrays", () => {
    expect(essentiaVectorToNumbers([0.1, 0.2])).toEqual([0.1, 0.2]);
    expect(essentiaVectorToNumbers(Float32Array.from([0.25, 0.5]))).toEqual([0.25, 0.5]);
  });

  it("reads and releases Embind VectorFloat values", () => {
    const remove = vi.fn();
    const vector = {
      size: () => 3,
      get: (index: number) => [0.325, 0.675, 1.025][index],
      delete: remove
    };
    expect(consumeEssentiaVector(vector)).toEqual([0.325, 0.675, 1.025]);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("does not attempt to release JavaScript-owned arrays", () => {
    expect(() => disposeEssentiaVector([1, 2, 3])).not.toThrow();
    expect(essentiaVectorToNumbers({ size: () => -1, get: () => 0 })).toEqual([]);
  });
});
