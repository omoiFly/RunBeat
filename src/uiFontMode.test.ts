import { describe, expect, it } from "vitest";
import { uiFontModeForDevicePixelRatio } from "./uiFontMode";

describe("UI font mode", () => {
  it.each([1, 2, 3, 0.999_999, 2.000_001])(
    "keeps the bitmap font at integer DPR %s",
    (devicePixelRatio) => {
      expect(uiFontModeForDevicePixelRatio(devicePixelRatio)).toBe("bitmap");
    }
  );

  it.each([1.1, 1.25, 1.5, 1.75, 2.5])(
    "uses system vector fonts at fractional DPR %s",
    (devicePixelRatio) => {
      expect(uiFontModeForDevicePixelRatio(devicePixelRatio)).toBe("system");
    }
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "uses the safe bitmap default for invalid DPR %s",
    (devicePixelRatio) => {
      expect(uiFontModeForDevicePixelRatio(devicePixelRatio)).toBe("bitmap");
    }
  );
});
