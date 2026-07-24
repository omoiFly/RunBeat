import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { LanguageProvider } from "./i18n";
import { uiFontModeForDevicePixelRatio } from "./uiFontMode";
import "98.css";
import "./styles.css";

const BITMAP_FONT_REQUEST = '15px "RunBeat Bitmap UI Core"';
const BITMAP_FONT_SAMPLE = "中文 English 0123456789";
const STARTUP_FONT_WAIT_MS = 800;

function syncUiFontMode(): void {
  const mode = uiFontModeForDevicePixelRatio(window.devicePixelRatio);
  document.documentElement.dataset.uiFontMode = mode;
  if (mode === "bitmap" && "fonts" in document) {
    void document.fonts.load(BITMAP_FONT_REQUEST, BITMAP_FONT_SAMPLE).catch(() => undefined);
  }
}

async function waitForStartupResources(): Promise<void> {
  if (
    !("fonts" in document)
    || document.documentElement.dataset.uiFontMode !== "bitmap"
  ) return;

  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, STARTUP_FONT_WAIT_MS);
    void document.fonts.load(BITMAP_FONT_REQUEST, BITMAP_FONT_SAMPLE).then(
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      () => {
        window.clearTimeout(timeout);
        resolve();
      }
    );
  });
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
  const startupResources = waitForStartupResources();

  rootElement.replaceChildren();
  createRoot(rootElement).render(
    <StrictMode>
      <LanguageProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </LanguageProvider>
    </StrictMode>
  );

  await startupResources;
  await revealAfterSettledLayout();
}

void start();
