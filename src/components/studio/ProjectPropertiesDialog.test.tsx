import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../../domain/types";
import { LanguageProvider } from "../../i18n";
import { ProjectPropertiesDialog } from "./ProjectPropertiesDialog";

describe("project beat-track properties", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("starts at -10 dB and can be raised by 20 dB", () => {
    render(
      <LanguageProvider>
        <ProjectPropertiesDialog
          open
          project={createProject("Test")}
          onApply={vi.fn()}
          onClose={vi.fn()}
        />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("tab", { name: "节拍轨" }));
    const gain = screen.getByRole("slider", { name: "相对音量:" });
    expect(gain).toHaveAttribute("min", "-40");
    expect(gain).toHaveAttribute("max", "10");
    expect(gain).toHaveValue("-10");

    fireEvent.change(gain, { target: { value: "10" } });
    expect(gain).toHaveValue("10");
    expect(screen.getByText("+10 dB")).toBeVisible();
  });
});
