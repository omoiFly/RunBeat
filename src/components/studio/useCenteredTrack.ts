import { useEffect, useRef } from "react";

const SELECTED_TRACK_SELECTOR = '[data-selected-track="true"]';

export function centerSelectedTrack(container: HTMLElement | null): void {
  const selectedTrack = container?.querySelector<HTMLElement>(SELECTED_TRACK_SELECTOR);
  if (!container || !selectedTrack || container.clientHeight <= 0 || typeof container.scrollTo !== "function") return;

  const containerRect = container.getBoundingClientRect();
  const trackRect = selectedTrack.getBoundingClientRect();
  const trackCenter = container.scrollTop + trackRect.top - containerRect.top + trackRect.height / 2;
  const maximumScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextScrollTop = Math.min(maximumScrollTop, Math.max(0, trackCenter - container.clientHeight / 2));
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  container.scrollTo({ top: nextScrollTop, behavior: reduceMotion ? "auto" : "smooth" });
}

export function useCenteredTrack<T extends HTMLElement>(selectedId?: string) {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (selectedId) centerSelectedTrack(containerRef.current);
  }, [selectedId]);

  return containerRef;
}
