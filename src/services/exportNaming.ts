const FALLBACK_EXPORT_TITLE = "RunBeat";
const MAX_EXPORT_TITLE_CHARACTERS = 80;

/** Creates a cross-platform filename segment while preserving readable Unicode titles. */
export function safeExportTitle(title: string): string {
  const withoutControlCharacters = [...title]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? "_" : character;
    })
    .join("");
  const sanitized = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .replace(/_+/g, "_");
  const shortened = [...sanitized].slice(0, MAX_EXPORT_TITLE_CHARACTERS).join("").replace(/[. ]+$/g, "");
  return shortened || FALLBACK_EXPORT_TITLE;
}

export function exportBaseName(projectTitle: string, targetSpm: number, durationSeconds: number): string {
  return `${safeExportTitle(projectTitle)}_${targetSpm}SPM_${Math.max(1, Math.round(durationSeconds / 60))}min`;
}
