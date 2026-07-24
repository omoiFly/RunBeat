import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_NAME, type Track } from "../domain/types";
import {
  automaticProjectName,
  projectNameAfterTrackChange,
  projectNameMode,
  songTitleFromFileName
} from "./projectNaming";

function namedTrack(fileName: string): Pick<Track, "source"> {
  return {
    source: {
      id: fileName,
      fileName,
      fileSize: 1,
      mimeType: "audio/mpeg",
      lastModified: 0,
      available: true
    }
  };
}

describe("project naming", () => {
  it("uses the audio filename without its final extension", () => {
    expect(songTitleFromFileName("12_祖龙吟.mp3")).toBe("12_祖龙吟");
    expect(songTitleFromFileName("morning.run.mix.flac")).toBe("morning.run.mix");
  });

  it("adds a song count when more than one track is present", () => {
    expect(automaticProjectName([namedTrack("祖龙吟.mp3")])).toBe("祖龙吟");
    expect(automaticProjectName([namedTrack("祖龙吟.mp3"), namedTrack("破阵.wav")])).toBe("祖龙吟 等 2 首");
    expect(automaticProjectName([])).toBe(DEFAULT_PROJECT_NAME);
  });

  it("keeps a custom name when tracks change", () => {
    const tracks = [namedTrack("祖龙吟.mp3"), namedTrack("破阵.wav")];
    expect(projectNameAfterTrackChange({ name: "周末长跑", nameMode: "custom" }, tracks)).toEqual({
      name: "周末长跑",
      nameMode: "custom"
    });
  });

  it("updates automatic and legacy default names when tracks change", () => {
    const tracks = [namedTrack("祖龙吟.mp3")];
    expect(projectNameAfterTrackChange({ name: DEFAULT_PROJECT_NAME, nameMode: "auto" }, tracks)).toEqual({
      name: "祖龙吟",
      nameMode: "auto"
    });
    expect(projectNameMode({ name: "未命名项目" })).toBe("auto");
    expect(projectNameMode({ name: "" })).toBe("auto");
    expect(projectNameMode({ name: "已经命名的旧项目" })).toBe("custom");
  });
});
