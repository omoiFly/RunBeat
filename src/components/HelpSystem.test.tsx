import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { AboutDialog, HelpTopicsDialog } from "./HelpSystem";

describe("about dialog", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("thanks the core open-source projects and shows their licenses", () => {
    render(
      <LanguageProvider>
        <AboutDialog open onClose={vi.fn()} />
      </LanguageProvider>
    );

    expect(screen.getByText("隐私优先：所有音频分析与处理均在您的设备本地完成，文件不会上传。")).toBeInTheDocument();
    expect(screen.getByText("GNU AGPL v3+")).toHaveAttribute("title", "SPDX: AGPL-3.0-or-later");
    expect(screen.getByText("RunBeat 得益于以下开源项目，谨向所有作者与贡献者致谢。")).toBeInTheDocument();
    const technologies = screen.getByRole("table", { name: "开源技术" });
    expect(within(technologies).getByRole("link", { name: "Essentia.js" })).toHaveAttribute("href", "https://mtg.github.io/essentia.js/");
    expect(within(technologies).getByRole("link", { name: "Rubber Band Library" })).toBeInTheDocument();
    expect(within(technologies).getByRole("link", { name: "WenQuanYi Bitmap Song" })).toBeInTheDocument();
    expect(within(technologies).getByText("Apache-2.0")).toBeInTheDocument();
  });

  it("translates the acknowledgement in the English interface", () => {
    localStorage.setItem("runbeat.language.v1", "en");
    render(
      <LanguageProvider>
        <AboutDialog open onClose={vi.fn()} />
      </LanguageProvider>
    );

    expect(screen.getByText("Open-source Technologies")).toBeInTheDocument();
    expect(screen.getByText("Privacy first: all audio analysis and processing is performed locally on your device. Your files are never uploaded.")).toBeInTheDocument();
    expect(screen.getByText(/With thanks to every author and contributor/)).toBeInTheDocument();
  });
});

describe("help topics", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  function renderHelp() {
    render(
      <LanguageProvider>
        <HelpTopicsDialog open onClose={vi.fn()} />
      </LanguageProvider>
    );
  }

  it("explains beat points, phase locking, refinement, and quality thresholds", () => {
    renderHelp();

    fireEvent.click(screen.getByRole("treeitem", { name: "分析指标说明" }));
    const metrics = screen.getByRole("table", { name: "分析指标含义" });
    expect(within(metrics).getByText("拍点").closest("tr")).toHaveTextContent("不是后来叠加的脚步声");

    fireEvent.click(screen.getByRole("treeitem", { name: "相位锁定与拍点精修" }));
    expect(screen.getByText(/相位锁定解决“第一步从哪里开始”/)).toBeInTheDocument();
    expect(screen.getByText(/拍点精修解决“固定网格会不会越走越偏”/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: "综合质量标准" }));
    const quality = screen.getByRole("table", { name: "综合质量分项阈值" });
    expect(within(quality).getByRole("row", { name: /变速/ })).toHaveTextContent("-20% ～ +30%");
    expect(within(quality).getByRole("row", { name: /相位对齐/ })).toHaveTextContent("覆盖 ≥90%");
  });

  it("documents project settings and list interactions", () => {
    renderHelp();

    fireEvent.click(screen.getByRole("treeitem", { name: "项目配置说明" }));
    expect(screen.getByRole("table", { name: "项目常规配置" })).toHaveTextContent("60～230 SPM");
    expect(screen.getByRole("table", { name: "项目节拍轨配置" })).toHaveTextContent("每组第 1 步加强");

    fireEvent.click(screen.getByRole("treeitem", { name: "歌曲编排与排序" }));
    expect(screen.getByText(/拖拽一首歌曲可调整播放顺序/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: "试听与手动校准" }));
    expect(screen.getByText(/双击列表歌曲或按 Enter/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: "节拍轨" }));
    expect(screen.getByText(/35%（约 \+2.6 dB）/)).toBeInTheDocument();
  });

  it("provides the new reference topics in English", () => {
    localStorage.setItem("runbeat.language.v1", "en");
    renderHelp();

    fireEvent.click(screen.getByRole("treeitem", { name: "Analysis Metrics" }));
    expect(screen.getByRole("row", { name: /Musical beat positions detected/ })).toHaveTextContent("not the footstep sounds added later");

    fireEvent.click(screen.getByRole("treeitem", { name: "Overall Quality Criteria" }));
    const quality = screen.getByRole("table", { name: "Overall Quality Factor Thresholds" });
    expect(within(quality).getByRole("row", { name: /Tempo Change/ })).toHaveTextContent("-20% to +30%");
  });
});
