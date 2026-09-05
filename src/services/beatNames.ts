export const MAX_BEAT_NAME_LENGTH = 80;

export function beatNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function defaultBeatName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim().slice(0, MAX_BEAT_NAME_LENGTH) || "Beat";
}

export function uniqueBeatName(base: string, usedKeys: Set<string>): string {
  let name = base;
  for (let number = 2; usedKeys.has(beatNameKey(name)); number++) {
    const suffix = ` (${number})`;
    name = `${base.slice(0, MAX_BEAT_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
  }
  return name;
}

export function validateBeatName(requested: string): string {
  const name = requested.trim();
  if (!name) throw new Error("请输入鼓点名称。");
  if (name.length > MAX_BEAT_NAME_LENGTH) throw new Error("鼓点名称不能超过 80 个字符。");
  return name;
}
