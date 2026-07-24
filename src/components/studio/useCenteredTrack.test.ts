import { describe, expect, it, vi } from "vitest";
import { centerSelectedTrack } from "./useCenteredTrack";

function rect(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) };
}

describe("centerSelectedTrack", () => {
  it("centers the selected row within its own scroll container", () => {
    const container = document.createElement("div");
    const selectedTrack = document.createElement("div");
    selectedTrack.dataset.selectedTrack = "true";
    container.append(selectedTrack);

    Object.defineProperties(container, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1_000 },
      scrollTop: { value: 100, writable: true }
    });
    container.getBoundingClientRect = () => rect(20, 200);
    selectedTrack.getBoundingClientRect = () => rect(320, 40);
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;

    centerSelectedTrack(container);

    expect(scrollTo).toHaveBeenCalledWith({ top: 320, behavior: "smooth" });
  });

  it("clamps the target position at either end of the list", () => {
    const container = document.createElement("div");
    const selectedTrack = document.createElement("div");
    selectedTrack.dataset.selectedTrack = "true";
    container.append(selectedTrack);

    Object.defineProperties(container, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 500 },
      scrollTop: { value: 280, writable: true }
    });
    container.getBoundingClientRect = () => rect(0, 200);
    selectedTrack.getBoundingClientRect = () => rect(450, 40);
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;

    centerSelectedTrack(container);

    expect(scrollTo).toHaveBeenCalledWith({ top: 300, behavior: "smooth" });
  });
});
