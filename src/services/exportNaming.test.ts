import { describe, expect, it } from "vitest";
import { exportBaseName, safeExportTitle } from "./exportNaming";

describe("export naming", () => {
  it("uses the readable project title in the exported base name", () => {
    expect(exportBaseName("周二间歇跑", 180, 3_600)).toBe("周二间歇跑_180SPM_60min");
  });

  it("removes unsafe filename characters and falls back for an empty title", () => {
    expect(safeExportTitle("  晨跑 / 5K:*?  ")).toBe("晨跑 _ 5K_");
    expect(safeExportTitle(" . ")).toBe("RunBeat");
  });

  it("limits very long titles without splitting Unicode characters", () => {
    expect([...safeExportTitle("跑".repeat(100))]).toHaveLength(80);
  });
});
