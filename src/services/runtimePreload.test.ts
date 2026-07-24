import { afterEach, describe, expect, it } from "vitest";
import {
  prefetchFfmpegRuntime,
  prefetchRubberBandRuntime,
  shouldPrefetchFfmpeg,
  shouldPrefetchRubberBand
} from "./runtimePreload";

function runtimeLinks(): HTMLLinkElement[] {
  return Array.from(document.head.querySelectorAll("link[data-runbeat-runtime-prefetch]"));
}

afterEach(() => {
  runtimeLinks().forEach((link) => link.remove());
});

describe("runtime asset prefetch policy", () => {
  it("prefetches Rubber Band broadly but respects explicit data saving", () => {
    expect(shouldPrefetchRubberBand({ effectiveType: "3g" })).toBe(true);
    expect(shouldPrefetchRubberBand({ saveData: true, effectiveType: "4g" })).toBe(false);
  });

  it("keeps the large FFmpeg core off constrained connections", () => {
    expect(shouldPrefetchFfmpeg({ effectiveType: "4g", downlinkMbps: 10 })).toBe(true);
    expect(shouldPrefetchFfmpeg({ effectiveType: "3g", downlinkMbps: 3 })).toBe(false);
    expect(shouldPrefetchFfmpeg({ effectiveType: "4g", downlinkMbps: 2 })).toBe(false);
    expect(shouldPrefetchFfmpeg({ saveData: true, effectiveType: "4g", downlinkMbps: 10 })).toBe(false);
  });

  it("starts FFmpeg early after an explicit video request while respecting Save-Data", () => {
    expect(prefetchFfmpegRuntime({ effectiveType: "3g", downlinkMbps: 3 }, true)).toBe(true);
    runtimeLinks().forEach((link) => link.remove());
    expect(prefetchFfmpegRuntime({ saveData: true, effectiveType: "4g", downlinkMbps: 10 }, true)).toBe(false);
  });

  it("adds low-priority, de-duplicated runtime links", () => {
    expect(prefetchRubberBandRuntime({ effectiveType: "4g", downlinkMbps: 10 })).toBe(true);
    expect(prefetchRubberBandRuntime({ effectiveType: "4g", downlinkMbps: 10 })).toBe(true);
    expect(prefetchFfmpegRuntime({ effectiveType: "4g", downlinkMbps: 10 })).toBe(true);

    const links = runtimeLinks();
    expect(links).toHaveLength(4);
    expect(links.every((link) => link.rel === "prefetch")).toBe(true);
    expect(links.every((link) => link.getAttribute("fetchpriority") === "low")).toBe(true);
    expect(links.filter((link) => link.as === "fetch").every((link) => link.type === "application/wasm")).toBe(true);
  });
});
