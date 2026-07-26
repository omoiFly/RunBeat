import type { Track } from "../domain/types";
import { isTempoChangeWithinRange } from "../domain/tempoChange";

type SelectionTrack = Pick<Track, "edit" | "derivedAnalysis">;

export const MAX_EXPORT_TRACKS = 50;

/**
 * 根据当前变速范围计算一次性的默认选择。
 *
 * 这个结果适合在分析完成或用户主动“按范围重新选择”时写入
 * `track.edit.exportEnabled`，不应在每次渲染时覆盖显式选择。
 */
export function defaultExportEnabled(
  track: Pick<Track, "derivedAnalysis">,
  maxTempoChangePercent: number
): boolean {
  const tempoChangePercent = track.derivedAnalysis?.tempoChangePercent;
  return tempoChangePercent !== undefined
    && isTempoChangeWithinRange(tempoChangePercent, maxTempoChangePercent);
}

/**
 * 读取歌曲的最终导出选择，并兼容尚未迁移的 inclusionMode 数据。
 * 显式 exportEnabled 永远优先，只有旧 auto/缺失数据才按范围计算。
 */
export function resolveExportEnabled(
  track: SelectionTrack,
  maxTempoChangePercent: number
): boolean {
  if (typeof track.edit.exportEnabled === "boolean") return track.edit.exportEnabled;
  if (track.edit.inclusionMode === "include") return true;
  if (track.edit.inclusionMode === "exclude") return false;
  return defaultExportEnabled(track, maxTempoChangePercent);
}
