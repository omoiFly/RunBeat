import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, type Track } from "../../domain/types";
import { LanguageProvider } from "../../i18n";

const previewMocks = vi.hoisted(() => {
  let listener: ((snapshot: {
    status: string;
    mode: string;
    sourcePositionSeconds: number;
    bufferedThroughSeconds: number;
    sourceEndSeconds: number;
    error?: string;
  }) => void) | undefined;
  let snapshot = {
    status: "preparing",
    mode: "original",
    sourcePositionSeconds: 0,
    bufferedThroughSeconds: 0,
    sourceEndSeconds: 60
  };
  const session = {
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((nextListener: typeof listener) => {
      listener = nextListener;
      nextListener?.(snapshot);
      return vi.fn();
    }),
    seek: vi.fn(),
    updateAlignment: vi.fn(),
    stop: vi.fn()
  };
  return {
    session,
    startPreview: vi.fn(() => session),
    stopPreview: vi.fn(),
    reset() {
      listener = undefined;
      snapshot = {
        status: "preparing",
        mode: "original",
        sourcePositionSeconds: 0,
        bufferedThroughSeconds: 0,
        sourceEndSeconds: 60
      };
      Object.values(session).forEach((value) => {
        if (typeof value === "function" && "mockClear" in value) value.mockClear();
      });
    },
    emit(patch: Partial<typeof snapshot>) {
      snapshot = { ...snapshot, ...patch };
      listener?.(snapshot);
    }
  };
});

vi.mock("../../services/preview", () => ({
  startPreview: previewMocks.startPreview,
  stopPreview: previewMocks.stopPreview
}));

import { Inspector } from "./Inspector";

const track: Track = {
  id: "track-1",
  source: {
    id: "track-1",
    fileName: "test-song.mp3",
    fileSize: 1_000,
    mimeType: "audio/mpeg",
    lastModified: 1,
    available: true
  },
  durationSeconds: 60,
  status: "complete",
  rawAnalysis: {
    rawBpm: 120,
    rhythmBpm: 121,
    bpmConfidence: 0.73,
    beatTicks: [0, 0.5, 1],
    bpmIntervals: [0.5, 0.5],
    windowBpms: [120],
    waveformPeaks: [],
    analyzedAt: 1
  },
  derivedAnalysis: {
    normalizedBpm: 180,
    detectorOctaveFactor: 1,
    stepsPerBeat: 1,
    effectiveFactor: 1,
    targetSpm: 180,
    tempoRatio: 1,
    timeRatio: 1,
    tempoChangePercent: 0,
    phaseOffsetSeconds: 0.1,
    phaseAlignmentModel: "global-bpm",
    phaseConfidence: 0.75,
    phaseCoverage: 0.84,
    phaseMedianErrorMs: 20,
    quality: "good",
    qualityFactors: {
      tempoChange: "excellent",
      bpmConfidence: "good",
      phaseAlignment: "good"
    },
    warnings: []
  },
  edit: {
    exportEnabled: true,
    sourceInSeconds: 0,
    sourceOutSeconds: 60,
    phaseNudgeBeats: 0
  },
  order: 0
};

function renderInspector(onTrackEdit = vi.fn()) {
  render(
    <LanguageProvider>
      <Inspector
        project={createProject("Test")}
        track={track}
        busy={false}
        onTrackEdit={onTrackEdit}
        onReanalyze={vi.fn()}
      />
    </LanguageProvider>
  );
  fireEvent.click(screen.getByRole("tab", { name: "试听" }));
  return onTrackEdit;
}

describe("Inspector", () => {
  beforeEach(() => {
    localStorage.clear();
    previewMocks.reset();
    previewMocks.startPreview.mockClear();
    previewMocks.stopPreview.mockClear();
  });
  afterEach(cleanup);

  it("shows analysis failure details and a retry action in track properties", () => {
    const onReanalyze = vi.fn();
    render(
      <LanguageProvider>
        <Inspector
          project={createProject("Test")}
          track={{ ...track, status: "failed", error: "无法解码测试音频：文件格式损坏" }}
          busy={false}
          onTrackEdit={vi.fn()}
          onReanalyze={onReanalyze}
        />
      </LanguageProvider>
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("分析失败");
    expect(alert).toHaveTextContent("无法解码测试音频：文件格式损坏");

    fireEvent.click(screen.getByRole("button", { name: "重新分析" }));
    expect(onReanalyze).toHaveBeenCalledOnce();
  });

  it("shows quality factors and phase metrics directly in analysis results", () => {
    render(
      <LanguageProvider>
        <Inspector
          project={createProject("Test")}
          track={track}
          busy={false}
          onTrackEdit={vi.fn()}
          onReanalyze={vi.fn()}
        />
      </LanguageProvider>
    );

    const analysis = screen.getByText("分析结果").closest("fieldset");
    expect(analysis).toHaveTextContent("BPM 置信度:");
    expect(analysis).toHaveTextContent("73%");
    expect(analysis).toHaveTextContent("可靠拍点覆盖:");
    expect(analysis).toHaveTextContent("84%");
    expect(analysis).toHaveTextContent("拍点中位误差:");
    expect(analysis).toHaveTextContent("20 ms");

    const quality = screen.getByText("综合质量计算").closest("fieldset");
    expect(quality).toHaveTextContent("置信度 75% · 覆盖 84% · 误差 20 ms");
    expect(quality).not.toHaveTextContent("决定项");
    expect(quality).not.toHaveTextContent("综合质量取");
    expect(quality).not.toHaveTextContent("良好范围：60% ～ 79%");
    expect(quality).not.toHaveTextContent("良好：置信度 ≥72%");
  });

  it("integrates quality warnings into factor advice and keeps only independent warnings separate", () => {
    const qualityWarning = "歌曲拍点相位一致性一般，综合质量已降级，建议试听确认";
    render(
      <LanguageProvider>
        <Inspector
          project={createProject("Test")}
          track={{
            ...track,
            derivedAnalysis: {
              ...track.derivedAnalysis!,
              quality: "acceptable",
              qualityFactors: {
                tempoChange: "excellent",
                bpmConfidence: "good",
                phaseAlignment: "acceptable"
              },
              warnings: [qualityWarning, "源文件响度异常"]
            }
          }}
          busy={false}
          onTrackEdit={vi.fn()}
          onReanalyze={vi.fn()}
        />
      </LanguageProvider>
    );

    const quality = screen.getByText("综合质量计算").closest("fieldset");
    expect(quality).toHaveTextContent("建议: 试听确认");
    expect(quality).not.toHaveTextContent("决定项");
    expect(screen.queryByText(qualityWarning)).not.toBeInTheDocument();

    const warnings = screen.getByText("警告").closest("fieldset");
    expect(warnings).toHaveTextContent("源文件响度异常");
    expect(warnings).not.toHaveTextContent("综合质量已降级");
  });

  it("reflects preparing, buffering, and playing session states", async () => {
    renderInspector();
    expect(screen.getByRole("group", { name: "试听控制" })).toContainElement(screen.getByRole("status"));
    expect(screen.getByRole("status")).toHaveTextContent("已停止");
    fireEvent.click(screen.getByRole("button", { name: "原始音频" }));
    expect(screen.getByRole("status")).toHaveTextContent("准备中");

    await waitFor(() => expect(previewMocks.startPreview).toHaveBeenCalledOnce());
    previewMocks.emit({ status: "buffering" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("缓冲中"));
    previewMocks.emit({ status: "playing", sourcePositionSeconds: 3.2 });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("播放中"));
    expect(screen.getByRole("slider")).toHaveValue("3.2");
  });

  it("keeps music playing while first-beat and half-beat calibration update the session", async () => {
    const onTrackEdit = renderInspector();
    fireEvent.click(screen.getByRole("button", { name: "处理后 + 节拍轨" }));
    await waitFor(() => expect(previewMocks.startPreview).toHaveBeenCalledOnce());
    previewMocks.emit({ status: "playing", mode: "processed-beat" });

    fireEvent.change(screen.getByLabelText("首拍(秒):"), { target: { value: "1.25" } });
    expect(onTrackEdit).toHaveBeenCalledWith({ manualFirstBeat: 1.25 });
    expect(previewMocks.session.updateAlignment).toHaveBeenCalledWith({
      phaseOffsetSeconds: expect.any(Number),
      phaseNudgeBeats: 0
    });
    expect(previewMocks.session.stop).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("相位:"), { target: { value: "0.5" } });
    expect(onTrackEdit).toHaveBeenCalledWith({ phaseNudgeBeats: 0.5 });
    expect(previewMocks.session.stop).not.toHaveBeenCalled();
  });

  it("seeks on slider release and stops before committing BPM changes", async () => {
    const onTrackEdit = renderInspector();
    expect(screen.queryByRole("tab", { name: "高级" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "处理后" }));
    await waitFor(() => expect(previewMocks.startPreview).toHaveBeenCalledOnce());

    const slider = screen.getByRole("slider");
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "24.5" } });
    expect(previewMocks.session.seek).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(previewMocks.session.seek).toHaveBeenCalledWith(24.5);

    const bpm = screen.getByLabelText("BPM:");
    fireEvent.change(bpm, { target: { value: "123.5" } });
    expect(onTrackEdit).not.toHaveBeenCalledWith({ manualBpm: 123.5 });
    fireEvent.blur(bpm);
    expect(previewMocks.session.stop).toHaveBeenCalled();
    expect(onTrackEdit).toHaveBeenCalledWith({ manualBpm: 123.5 });
  });
});
