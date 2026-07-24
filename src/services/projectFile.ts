import { z } from "zod";
import { MAX_TARGET_SPM, MIN_TARGET_SPM, PROJECT_SCHEMA_VERSION, type ProjectV1 } from "../domain/types";

const projectShape = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  targetSpm: z.number().min(MIN_TARGET_SPM).max(MAX_TARGET_SPM),
  tracks: z.array(z.object({ id: z.string(), source: z.object({ fileName: z.string(), fileSize: z.number(), lastModified: z.number() }) }).passthrough())
}).passthrough();

export async function readProjectFile(file: File): Promise<ProjectV1> {
  const parsed: unknown = JSON.parse(await file.text());
  return projectShape.parse(parsed) as unknown as ProjectV1;
}
