import { describe, expect, it } from "vitest";
import { createProject, type Track } from "../domain/types";
import { defaultExportEnabled, resolveExportEnabled } from "./exportSelection";
import { isTrackIncluded, renderChunkedContinuousWav, renderProject } from "./render";
import { projectTimelineGeometry } from "./renderEstimate";

function makeTrack(
  change: number,
  options: { exportEnabled?: boolean; inclusionMode?: Track["edit"]["inclusionMode"] } = {}
): Track {
  return {
    id: "track-1",
    source: {
      id: "track-1",
      fileName: "track.wav",
      fileSize: 1,
      mimeType: "audio/wav",
      lastModified: 1,
      available: true
    },
    durationSeconds: 60,
    status: "complete",
    edit: { ...options, sourceInSeconds: 0, sourceOutSeconds: 60, phaseNudgeBeats: 0 },
    order: 0,
    derivedAnalysis: {
      normalizedBpm: 160,
      detectorOctaveFactor: 1,
      stepsPerBeat: 1,
      effectiveFactor: 1,
      targetSpm: 180,
      tempoRatio: 1 + change / 100,
      timeRatio: 1 / (1 + change / 100),
      tempoChangePercent: change,
      phaseOffsetSeconds: 0,
      quality: "not-recommended",
      warnings: []
    }
  };
}

describe("export selection", () => {
  it("uses a stricter slowdown limit than speed-up limit", () => {
    const project = { ...createProject(), maxTempoChangePercent: 15 as const };
    expect(defaultExportEnabled(makeTrack(-15), project.maxTempoChangePercent)).toBe(true);
    expect(defaultExportEnabled(makeTrack(-15.1), project.maxTempoChangePercent)).toBe(false);
    expect(defaultExportEnabled(makeTrack(20), project.maxTempoChangePercent)).toBe(true);
    expect(defaultExportEnabled(makeTrack(20.1), project.maxTempoChangePercent)).toBe(false);
  });

  it("accepts up to thirty-percent speed-up in the most permissive finite range", () => {
    const project = { ...createProject(), maxTempoChangePercent: 20 as const };
    expect(defaultExportEnabled(makeTrack(-20), project.maxTempoChangePercent)).toBe(true);
    expect(defaultExportEnabled(makeTrack(-20.1), project.maxTempoChangePercent)).toBe(false);
    expect(defaultExportEnabled(makeTrack(30), project.maxTempoChangePercent)).toBe(true);
    expect(defaultExportEnabled(makeTrack(30.1), project.maxTempoChangePercent)).toBe(false);
  });

  it("migrates legacy include, exclude and auto values", () => {
    expect(resolveExportEnabled(makeTrack(30, { inclusionMode: "include" }), 6)).toBe(true);
    expect(resolveExportEnabled(makeTrack(2, { inclusionMode: "exclude" }), 6)).toBe(false);
    expect(resolveExportEnabled(makeTrack(5, { inclusionMode: "auto" }), 6)).toBe(true);
    expect(resolveExportEnabled(makeTrack(11, { inclusionMode: "auto" }), 6)).toBe(false);
    expect(resolveExportEnabled(makeTrack(5), 6)).toBe(true);
  });

  it("keeps an explicit selection authoritative when the threshold changes", () => {
    const selected = makeTrack(30, { exportEnabled: true, inclusionMode: "exclude" });
    const unselected = makeTrack(2, { exportEnabled: false, inclusionMode: "include" });
    const strictProject = { ...createProject(), maxTempoChangePercent: 4 as const };
    expect(resolveExportEnabled(selected, 4)).toBe(true);
    expect(resolveExportEnabled(selected, 100)).toBe(true);
    expect(resolveExportEnabled(unselected, 4)).toBe(false);
    expect(resolveExportEnabled(unselected, 100)).toBe(false);
    expect(isTrackIncluded(selected, strictProject)).toBe(true);
    expect(isTrackIncluded(unselected, strictProject)).toBe(false);
  });

  it("never renders failed or underived tracks even if selected", () => {
    const project = createProject();
    const selected = makeTrack(2, { exportEnabled: true });
    expect(isTrackIncluded({ ...selected, status: "failed" }, project)).toBe(false);
    expect(isTrackIncluded({ ...selected, derivedAnalysis: undefined }, project)).toBe(false);
  });

  it("reports an actionable error when no checked track is renderable", async () => {
    const project = createProject();
    await expect(renderProject(project, () => undefined)).rejects.toThrow("没有勾选可导出的歌曲");
  });

  it("requires a session copy of a selected custom beat sample", async () => {
    const project = createProject();
    project.beatTrack.sound = "custom";
    await expect(renderProject(project, () => undefined)).rejects.toThrow("重新上传");
  });

  it("does not require a custom beat sample when the export omits the beat track", async () => {
    const project = createProject();
    project.beatTrack.sound = "custom";
    project.exportSettings.includeBeat = false;
    await expect(renderProject(project, () => undefined)).rejects.toThrow("没有勾选可导出的歌曲");
  });

  it("does not silently skip a checked track that cannot be rendered", async () => {
    const project = createProject();
    const failed = { ...makeTrack(2, { exportEnabled: true }), status: "failed" as const };
    await expect(renderProject({ ...project, tracks: [failed] }, () => undefined)).rejects.toThrow("分析失败");
    const missing = { ...makeTrack(2, { exportEnabled: true }), status: "missing" as const, source: { ...failed.source, available: false } };
    await expect(renderProject({ ...project, tracks: [missing] }, () => undefined)).rejects.toThrow("需要重新关联原始文件");
  });

  it("renders the two-pass low-memory path as chunked WAV", async () => {
    const project = createProject();
    project.exportSettings.includeBeat = true;
    project.exportSettings.format = "wav";
    const geometry = projectTimelineGeometry([], project, 1);
    const messages: string[] = [];
    const blob = await renderChunkedContinuousWav([], geometry, project, undefined, "test-job", (progress) => {
      messages.push(progress.message);
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(blob.size).toBe(44 + geometry.durationFrames * 2 * 2);
    expect(messages).toContain("第一遍：测量整条时间线响度与真峰值");
    expect(messages).toContain("第二遍：分块混音并写入 WAV");
  });

  it("does not synthesize a beat-only file when the beat track is disabled", async () => {
    const project = createProject();
    project.exportSettings.includeBeat = false;
    const geometry = projectTimelineGeometry([], project, 1);
    await expect(renderChunkedContinuousWav([], geometry, project, undefined, "test-job", () => undefined))
      .rejects.toThrow("时间线中没有可渲染歌曲");
  });
});
