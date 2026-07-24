import { describe, expect, it } from "vitest";
import { createProject } from "../domain/types";
import { readProjectFile } from "./projectFile";

function projectFile(targetSpm: number): File {
  const project = { ...createProject("Cadence range"), targetSpm };
  return {
    text: async () => JSON.stringify(project)
  } as File;
}

describe("project file target cadence", () => {
  it.each([60, 230])("accepts the supported boundary %i SPM", async (targetSpm) => {
    await expect(readProjectFile(projectFile(targetSpm))).resolves.toMatchObject({ targetSpm });
  });

  it.each([59, 231])("rejects the unsupported boundary %i SPM", async (targetSpm) => {
    await expect(readProjectFile(projectFile(targetSpm))).rejects.toThrow();
  });
});
