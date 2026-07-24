const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
export const MAX_ANALYSIS_WORKERS = 8;
const MAX_RENDER_WORKERS = 4;

export interface ClientPerformanceProfile {
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
}

export function currentClientPerformanceProfile(): ClientPerformanceProfile {
  if (typeof navigator === "undefined") return {};
  const extendedNavigator = navigator as Navigator & { deviceMemory?: number };
  return {
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: extendedNavigator.deviceMemory
  };
}

function logicalCores(profile: ClientPerformanceProfile): number {
  const reported = profile.hardwareConcurrency;
  return Number.isFinite(reported) && (reported ?? 0) > 0 ? Math.floor(reported as number) : 4;
}

/**
 * Chooses independent Essentia workers. Small inputs can use half of the
 * reported logical cores, while memory and unusually large files retain
 * headroom for the decoded mono signals and per-worker WASM runtimes.
 */
export function recommendedAnalysisConcurrency(
  trackCount: number,
  largestFileBytes: number,
  profile: ClientPerformanceProfile = currentClientPerformanceProfile()
): number {
  if (trackCount <= 1) return Math.max(0, trackCount);
  const cores = logicalCores(profile);
  const cpuLimit = Math.max(1, Math.min(MAX_ANALYSIS_WORKERS, Math.ceil(cores / 2)));
  const memory = profile.deviceMemoryGb;
  const memoryLimit = memory == null || !Number.isFinite(memory)
    ? cores >= 12 ? 6 : cores >= 8 ? 4 : 2
    : memory <= 2 ? 1 : memory <= 4 ? 2 : memory < 8 ? 4 : MAX_ANALYSIS_WORKERS;
  const fileLimit = largestFileBytes >= 96 * MIB
    ? 1
    : largestFileBytes >= 64 * MIB ? 2
      : largestFileBytes >= 48 * MIB ? 3
        : largestFileBytes >= 32 * MIB ? 4
          : MAX_ANALYSIS_WORKERS;
  return Math.max(1, Math.min(trackCount, cpuLimit, memoryLimit, fileLimit, MAX_ANALYSIS_WORKERS));
}

/**
 * Chooses a conservative number of independent Rubber Band workers. The main
 * thread keeps one CPU budget for UI/mixing, while project size and approximate
 * device memory cap the extra PCM and WASM working sets.
 */
export function recommendedRenderConcurrency(
  trackCount: number,
  estimatedWorkingBytes: number,
  profile: ClientPerformanceProfile = currentClientPerformanceProfile()
): number {
  if (trackCount <= 1) return Math.max(0, trackCount);
  const cores = logicalCores(profile);
  const cpuLimit = cores <= 2 ? 1 : cores <= 4 ? 2 : cores <= 8 ? 3 : MAX_RENDER_WORKERS;

  const memory = profile.deviceMemoryGb;
  const memoryLimit = memory == null || !Number.isFinite(memory)
    ? 2
    : memory <= 2 ? 1 : memory <= 4 ? 2 : memory <= 8 ? 3 : MAX_RENDER_WORKERS;

  const projectLimit = estimatedWorkingBytes >= GIB
    ? 1
    : estimatedWorkingBytes >= GIB / 2 ? 2
      : estimatedWorkingBytes >= GIB / 4 ? 3
        : MAX_RENDER_WORKERS;

  return Math.max(1, Math.min(trackCount, cpuLimit, memoryLimit, projectLimit, MAX_RENDER_WORKERS));
}

/**
 * Above this final Float32 timeline size, exporting switches to the two-pass
 * chunked pipeline. The threshold is intentionally well below total device
 * memory because decoding, WASM and browser Blob storage need headroom too.
 */
export function maximumInMemoryRenderBytes(
  profile: ClientPerformanceProfile = currentClientPerformanceProfile()
): number {
  const memory = profile.deviceMemoryGb;
  if (memory == null || !Number.isFinite(memory)) return 256 * MIB;
  if (memory <= 2) return 128 * MIB;
  if (memory <= 4) return 256 * MIB;
  if (memory <= 8) return 512 * MIB;
  return 768 * MIB;
}
