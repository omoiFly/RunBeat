const files = new Map<string, File>();

export function registerFile(trackId: string, file: File): void {
  files.set(trackId, file);
}

export function getRegisteredFile(trackId: string): File | undefined {
  return files.get(trackId);
}

export function unregisterFile(trackId: string): void {
  files.delete(trackId);
}

export function clearRegisteredFiles(): void {
  files.clear();
}

export function reconcileRegisteredFiles(trackIds: Iterable<string>): void {
  const retained = new Set(trackIds);
  for (const trackId of files.keys()) {
    if (!retained.has(trackId)) files.delete(trackId);
  }
}

export function registerRelinkedFiles(tracks: { id: string; fileName: string; fileSize: number; lastModified: number }[], selected: File[]): string[] {
  const linked: string[] = [];
  for (const track of tracks) {
    const file = selected.find((candidate) => candidate.name === track.fileName && candidate.size === track.fileSize && candidate.lastModified === track.lastModified);
    if (file) {
      files.set(track.id, file);
      linked.push(track.id);
    }
  }
  return linked;
}
