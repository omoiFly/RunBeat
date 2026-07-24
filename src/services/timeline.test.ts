import { describe, expect, it } from "vitest";
import type { TimelinePlan } from "../audio/mixer";
import type { Track } from "../domain/types";
import { createProjectTimeline, formatTimelineTimestamp, timelineAsCsv, timelineAsText } from "./timeline";

const track: Track = {
  id: "track-1",
  source: { id: "track-1", fileName: "Morning, Run.wav", fileSize: 1, mimeType: "audio/wav", lastModified: 1, available: true },
  durationSeconds: 240,
  status: "complete",
  rawAnalysis: {
    rawBpm: 176.2,
    beatTicks: [],
    bpmIntervals: [],
    windowBpms: [],
    waveformPeaks: [],
    analyzedAt: 1
  },
  derivedAnalysis: {
    normalizedBpm: 176,
    detectorOctaveFactor: 1,
    stepsPerBeat: 1,
    effectiveFactor: 1,
    targetSpm: 180,
    tempoRatio: 180 / 176,
    timeRatio: 176 / 180,
    tempoChangePercent: (180 / 176 - 1) * 100,
    quality: "excellent",
    warnings: []
  },
  edit: { exportEnabled: true, sourceInSeconds: 0, sourceOutSeconds: 240, phaseNudgeBeats: 0 },
  order: 0
};

const plan: TimelinePlan = {
  aligned: [[new Float32Array(1), new Float32Array(1)]],
  entries: [{ trackIndex: 0, startFrames: 1_000, audibleStartFrames: 1_125, endFrames: 25_000, overlapFrames: 500, phaseShiftFrames: 125 }],
  durationFrames: 25_000
};

describe("export timeline", () => {
  it("formats timestamps beyond one hour", () => {
    expect(formatTimelineTimestamp(3_661.789, true)).toBe("01:01:01.789");
    expect(formatTimelineTimestamp(3_661.789)).toBe("01:01:01");
  });

  it("uses the audible song start and exports readable Chinese TXT and CSV", () => {
    const timeline = createProjectTimeline([track], plan, 1_000, 180);
    expect(timeline.items[0]).toMatchObject({ title: "Morning, Run", transitionStartSeconds: 1, startSeconds: 1.125, endSeconds: 25 });
    expect(timelineAsText(timeline, "zh-CN")).toContain("总时长 00:00:25");
    expect(timelineAsText(timeline, "zh-CN")).toContain("01  00:00:01  Morning, Run");
    expect(timelineAsCsv(timeline, "zh-CN")).toContain("综合质量");
    expect(timelineAsCsv(timeline, "zh-CN")).toContain('1,00:00:01.000,00:00:01.125,00:00:25.000,"Morning, Run",176.20,176.00');
    expect(timelineAsCsv(timeline, "zh-CN")).toContain(",优秀\r\n");
  });

  it("exports English TXT copy and CSV headers without changing timeline values", () => {
    const timeline = createProjectTimeline([track], plan, 1_000, 180);
    const text = timelineAsText(timeline, "en");
    const csv = timelineAsCsv(timeline, "en");
    expect(text).toContain("Total duration 00:00:25");
    expect(text).toContain("01  00:00:01  Morning, Run");
    expect(csv).toContain("Index,Transition Start,Track Start,Track End,Track,Original BPM,Mapped BPM,Tempo Change (%),Overall Quality");
    expect(csv).toContain('1,00:00:01.000,00:00:01.125,00:00:25.000,"Morning, Run",176.20,176.00');
    expect(text).not.toMatch(/[\u3400-\u9fff]/);
    expect(csv).not.toMatch(/[\u3400-\u9fff]/);
  });

  it.each([
    ["excellent", "Excellent"],
    ["good", "Good"],
    ["acceptable", "Acceptable"],
    ["not-recommended", "Not recommended"],
    ["needs-calibration", "Needs calibration"]
  ] as const)("translates the %s quality label for English CSV", (quality, expected) => {
    const timeline = createProjectTimeline([track], plan, 1_000, 180);
    timeline.items[0].quality = quality;
    expect(timelineAsCsv(timeline, "en")).toContain(`,${expected}\r\n`);
  });
});
