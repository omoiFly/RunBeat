import Dexie, { type EntityTable } from "dexie";
import type { ProjectV1 } from "../domain/types";

interface ProjectRow {
  id: string;
  updatedAt: number;
  project: ProjectV1;
}

class RunBeatDatabase extends Dexie {
  projects!: EntityTable<ProjectRow, "id">;
  constructor() {
    super("runbeat");
    this.version(1).stores({ projects: "id, updatedAt" });
  }
}

export const db = new RunBeatDatabase();

export async function saveProject(project: ProjectV1): Promise<void> {
  await db.projects.put({ id: project.id, updatedAt: project.updatedAt, project });
}

export async function loadProject(id: string): Promise<ProjectV1 | undefined> {
  return (await db.projects.get(id))?.project;
}

export async function listProjects(): Promise<ProjectV1[]> {
  return (await db.projects.orderBy("updatedAt").reverse().toArray()).map((row) => row.project);
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}
