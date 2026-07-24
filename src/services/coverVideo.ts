const COVER_IMAGE_TYPES: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const COVER_IMAGE_EXTENSIONS: Record<string, "jpg" | "png" | "webp"> = {
  jpg: "jpg",
  jpeg: "jpg",
  png: "png",
  webp: "webp"
};

export const MAX_COVER_IMAGE_BYTES = 20 * 1024 * 1024;
export const COVER_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

export function coverImageExtension(file: Pick<File, "name" | "type">): "jpg" | "png" | "webp" | undefined {
  const mimeExtension = COVER_IMAGE_TYPES[file.type.toLowerCase()];
  if (mimeExtension) return mimeExtension;
  const sourceExtension = file.name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  return sourceExtension ? COVER_IMAGE_EXTENSIONS[sourceExtension] : undefined;
}

export function coverImageValidationError(file: Pick<File, "name" | "type" | "size">): string | undefined {
  if (file.size <= 0) return "请选择有效的封面图片。";
  if (file.size > MAX_COVER_IMAGE_BYTES) return "封面图片不能超过 20 MB。";
  if (!coverImageExtension(file)) return "请选择 JPG、PNG 或 WebP 图片。";
  return undefined;
}
