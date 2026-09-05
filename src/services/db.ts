import Dexie, { type EntityTable } from "dexie";
import type { ProjectV1 } from "../domain/types";

export interface CustomBeatResourceRow {
  id: string;
  sampleRate: number;
  channels: Float32Array[];
}

interface ProjectRow {
  id: string;
  updatedAt: number;
  project: ProjectV1;
}

class RunBeatDatabase extends Dexie {
  projects!: EntityTable<ProjectRow, "id">;
  customBeatResources!: EntityTable<CustomBeatResourceRow, "id">;
  constructor() {
    super("runbeat");
    this.version(1).stores({ projects: "id, updatedAt" });
    this.version(2).stores({ projects: "id, updatedAt", customBeatResources: "id" });
  }
}

export const db = new RunBeatDatabase();
export const PROJECTS_CHANGED_EVENT = "runbeat:projects-changed";

function notifyProjectsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
}

export async function saveProject(project: ProjectV1): Promise<void> {
  await db.projects.put({ id: project.id, updatedAt: project.updatedAt, project });
  notifyProjectsChanged();
}

export async function loadProject(id: string): Promise<ProjectV1 | undefined> {
  return (await db.projects.get(id))?.project;
}

export async function listProjects(): Promise<ProjectV1[]> {
  return (await db.projects.orderBy("updatedAt").reverse().toArray()).map((row) => row.project);
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
  notifyProjectsChanged();
}

export async function saveCustomBeatResource(resource: CustomBeatResourceRow): Promise<void> {
  await db.customBeatResources.put(resource);
}

export async function loadCustomBeatResource(id: string): Promise<CustomBeatResourceRow | undefined> {
  return db.customBeatResources.get(id);
}
