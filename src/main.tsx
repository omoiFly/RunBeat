import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { LanguageProvider } from "./i18n";
import { uiFontModeForDevicePixelRatio } from "./uiFontMode";
import "98.css";
import "./styles.css";

const BITMAP_FONT_REQUEST = '15px "RunBeat Bitmap UI"';
const BITMAP_FONT_SAMPLE = "中文 English 0123456789";

function syncUiFontMode(): void {
  const mode = uiFontModeForDevicePixelRatio(window.devicePixelRatio);
  document.documentElement.dataset.uiFontMode = mode;
  if (mode === "bitmap" && "fonts" in document) {
    void document.fonts.load(BITMAP_FONT_REQUEST, BITMAP_FONT_SAMPLE).catch(() => undefined);
  }
}

async function waitForStartupResources(): Promise<void> {
  if ("fonts" in document) {
    const resources: Promise<unknown>[] = [document.fonts.ready];
    if (document.documentElement.dataset.uiFontMode === "bitmap") {
      resources.push(document.fonts.load(BITMAP_FONT_REQUEST, BITMAP_FONT_SAMPLE));
    }
    await Promise.allSettled(resources);
  }
}

function waitForSettledLayout(): Promise<void> {
  // Give React and the loaded font two layout passes before revealing the window.
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

async function revealAfterSettledLayout(): Promise<void> {
  await waitForSettledLayout();
  document.documentElement.dataset.startup = "ready";
}

async function start(): Promise<void> {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("RunBeat root element is missing");

  document.documentElement.dataset.startup = "loading";
  syncUiFontMode();
  window.addEventListener("resize", syncUiFontMode);
  await waitForStartupResources();

  createRoot(rootElement).render(
    <StrictMode>
      <LanguageProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </LanguageProvider>
    </StrictMode>
  );

  await revealAfterSettledLayout();
}

void start();
