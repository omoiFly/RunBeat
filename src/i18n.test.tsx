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
});
