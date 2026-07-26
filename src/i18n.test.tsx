import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LanguageProvider, useI18n } from "./i18n";

function RuntimeMessage({ children }: { children: string }) {
  const { translateMessage } = useI18n();
  return <span>{translateMessage(children)}</span>;
}

describe("runtime message translations", () => {
  beforeEach(() => {
    localStorage.setItem("runbeat.language.v1", "en");
  });

  it.each([
    ["减速超过 -20%，通常会明显影响听感", "Slowdown exceeds -20% and will usually have a noticeable effect on sound quality"],
    ["加速超过 +30%，可能明显影响听感", "Speed-up exceeds +30% and may noticeably affect sound quality"],
    ["减速幅度较大（低于 -15%）", "Large slowdown (below -15%)"],
    ["加速幅度较大（超过 +20%）", "Large speed-up (over +20%)"],
    ["全局 BPM 置信度较低，建议手动确认", "Overall BPM confidence is low; manual confirmation is recommended"],
    ["全局 BPM 置信度一般", "Overall BPM confidence is moderate"]
  ])("translates analysis warning: %s", (message, expected) => {
    render(<LanguageProvider><RuntimeMessage>{message}</RuntimeMessage></LanguageProvider>);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it.each([
    ["2 路并行 · 解码 如意往事.mp3", "2 parallel workers · Decoding 如意往事.mp3"],
    ["2 路并行 · 保持音高变速 如意往事.mp3", "2 parallel workers · Pitch-preserving stretch · 如意往事.mp3"],
    ["2 路并行 · 处理 1 / 3 · 如意往事.mp3", "2 parallel workers · Processing 1 / 3 · 如意往事.mp3"],
    ["编码 MP3 2 / 3", "Encoding MP3 2 / 3"],
    ["响度预扫描 1 / 3 · 如意往事.mp3", "Loudness pre-scan 1 / 3 · 如意往事.mp3"],
    ["响度测量完成 · -14.2 LUFS · +1.0 dB", "Loudness measurement complete · -14.2 LUFS · +1.0 dB"],
    ["编码 MP3（192 kbps）", "Encoding MP3 (192 kbps)"]
  ])("translates export progress while preserving the file name: %s", (message, expected) => {
    render(<LanguageProvider><RuntimeMessage>{message}</RuntimeMessage></LanguageProvider>);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
