import Dexie, { type EntityTable } from "dexie";
import type { ProjectV1 } from "../domain/types";
import { beatNameKey, defaultBeatName, uniqueBeatName } from "./beatNames";

export interface CustomBeatResourceRow {
  id: string;
  sampleRate: number;
  channels: Float32Array[];
  name: string;
  nameKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  lastModified: number;
  durationSeconds: number;
  createdAt: number;
  originalFile?: Blob;
  contentHash?: string;
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
    this.version(3).stores({ projects: "id, updatedAt", customBeatResources: "id, createdAt, &contentHash" }).upgrade(async (transaction) => {
      const projects: ProjectRow[] = await transaction.table("projects").toArray();
      const references = new Map(projects.flatMap(({ project }) => {
        const reference = project.beatTrack.customSample;
        return reference?.resourceId ? [[reference.resourceId, reference] as const] : [];
      }));
      await transaction.table("customBeatResources").toCollection().modify((resource: CustomBeatResourceRow) => {
        const reference = references.get(resource.id);
        resource.fileName = reference?.fileName ?? `Beat-${resource.id.slice(0, 8)}.wav`;
        resource.fileSize = reference?.fileSize ?? resource.channels.reduce((size, channel) => size + channel.byteLength, 0);
        resource.mimeType = reference?.mimeType ?? "audio/wav";
        resource.lastModified = reference?.lastModified ?? 0;
        resource.durationSeconds = reference?.durationSeconds ?? (resource.channels[0]?.length ?? 0) / resource.sampleRate;
        resource.createdAt = Date.now();
      });
    });
    this.version(4).stores({ projects: "id, updatedAt", customBeatResources: "id, createdAt, &contentHash, &nameKey" }).upgrade(async (transaction) => {
      const usedKeys = new Set<string>();
      await transaction.table("customBeatResources").orderBy("createdAt").modify((resource: CustomBeatResourceRow) => {
        resource.name = uniqueBeatName(defaultBeatName(resource.fileName), usedKeys);
        resource.nameKey = beatNameKey(resource.name);
        usedKeys.add(resource.nameKey);
      });
    });
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

export async function saveCustomBeatResource(resource: Omit<CustomBeatResourceRow, "name" | "nameKey">): Promise<CustomBeatResourceRow> {
  return db.transaction("rw", db.customBeatResources, async () => {
    const existing = resource.contentHash
      ? await db.customBeatResources.where("contentHash").equals(resource.contentHash).first()
      : undefined;
    if (existing) return existing;
    const usedKeys = await db.customBeatResources.orderBy("nameKey").keys();
    const name = uniqueBeatName(defaultBeatName(resource.fileName), new Set(usedKeys.map(String)));
    const namedResource = { ...resource, name, nameKey: beatNameKey(name) };
    await db.customBeatResources.add(namedResource);
    return namedResource;
  });
}

export async function loadCustomBeatResource(id: string): Promise<CustomBeatResourceRow | undefined> {
  return db.customBeatResources.get(id);
}
