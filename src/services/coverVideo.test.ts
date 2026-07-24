import { describe, expect, it } from "vitest";
import {
  coverImageExtension,
  coverImageValidationError,
  MAX_COVER_IMAGE_BYTES
} from "./coverVideo";

describe("cover video image validation", () => {
  it("accepts supported MIME types and common JPEG extensions", () => {
    expect(coverImageExtension({ name: "cover.bin", type: "image/png" })).toBe("png");
    expect(coverImageExtension({ name: "cover.JPEG", type: "" })).toBe("jpg");
    expect(coverImageValidationError({ name: "cover.webp", type: "image/webp", size: 1024 })).toBeUndefined();
  });

  it("rejects empty, oversized, and unsupported files", () => {
    expect(coverImageValidationError({ name: "cover.png", type: "image/png", size: 0 }))
      .toBe("请选择有效的封面图片。");
    expect(coverImageValidationError({ name: "cover.png", type: "image/png", size: MAX_COVER_IMAGE_BYTES + 1 }))
      .toBe("封面图片不能超过 20 MB。");
    expect(coverImageValidationError({ name: "cover.gif", type: "image/gif", size: 1024 }))
      .toBe("请选择 JPG、PNG 或 WebP 图片。");
  });
});
