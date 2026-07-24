export type UiFontMode = "bitmap" | "system";

const INTEGER_DPR_TOLERANCE = 0.001;

export function uiFontModeForDevicePixelRatio(devicePixelRatio: number): UiFontMode {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return "bitmap";
  return Math.abs(devicePixelRatio - Math.round(devicePixelRatio)) <= INTEGER_DPR_TOLERANCE
    ? "bitmap"
    : "system";
}
