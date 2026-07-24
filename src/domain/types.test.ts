import { describe, expect, it } from "vitest";
import { createProject } from "./types";

describe("new project defaults", () => {
  it("uses the acceptable selection range and a full-volume wood beat", () => {
    const project = createProject();
    expect(project.maxTempoChangePercent).toBe(20);
    expect(project.beatTrack.sound).toBe("wood");
    expect(project.beatTrack.gainDb).toBe(0);
  });
});
