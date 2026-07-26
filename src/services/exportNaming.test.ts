import { describe, expect, it } from "vitest";
import { exportBaseName, exportBeatDescriptor, safeExportTitle } from "./exportNaming";

describe("export naming", () => {
  it("uses the readable project title and Chinese beat state in the exported base name", () => {
    expect(exportBaseName("周二间歇跑", 180, 3_600, true, "zh-CN")).toBe("周二间歇跑_180SPM_60min_带节拍");
    expect(exportBaseName("周二间歇跑", 180, 3_600, false, "zh-CN")).toBe("周二间歇跑_180SPM_60min_不带节拍");
  });

  it("uses an English beat state for English exports", () => {
    expect(exportBeatDescriptor(true, "en")).toBe("with-beat");
    expect(exportBeatDescriptor(false, "en")).toBe("without-beat");
  });

  it("removes unsafe filename characters and falls back for an empty title", () => {
    expect(safeExportTitle("  晨跑 / 5K:*?  ")).toBe("晨跑 _ 5K_");
    expect(safeExportTitle(" . ")).toBe("RunBeat");
  });

  it("limits very long titles without splitting Unicode characters", () => {
    expect([...safeExportTitle("跑".repeat(100))]).toHaveLength(80);
  });
});
