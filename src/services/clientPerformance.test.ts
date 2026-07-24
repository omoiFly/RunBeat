import { describe, expect, it } from "vitest";
import { maximumInMemoryRenderBytes, recommendedAnalysisConcurrency, recommendedRenderConcurrency } from "./clientPerformance";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

describe("adaptive analysis concurrency", () => {
  it("uses more Essentia workers on high-performance clients", () => {
    expect(recommendedAnalysisConcurrency(12, 20 * MIB, {
      hardwareConcurrency: 12,
      deviceMemoryGb: 8
    })).toBe(6);
    expect(recommendedAnalysisConcurrency(20, 20 * MIB, {
      hardwareConcurrency: 16,
      deviceMemoryGb: 8
    })).toBe(8);
  });

  it("uses about half the logical cores on a typical client", () => {
    expect(recommendedAnalysisConcurrency(12, 20 * MIB, {
      hardwareConcurrency: 8,
      deviceMemoryGb: 8
    })).toBe(4);
  });

  it("reduces analysis concurrency for constrained clients", () => {
    expect(recommendedAnalysisConcurrency(8, 20 * MIB, {
      hardwareConcurrency: 2,
      deviceMemoryGb: 8
    })).toBe(1);
    expect(recommendedAnalysisConcurrency(8, 20 * MIB, {
      hardwareConcurrency: 12,
      deviceMemoryGb: 2
    })).toBe(1);
  });

  it("limits parallel decoding for unusually large files", () => {
    const profile = { hardwareConcurrency: 12, deviceMemoryGb: 8 };
    expect(recommendedAnalysisConcurrency(8, 60 * MIB, profile)).toBe(3);
    expect(recommendedAnalysisConcurrency(8, 72 * MIB, profile)).toBe(2);
    expect(recommendedAnalysisConcurrency(8, 120 * MIB, profile)).toBe(1);
  });

  it("uses CPU capacity conservatively when device memory is unavailable", () => {
    expect(recommendedAnalysisConcurrency(12, 20 * MIB, {
      hardwareConcurrency: 12
    })).toBe(6);
    expect(recommendedAnalysisConcurrency(8, 20 * MIB, {
      hardwareConcurrency: 8
    })).toBe(4);
  });

  it("never creates more workers than tracks", () => {
    expect(recommendedAnalysisConcurrency(3, 20 * MIB, {
      hardwareConcurrency: 16,
      deviceMemoryGb: 8
    })).toBe(3);
  });
});

describe("adaptive render concurrency", () => {
  it("uses up to four workers on a high-performance client", () => {
    expect(recommendedRenderConcurrency(12, 200 * MIB, {
      hardwareConcurrency: 16,
      deviceMemoryGb: 16
    })).toBe(4);
  });

  it("leaves capacity for the UI on a typical client", () => {
    expect(recommendedRenderConcurrency(12, 200 * MIB, {
      hardwareConcurrency: 8,
      deviceMemoryGb: 8
    })).toBe(3);
  });

  it("falls back to one worker on low-memory or dual-core clients", () => {
    expect(recommendedRenderConcurrency(8, 100 * MIB, {
      hardwareConcurrency: 2,
      deviceMemoryGb: 8
    })).toBe(1);
    expect(recommendedRenderConcurrency(8, 100 * MIB, {
      hardwareConcurrency: 12,
      deviceMemoryGb: 2
    })).toBe(1);
  });

  it("reduces parallelism as the project working set grows", () => {
    const profile = { hardwareConcurrency: 16, deviceMemoryGb: 16 };
    expect(recommendedRenderConcurrency(8, 600 * MIB, profile)).toBe(2);
    expect(recommendedRenderConcurrency(8, 1.1 * GIB, profile)).toBe(1);
  });

  it("never creates more workers than tracks", () => {
    expect(recommendedRenderConcurrency(2, 100, {
      hardwareConcurrency: 16,
      deviceMemoryGb: 16
    })).toBe(2);
    expect(recommendedRenderConcurrency(1, 100, {
      hardwareConcurrency: 16,
      deviceMemoryGb: 16
    })).toBe(1);
  });

  it("switches to chunked rendering earlier on memory-constrained clients", () => {
    expect(maximumInMemoryRenderBytes({ deviceMemoryGb: 2 })).toBe(128 * MIB);
    expect(maximumInMemoryRenderBytes({ deviceMemoryGb: 4 })).toBe(256 * MIB);
    expect(maximumInMemoryRenderBytes({ deviceMemoryGb: 8 })).toBe(512 * MIB);
    expect(maximumInMemoryRenderBytes({ deviceMemoryGb: 16 })).toBe(768 * MIB);
  });
});
