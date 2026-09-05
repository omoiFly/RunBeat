import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, type ProjectV1 } from "../../domain/types";
import { LanguageProvider } from "../../i18n";
import { playBeatPreview } from "../../services/preview";
import { ProjectPropertiesDialog } from "./ProjectPropertiesDialog";

const mocks = vi.hoisted(() => ({
  a: { channels: [Float32Array.from([0.9, 0.2])], sampleRate: 44_100 },
  b: { channels: [Float32Array.from([0.1, 0.8])], sampleRate: 44_100 },
  load: vi.fn()
}));
vi.mock("../../services/customBeat", () => ({ loadCustomBeatSample: mocks.load }));
vi.mock("../../services/useBeatLibrary", () => ({
  useBeatLibrary: () => ({ loading: false, items: ["a", "b"].map((id) => ({ resourceId: id, name: id, fileName: `${id}.wav`, fileSize: 4, mimeType: "audio/wav", lastModified: 1, durationSeconds: 1, available: true })) })
}));
vi.mock("../../services/preview", () => ({ BEAT_PREVIEW_SECONDS: 6, playBeatPreview: vi.fn(async () => undefined), stopPreview: vi.fn() }));

function savedProject(sound: "custom" | "click"): ProjectV1 {
  const project = createProject("Test");
  project.beatTrack = { ...project.beatTrack, sound, customSample: { resourceId: "a", fileName: "a.wav", fileSize: 4, mimeType: "audio/wav", lastModified: 1, durationSeconds: 1, available: true } };
  return project;
}
function show(project = createProject("Test"), onApply = vi.fn(async () => undefined)) {
  render(<LanguageProvider><ProjectPropertiesDialog open project={project} onApply={onApply} onClose={vi.fn()} /></LanguageProvider>);
  fireEvent.click(screen.getByRole("tab", { name: /节拍轨|Beat Track/ }));
  return onApply;
}
function choose(value: string) { fireEvent.change(screen.getByRole("combobox", { name: "声音:" }), { target: { value } }); }
const preview = () => screen.getByRole("button", { name: /试听|Preview/ });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.load.mockImplementation(async (id) => id === "a" ? mocks.a : mocks.b);
});
afterEach(cleanup);

describe("project beat-track properties", () => {
  it("retains the -40 to +10 dB range and uses library selection instead of uploading", () => {
    show();
    const gain = screen.getByRole("slider", { name: "相对音量:" });
    expect(gain).toHaveAttribute("min", "-40");
    expect(gain).toHaveAttribute("max", "10");
    expect(gain).toHaveValue("-10");
    fireEvent.change(gain, { target: { value: "10" } });
    expect(screen.getByText("+10 dB")).toBeVisible();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByRole("button", { name: "打开鼓点库" })).toBeVisible();
  });

  it("P2: enables preview when switching from a built-in sound back to a saved custom beat", async () => {
    show(savedProject("click"));
    choose("custom:a");
    expect(preview()).toBeDisabled();
    await waitFor(() => expect(preview()).toBeEnabled());
    fireEvent.click(preview());
    expect(playBeatPreview).toHaveBeenCalledWith(expect.objectContaining({ beatTrack: expect.objectContaining({ customSample: expect.objectContaining({ resourceId: "a" }) }) }), mocks.a);
  });

  it("P2: keeps preview and applied resource identical after choosing B, applying a built-in sound, then selecting A", async () => {
    const onApply = show(savedProject("custom"));
    await waitFor(() => expect(preview()).toBeEnabled());
    choose("custom:b");
    await waitFor(() => expect(preview()).toBeEnabled());
    choose("click");
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ beatTrack: expect.objectContaining({ sound: "click", customSample: undefined }) })));
    await waitFor(() => expect(screen.getByRole("button", { name: "应用" })).toBeEnabled());
    choose("custom:a");
    await waitFor(() => expect(preview()).toBeEnabled());
    fireEvent.click(preview());
    expect(playBeatPreview).toHaveBeenLastCalledWith(expect.objectContaining({ beatTrack: expect.objectContaining({ customSample: expect.objectContaining({ resourceId: "a" }) }) }), mocks.a);
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ beatTrack: expect.objectContaining({ sound: "custom", customSample: expect.objectContaining({ resourceId: "a" }) }) })));
  });

  it("ignores a slow previous selection after a newer resource finishes loading", async () => {
    let finishA!: (sample: typeof mocks.a) => void;
    mocks.load.mockImplementation((id) => id === "a" ? new Promise((resolve) => { finishA = resolve; }) : Promise.resolve(mocks.b));
    show();
    choose("custom:a");
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith("a"));
    choose("custom:b");
    await waitFor(() => expect(preview()).toBeEnabled());
    finishA(mocks.a);
    fireEvent.click(preview());
    expect(playBeatPreview).toHaveBeenLastCalledWith(expect.objectContaining({ beatTrack: expect.objectContaining({ customSample: expect.objectContaining({ resourceId: "b" }) }) }), mocks.b);
  });
});
