import ffmpegCoreUrl from "@ffmpeg/core?url";
import ffmpegWasmUrl from "@ffmpeg/core/wasm?url";
import rubberBandModuleUrl from "../assets/wasm/rubberband.js?url";
import rubberBandWasmUrl from "../assets/wasm/rubberband.wasm?url";

export interface RuntimeNetworkProfile {
  saveData?: boolean;
  effectiveType?: string;
  downlinkMbps?: number;
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
}

function currentNetworkProfile(): RuntimeNetworkProfile {
  if (typeof navigator === "undefined") return {};
  const connection = (navigator as Navigator & {
    connection?: NetworkInformationLike;
  }).connection;
  return {
    saveData: connection?.saveData,
    effectiveType: connection?.effectiveType,
    downlinkMbps: connection?.downlink
  };
}

export function shouldPrefetchRubberBand(profile: RuntimeNetworkProfile): boolean {
  return profile.saveData !== true;
}

export function shouldPrefetchFfmpeg(profile: RuntimeNetworkProfile): boolean {
  if (profile.saveData) return false;
  if (profile.effectiveType && profile.effectiveType !== "4g") return false;
  if (
    profile.downlinkMbps != null
    && Number.isFinite(profile.downlinkMbps)
    && profile.downlinkMbps < 5
  ) return false;
  return true;
}

function appendPrefetch(url: string, destination: "script" | "fetch", type?: string): void {
  if (typeof document === "undefined") return;
  const absoluteUrl = new URL(url, document.baseURI).href;
  const existing = Array.from(document.head.querySelectorAll<HTMLLinkElement>("link[data-runbeat-runtime-prefetch]"))
    .some((link) => link.href === absoluteUrl);
  if (existing) return;

  const link = document.createElement("link");
  link.rel = "prefetch";
  link.href = absoluteUrl;
  link.as = destination;
  if (type) link.type = type;
  link.dataset.runbeatRuntimePrefetch = "true";
  link.setAttribute("fetchpriority", "low");
  document.head.append(link);
}

/**
 * Rubber Band is small enough to cache while songs are being decoded and
 * analyzed, avoiding a network pause before the first processed preview.
 */
export function prefetchRubberBandRuntime(
  profile: RuntimeNetworkProfile = currentNetworkProfile()
): boolean {
  if (!shouldPrefetchRubberBand(profile)) return false;
  appendPrefetch(rubberBandModuleUrl, "script");
  appendPrefetch(rubberBandWasmUrl, "fetch", "application/wasm");
  return true;
}

/**
 * FFmpeg's core is much larger. Only offer it to the browser as a low-priority
 * prefetch on fast, non-metered connections; constrained connections keep the
 * existing on-demand path so analysis retains the available bandwidth. Once a
 * user explicitly selects a video cover, start it on slower links too, while
 * still honoring Save-Data.
 */
export function prefetchFfmpegRuntime(
  profile: RuntimeNetworkProfile = currentNetworkProfile(),
  userRequested = false
): boolean {
  if (profile.saveData || (!userRequested && !shouldPrefetchFfmpeg(profile))) return false;
  appendPrefetch(ffmpegCoreUrl, "script");
  appendPrefetch(ffmpegWasmUrl, "fetch", "application/wasm");
  return true;
}
