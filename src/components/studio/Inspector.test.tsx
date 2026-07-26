import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    bpmAgreement: 1,
    automaticPhaseOffsetSeconds: 0.1,
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

function renderInspector(
  onTrackEdit = vi.fn(),
  options: { busy?: boolean; targetTrack?: Track } = {}
) {
  render(
    <LanguageProvider>
      <Inspector
        project={createProject("Test")}
        track={options.targetTrack ?? track}
        busy={options.busy ?? false}
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

  it("organizes the analysis as a Win98-style summary, details list, and compact property groups", () => {
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

    const conclusion = screen.getByRole("group", { name: "分析结论" });
    expect(conclusion).toHaveTextContent("综合质量: 良好");

    const quality = screen.getByRole("table", { name: "质量评估" });
    expect(within(quality).getByRole("row", { name: /变速/ })).toHaveTextContent("0.00%优秀");
    expect(within(quality).getByRole("row", { name: /BPM 置信度/ })).toHaveTextContent("73% · 差值 1.00 BPM良好");
    expect(within(quality).getByRole("row", { name: /相位对齐/ })).toHaveTextContent("置信度 75% · 覆盖 84% · 误差 20 ms良好");

    const output = screen.getByRole("group", { name: "节奏与输出" });
    expect(output).toHaveTextContent("主估计:120.00 BPM");
    expect(output).toHaveTextContent("节奏估计:121.00 BPM");
    expect(output).toHaveTextContent("最终采用:180.00 BPM");
    expect(output).toHaveTextContent("时长:1:00 → 1:00");

    const beats = screen.getByRole("group", { name: "拍点信息" });
    expect(beats).toHaveTextContent("检测拍点:3 个");
    expect(beats).toHaveTextContent("自动首拍:0.10 秒");
    expect(beats).toHaveTextContent("锁定方式:全局锁定 · 稳定");
    expect(screen.queryByText("综合质量计算")).not.toBeInTheDocument();
    expect(screen.queryByText("自动首拍参考(秒):")).not.toBeInTheDocument();
  });

  it("uses the automatic first-beat time as the manual input reference", () => {
    renderInspector();

    expect(screen.getByLabelText("首拍(秒):")).toHaveAttribute("placeholder", "0.10");
  });

  it("allows completed-track calibration while another track is being analyzed", () => {
    renderInspector(vi.fn(), { busy: true });

    expect(screen.getByLabelText("BPM:")).toBeEnabled();
    expect(screen.getByLabelText("首拍(秒):")).toBeEnabled();
    expect(screen.getByLabelText("相位:")).toBeEnabled();
    expect(screen.getByLabelText("入点(秒):")).toBeEnabled();
    expect(screen.getByLabelText("出点(秒):")).toBeEnabled();

    cleanup();
    renderInspector(vi.fn(), {
      busy: true,
      targetTrack: { ...track, status: "analyzing-beats" }
    });
    expect(screen.getByLabelText("BPM:")).toBeDisabled();
    expect(screen.getByLabelText("首拍(秒):")).toBeDisabled();
    expect(screen.getByLabelText("相位:")).toBeDisabled();
    expect(screen.getByLabelText("入点(秒):")).toBeDisabled();
    expect(screen.getByLabelText("出点(秒):")).toBeDisabled();
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

    const conclusion = screen.getByRole("group", { name: "分析结论" });
    expect(conclusion).toHaveTextContent("建议: 试听确认");
    expect(conclusion).not.toHaveTextContent("决定项");
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
