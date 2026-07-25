let previewAudioContext: AudioContext | undefined;

export function getPreviewAudioContext(): AudioContext {
  if (typeof AudioContext === "undefined") {
    throw new Error("当前浏览器不支持 Web Audio，无法开始连续试听");
  }
  previewAudioContext ??= new AudioContext();
  return previewAudioContext;
}

/**
 * Call directly from a click or keyboard handler so browsers retain the user
 * activation while the larger preview module is loaded lazily.
 */
export function unlockPreviewAudio(): void {
  if (typeof AudioContext === "undefined") return;
  const context = getPreviewAudioContext();
  if (context.state !== "running") void context.resume().catch(() => undefined);
}
