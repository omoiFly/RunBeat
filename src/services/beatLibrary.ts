import type { CustomBeatSampleRef } from "../domain/types";
import { encodeWav16 } from "../audio/wav";
import { BeatResourceInUseError, protectedBeatResourceIds, withUnusedBeatResource } from "./beatResourceLocks";
import { clearCustomBeatSample, decodeCustomBeatFile } from "./customBeat";
import { db, loadCustomBeatResource, saveCustomBeatResource, type CustomBeatResourceRow } from "./db";
import { beatNameKey, validateBeatName } from "./beatNames";

export interface BeatLibraryItem extends CustomBeatSampleRef {
  resourceId: string;
  name: string;
  createdAt: number;
  storageBytes: number;
  originalAvailable: boolean;
  projectNames: string[];
  activeInWorkspace: boolean;
}

export function beatSampleReference(resource: CustomBeatResourceRow | BeatLibraryItem): CustomBeatSampleRef {
  return {
    resourceId: "resourceId" in resource ? resource.resourceId : resource.id,
    fileName: resource.fileName,
    fileSize: resource.fileSize,
    mimeType: resource.mimeType,
    lastModified: resource.lastModified,
    durationSeconds: resource.durationSeconds,
    available: true
  };
}

export async function listBeatLibrary(): Promise<BeatLibraryItem[]> {
  const items = await db.transaction("r", db.projects, db.customBeatResources, async () => {
    const projects = await db.projects.toArray();
    const rows: BeatLibraryItem[] = [];
    // Keep only metadata in the list; release each PCM/blob as the cursor advances.
    await db.customBeatResources.orderBy("createdAt").reverse().each((resource) => {
      rows.push({
        ...beatSampleReference(resource),
        resourceId: resource.id,
        name: resource.name,
        createdAt: resource.createdAt,
        storageBytes: resource.channels.reduce((bytes, channel) => bytes + channel.byteLength, resource.originalFile?.size ?? 0),
        originalAvailable: resource.originalFile != null,
        projectNames: projects.filter(({ project }) => project.beatTrack.customSample?.resourceId === resource.id).map(({ project }) => project.name),
        activeInWorkspace: false
      });
    });
    return rows;
  });
  const activeIds = await protectedBeatResourceIds();
  return items.map((item) => ({ ...item, activeInWorkspace: activeIds.has(item.resourceId) }));
}

export async function uploadLibraryBeat(file: File): Promise<CustomBeatSampleRef> {
  const decoded = await decodeCustomBeatFile(file);
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const contentHash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const resource = await saveCustomBeatResource({
    id: crypto.randomUUID(),
    channels: decoded.channels,
    sampleRate: decoded.sampleRate,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    lastModified: file.lastModified,
    durationSeconds: decoded.durationSeconds,
    createdAt: Date.now(),
    originalFile: file,
    contentHash
  });
  return beatSampleReference(resource);
}

export async function downloadLibraryBeat(id: string): Promise<{ blob: Blob; fileName: string }> {
  const resource = await loadCustomBeatResource(id);
  if (!resource) throw new Error("鼓点已被删除，请重新选择。");
  if (resource.originalFile) return { blob: resource.originalFile, fileName: resource.fileName };
  return {
    blob: encodeWav16({ channels: resource.channels, sampleRate: resource.sampleRate }),
    fileName: `${resource.fileName.replace(/\.[^.]+$/, "")}.wav`
  };
}

export async function renameLibraryBeat(id: string, requested: string): Promise<string> {
  const name = validateBeatName(requested);
  const nameKey = beatNameKey(name);
  await db.transaction("rw", db.customBeatResources, async () => {
    const matches = await db.customBeatResources.where("nameKey").equals(nameKey).primaryKeys();
    if (matches.some((existingId) => existingId !== id)) throw new Error("鼓点库中已有这个名称，请换一个名称。");
    if (!await db.customBeatResources.update(id, { name, nameKey })) throw new Error("鼓点已被删除，请重新选择。");
  });
  return name;
}

export async function deleteLibraryBeat(id: string): Promise<void> {
  await withUnusedBeatResource(id, () => db.transaction("rw", db.projects, db.customBeatResources, async () => {
    const used = await db.projects.filter(({ project }) => project.beatTrack.customSample?.resourceId === id).first();
    if (used) throw new BeatResourceInUseError();
    await db.customBeatResources.delete(id);
    clearCustomBeatSample(id);
  }));
}

// Operate on the IDs shown in the confirmation, never newly uploaded resources.
export async function cleanUnusedLibraryBeats(ids: string[]): Promise<{ deleted: number; skipped: number }> {
  let deleted = 0;
  let skipped = 0;
  for (const id of new Set(ids)) {
    try {
      await deleteLibraryBeat(id);
      deleted += 1;
    } catch (error) {
      if (!(error instanceof BeatResourceInUseError)) throw error;
      skipped += 1;
    }
  }
  return { deleted, skipped };
}
