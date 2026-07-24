import {
  DEFAULT_PROJECT_NAME,
  type ProjectNameMode,
  type ProjectV1,
  type Track
} from "../domain/types";

const LEGACY_AUTOMATIC_NAMES = new Set([DEFAULT_PROJECT_NAME, "未命名项目"]);

export function songTitleFromFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const withoutExtension = trimmed.replace(/\.[^./\\]+$/, "").trim();
  return withoutExtension || trimmed || DEFAULT_PROJECT_NAME;
}

export function automaticProjectName(tracks: Array<Pick<Track, "source">>): string {
  if (!tracks.length) return DEFAULT_PROJECT_NAME;
  const firstTitle = songTitleFromFileName(tracks[0].source.fileName);
  return tracks.length === 1 ? firstTitle : `${firstTitle} 等 ${tracks.length} 首`;
}

export function projectNameMode(project: Pick<ProjectV1, "name" | "nameMode">): ProjectNameMode {
  if (project.nameMode) return project.nameMode;
  const name = project.name.trim();
  return !name || LEGACY_AUTOMATIC_NAMES.has(name) ? "auto" : "custom";
}

export function projectNameAfterTrackChange(
  project: Pick<ProjectV1, "name" | "nameMode">,
  tracks: Array<Pick<Track, "source">>
): Pick<ProjectV1, "name" | "nameMode"> {
  const mode = projectNameMode(project);
  return mode === "auto"
    ? { name: automaticProjectName(tracks), nameMode: "auto" }
    : { name: project.name, nameMode: "custom" };
}
