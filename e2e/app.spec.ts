import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";

function clickTrackWav(bpm = 176, seconds = 8, sampleRate = 44_100): Buffer {
  const frames = seconds * sampleRate;
  const dataSize = frames * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  const beatFrames = sampleRate * 60 / bpm;
  for (let frame = 0; frame < frames; frame += 1) {
    const withinBeat = frame % beatFrames;
    const sample = withinBeat < 800
      ? Math.sin(2 * Math.PI * 880 * withinBeat / sampleRate) * Math.exp(-withinBeat / 180)
      : 0;
    buffer.writeInt16LE(Math.round(sample * 28_000), 44 + frame * 2);
  }
  return buffer;
}

function coverPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
}

function mp4TrackDimensions(bytes: Uint8Array): Array<{ width: number; height: number }> {
  const dimensions: Array<{ width: number; height: number }> = [];
  for (let typeOffset = 4; typeOffset + 4 <= bytes.length; typeOffset += 1) {
    if (strFromU8(bytes.subarray(typeOffset, typeOffset + 4)) !== "tkhd") continue;
    const boxOffset = typeOffset - 4;
    const boxSize = (
      bytes[boxOffset] * 0x1000000
      + bytes[boxOffset + 1] * 0x10000
      + bytes[boxOffset + 2] * 0x100
      + bytes[boxOffset + 3]
    );
    const boxEnd = boxOffset + boxSize;
    if (boxSize < 16 || boxEnd > bytes.length) continue;
    const readFixed16 = (offset: number) => (
      bytes[offset] * 0x1000000
      + bytes[offset + 1] * 0x10000
      + bytes[offset + 2] * 0x100
      + bytes[offset + 3]
    ) / 0x10000;
    dimensions.push({
      width: readFixed16(boxEnd - 8),
      height: readFixed16(boxEnd - 4)
    });
  }
  return dimensions;
}

function mp4HandlerTypes(bytes: Uint8Array): string[] {
  const handlers: string[] = [];
  for (let typeOffset = 4; typeOffset + 16 <= bytes.length; typeOffset += 1) {
    if (strFromU8(bytes.subarray(typeOffset, typeOffset + 4)) !== "hdlr") continue;
    handlers.push(strFromU8(bytes.subarray(typeOffset + 12, typeOffset + 16)));
  }
  return handlers;
}

async function waitForStudio(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/studio$/);
  await page.getByRole("grid", { name: "歌曲详细列表" }).waitFor();
}

async function openProjectProperties(page: Page): Promise<void> {
  const menuBar = page.getByRole("menubar", { name: "应用程序菜单" });
  await menuBar.getByRole("menuitem", { name: /项目\(P\)/ }).click();
  await page.getByRole("menu", { name: "project" }).getByRole("menuitem", { name: /项目属性/ }).click();
}

test("classic document shell uses property sheets and context help", async ({ page }) => {
  await waitForStudio(page);

  const menuBar = page.getByRole("menubar", { name: "应用程序菜单" });
  await expect(menuBar.getByRole("menuitem")).toHaveCount(5);
  const fileMenuButton = menuBar.getByRole("menuitem", { name: /文件\(F\)/ });
  await fileMenuButton.hover();
  await page.mouse.down();
  expect(await fileMenuButton.evaluate((button) => getComputedStyle(button).textShadow)).toBe("none");
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "常用命令" }).getByRole("button")).toHaveCount(5);
  await expect(page.getByRole("navigation", { name: "制作工作区" })).toHaveCount(0);
  await expect(page.locator(".application-status")).toContainText("尚未保存");
  await expect(page.getByText("要添加歌曲，请选择“文件”菜单中的“添加歌曲”，或将音频文件拖到此处。")).toBeVisible();
  const inspectorSplitter = page.getByRole("separator", { name: "调整歌曲检查器宽度" });
  await inspectorSplitter.focus();
  await page.keyboard.press("ArrowLeft");
  expect(await page.evaluate(() => localStorage.getItem("runbeat.inspector-width.v1"))).toBe("320");
  const nativeContextMenuSuppressed = await page.locator(".editor-workspace").evaluate((workspace) => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    return !workspace.dispatchEvent(event) && event.defaultPrevented;
  });
  expect(nativeContextMenuSuppressed).toBe(true);

  await openProjectProperties(page);
  const properties = page.getByRole("dialog", { name: "项目属性" });
  await expect(properties).toBeVisible();
  await expect(properties.getByRole("tab")).toHaveCount(2);
  await expect(properties.getByRole("group", { name: "项目" })).toBeVisible();
  await expect(properties.getByRole("group", { name: "将歌曲匹配到目标步频" })).toBeVisible();
  await expect(properties.getByRole("group", { name: "设置新歌曲的自动匹配规则" })).toBeVisible();
  await expect(properties.getByRole("radio", { name: "可接受 (-20% / +30%)" })).toBeChecked();
  await expect(properties.getByText("这些设置会应用到所有歌曲；之后仍可以随时回来调整。")).toHaveCount(0);
  await expect(properties.getByText("歌曲会保持音高并匹配到这个节奏")).toHaveCount(0);

  const target = properties.getByLabel("目标步频:");
  await expect(target).toHaveAttribute("min", "60");
  await expect(target).toHaveAttribute("max", "230");
  await target.press("Control+a");
  await target.pressSequentially("185");
  await expect(target).toHaveValue("185");
  await target.blur();
  await expect(target).toHaveValue("185");
  await target.focus();
  await page.keyboard.press("F1");
  await expect(page.getByRole("button", { name: /设置希望保持的每分钟步数/ })).toBeVisible();
  await page.getByRole("button", { name: /设置希望保持的每分钟步数/ }).click();

  await properties.getByRole("tab", { name: "节拍轨" }).click();
  await expect(properties.getByRole("group", { name: "选择并试听全局节拍轨" })).toBeVisible();
  await properties.getByRole("button", { name: "取消" }).click();

  await page.keyboard.press("F1");
  await expect(page.getByRole("dialog", { name: "RunBeat 帮助主题" })).toBeVisible();
  await page.getByRole("dialog", { name: "RunBeat 帮助主题" }).getByRole("button", { name: "关闭", exact: true }).click();
});

test("startup loads the core bitmap font and Help switches the persisted interface language", async ({ page }) => {
  await waitForStudio(page);

  await expect(page.locator("html")).toHaveAttribute("data-startup", "ready");
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-mode", "bitmap");
  expect(await page.evaluate(() => document.fonts.check('15px "RunBeat Bitmap UI Core"', "中文 English 0123456789"))).toBe(true);
  const initialResources = await page.evaluate(() => performance
    .getEntriesByType("resource")
    .map((entry) => entry.name));
  expect(initialResources.some((name) => name.includes("runbeat-bitmap-ui-core"))).toBe(true);
  expect(initialResources.some((name) => name.includes("wenquanyi-bitmap-song-14px-full"))).toBe(false);
  for (const deferredResource of [
    "analysis.worker",
    "essentia-wasm",
    "ffmpeg-core",
    "rubberband",
    "renderAudio",
    "ProjectPropertiesDialog",
    "ExportDialogController"
  ]) {
    expect(initialResources.some((name) => name.includes(deferredResource))).toBe(false);
  }

  const chineseMenu = page.getByRole("menubar", { name: "应用程序菜单" });
  await chineseMenu.getByRole("menuitem", { name: /帮助\(H\)/ }).click();
  await page.getByRole("menu", { name: "help" }).getByRole("menuitem", { name: /语言\(L\)/ }).hover();
  const languageMenu = page.getByRole("menu", { name: "language" });
  await expect(languageMenu.getByRole("menuitemradio", { name: "中文", exact: true })).toBeVisible();
  await expect(languageMenu.getByRole("menuitemradio", { name: "English", exact: true })).toBeVisible();
  await languageMenu.getByRole("menuitemradio", { name: "English", exact: true }).click();

  const englishMenu = page.getByRole("menubar", { name: "Application menu" });
  await expect(englishMenu.getByRole("menuitem", { name: /File\(F\)/ })).toBeVisible();
  const englishGrid = page.getByRole("grid", { name: "Track detail list" });
  await expect(englishGrid.getByRole("columnheader", { name: "Phase Accuracy" })).toBeVisible();
  await englishGrid.getByRole("separator", { name: "Resize the “Tracks” column" }).press("ArrowRight");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("runbeat.track-column-widths.v1") ?? "{}").filename)).toBe(308);
  const clippedHeaders = await englishGrid.getByRole("columnheader").evaluateAll((headers) => headers
    .filter((header) => header.scrollWidth > header.clientWidth)
    .map((header) => header.textContent?.trim()));
  expect(clippedHeaders).toEqual([]);

  await englishGrid.getByRole("columnheader", { name: "Tempo Change" }).click({ button: "right" });
  const columnMenu = page.getByRole("menu", { name: "Column Settings" });
  await columnMenu.getByRole("menuitem", { name: "Hide “Tempo Change”" }).click();
  await expect(englishGrid.getByRole("columnheader", { name: "Tempo Change" })).toHaveCount(0);
  await englishGrid.getByRole("columnheader", { name: "Tracks" }).click({ button: "right" });
  const hiddenTempoItem = page.getByRole("menu", { name: "Column Settings" }).getByRole("menuitemcheckbox", { name: "Tempo Change" });
  await expect(hiddenTempoItem).not.toBeChecked();
  await hiddenTempoItem.click();
  await expect(englishGrid.getByRole("columnheader", { name: "Tempo Change" })).toBeVisible();
  await englishGrid.getByRole("columnheader", { name: "Tempo Change" }).click({ button: "right" });
  await page.getByRole("menu", { name: "Column Settings" }).getByRole("menuitem", { name: "Hide “Tempo Change”" }).click();

  await expect(page.getByText("Track Properties", { exact: true })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/[\u3400-\u9fff]/);

  await englishMenu.getByRole("menuitem", { name: /Help\(H\)/ }).click();
  await page.getByRole("menu", { name: "help" }).getByRole("menuitem", { name: /Help Topics/ }).click();
  const helpDialog = page.getByRole("dialog", { name: "RunBeat Help Topics" });
  await expect(helpDialog.getByRole("heading", { name: "Getting Started" })).toBeVisible();
  await helpDialog.getByRole("treeitem", { name: "Overall Quality Criteria" }).click();
  await expect(helpDialog.getByRole("table", { name: "Overall Quality Factor Thresholds" })).toContainText("-20% to +30%");
  await helpDialog.getByRole("treeitem", { name: "Track Arrangement and Sorting" }).click();
  await expect(helpDialog).toContainText("signed percentages from negative to positive");
  await helpDialog.getByRole("treeitem", { name: "Preview and Manual Calibration" }).click();
  await expect(helpDialog).toContainText("Double-click a list row or press Enter");
  await helpDialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.keyboard.press("Control+o");
  const openDialog = page.getByRole("dialog", { name: "Open Project" });
  await expect(openDialog).toBeVisible();
  const titleMetrics = await openDialog.locator(":scope > .title-bar").evaluate((titleBar) => {
    const title = titleBar.querySelector<HTMLElement>(".title-bar-text")!;
    const style = getComputedStyle(title);
    return {
      height: titleBar.getBoundingClientRect().height,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom
    };
  });
  expect(titleMetrics.height).toBeLessThanOrEqual(28);
  expect(titleMetrics.fontSize).toBe("15px");
  expect(titleMetrics.lineHeight).toBe("17px");
  expect(titleMetrics.marginTop).toBe("0px");
  expect(titleMetrics.marginBottom).toBe("0px");
  await openDialog.getByRole("button", { name: "Cancel" }).click();

  await page.reload();
  await page.getByRole("grid", { name: "Track detail list" }).waitFor();
  await expect(page.getByRole("grid", { name: "Track detail list" }).getByRole("columnheader", { name: "Tempo Change" })).toHaveCount(0);
  const persistedMenu = page.getByRole("menubar", { name: "Application menu" });
  await persistedMenu.getByRole("menuitem", { name: /Help\(H\)/ }).click();
  const languageTrigger = page.getByRole("menu", { name: "help" }).getByRole("menuitem", { name: /Language\(L\)/ });
  await languageTrigger.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu", { name: "language" }).getByRole("menuitemradio", { name: "中文", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("menu", { name: "language" })).toBeHidden();
  await expect(languageTrigger).toBeFocused();
});

test("fractional display scaling uses system vector UI fonts", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1.25
  });
  const page = await context.newPage();

  try {
    await waitForStudio(page);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1.25);
    await expect(page.locator("html")).toHaveAttribute("data-ui-font-mode", "system");
    const fontFamily = await page.locator("body").evaluate((body) => getComputedStyle(body).fontFamily);
    expect(fontFamily).toContain("Tahoma");
    expect(fontFamily).not.toContain("RunBeat Bitmap UI");
    const fontResources = await page.evaluate(() => performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes("runbeat-bitmap-ui-core") || name.includes("wenquanyi-bitmap-song-14px-full")));
    expect(fontResources).toEqual([]);
  } finally {
    await context.close();
  }
});

test("the complete bitmap font stays lazy until a user-provided glyph needs it", async ({ page }) => {
  await waitForStudio(page);
  await openProjectProperties(page);
  const properties = page.getByRole("dialog", { name: "项目属性" });
  await properties.locator("#project-property-name").fill("龘");
  await properties.getByRole("button", { name: "确定", exact: true }).click();

  await expect.poll(() => page.evaluate(() => performance
    .getEntriesByType("resource")
    .some((entry) => entry.name.includes("wenquanyi-bitmap-song-14px-full")))).toBe(true);
});

test("projects save explicitly and guard destructive navigation", async ({ page }) => {
  await waitForStudio(page);

  await openProjectProperties(page);
  const properties = page.getByRole("dialog", { name: "项目属性" });
  await properties.getByLabel("名称:").fill("周二间歇跑");
  await properties.getByLabel("目标步频:").fill("178");
  await properties.getByRole("button", { name: "确定" }).click();

  await expect(page.locator(".application-title-bar")).toContainText("周二间歇跑 * - RunBeat");
  await page.keyboard.press("Control+s");
  const saveDialog = page.getByRole("dialog", { name: "保存项目" });
  await expect(saveDialog).toBeVisible();
  await expect(saveDialog.getByLabel("项目名称:")).toHaveValue("周二间歇跑");
  await saveDialog.getByRole("button", { name: "保存" }).click();
  await expect(saveDialog).toBeHidden();
  await expect(page.locator(".application-title-bar")).toContainText("周二间歇跑 - RunBeat");
  await expect(page.locator(".application-status")).toContainText(/已保存 \d{2}:\d{2}/);
  await page.getByRole("menubar", { name: "应用程序菜单" }).getByRole("menuitem", { name: /文件\(F\)/ }).click();
  await expect(page.getByRole("menu", { name: "file" }).getByRole("menuitem", { name: /1 周二间歇跑/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await openProjectProperties(page);
  await page.getByRole("dialog", { name: "项目属性" }).getByLabel("目标步频:").fill("180");
  await page.getByRole("dialog", { name: "项目属性" }).getByRole("button", { name: "确定" }).click();
  await expect(page.locator(".application-title-bar")).toContainText("*");

  await page.keyboard.press("Control+n");
  const unsaved = page.getByRole("dialog", { name: "RunBeat" });
  await expect(unsaved).toContainText("是否保存对“周二间歇跑”所做的更改？");
  await unsaved.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".application-title-bar")).toContainText("周二间歇跑 * - RunBeat");

  await page.keyboard.press("Control+n");
  await page.getByRole("dialog", { name: "RunBeat" }).getByRole("button", { name: "否(N)" }).click();
  await expect(page).toHaveURL(/\/studio\?new=/);
  await expect(page.locator(".application-title-bar")).toContainText("未命名项目 - RunBeat");

  await page.keyboard.press("Control+o");
  const openDialog = page.getByRole("dialog", { name: "打开项目" });
  await expect(openDialog.getByRole("option", { name: /周二间歇跑/ })).toBeVisible();
  await openDialog.getByRole("option", { name: /周二间歇跑/ }).dblclick();
  await expect(page).toHaveURL(/\/studio\?project=/);
  await expect(page.locator(".application-title-bar")).toContainText("周二间歇跑 - RunBeat");

  const menuBar = page.getByRole("menubar", { name: "应用程序菜单" });
  await menuBar.getByRole("menuitem", { name: /项目\(P\)/ }).click();
  await page.getByRole("menu", { name: "project" }).getByRole("menuitem", { name: /删除项目/ }).click();
  const deleteDialog = page.getByRole("dialog", { name: "删除项目" });
  await expect(deleteDialog).toContainText("周二间歇跑");
  await deleteDialog.getByRole("button", { name: "删除(Y)" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("listbox", { name: "本地项目" }).getByRole("option")).toHaveCount(0);
});

test("track projects are automatically named, saved, and restored after refresh", async ({ page }) => {
  await waitForStudio(page);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("toolbar", { name: "常用命令" }).getByRole("button", { name: "添加歌曲" }).click()
  ]);
  await chooser.setFiles([
    { name: "morning-run.wav", mimeType: "audio/wav", buffer: Buffer.from("invalid audio") },
    { name: "interval.wav", mimeType: "audio/wav", buffer: Buffer.from("invalid audio") }
  ]);

  await expect(page.locator(".application-title-bar")).toContainText("morning-run 等 2 首 - RunBeat", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/studio\?project=[^&]+$/, { timeout: 15_000 });
  await expect(page.locator(".application-status")).toContainText(/已保存 \d{2}:\d{2}/);

  const savedUrl = page.url();
  await page.reload();
  const restoredGrid = page.getByRole("grid", { name: "歌曲详细列表" });
  await restoredGrid.waitFor();

  expect(page.url()).toBe(savedUrl);
  await expect(page.locator(".application-title-bar")).toContainText("morning-run 等 2 首 - RunBeat");
  await expect(restoredGrid.getByText("morning-run.wav")).toBeVisible();
  await expect(restoredGrid.getByText("interval.wav")).toBeVisible();
  await expect(page.getByText("部分歌曲需要重新关联原始文件。")).toBeVisible();
});

test("detailed track list analyzes locally and exports a localized timeline with cover video", async ({ page }) => {
  const browserErrors: string[] = [];
  const requestedResources: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("request", (request) => requestedResources.push(request.url()));
  await waitForStudio(page);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("toolbar", { name: "常用命令" }).getByRole("button", { name: "添加歌曲" }).click()
  ]);
  await chooser.setFiles({ name: "click-176.wav", mimeType: "audio/wav", buffer: clickTrackWav() });

  const grid = page.getByRole("grid", { name: "歌曲详细列表" });
  await expect(grid.getByText("click-176.wav")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "分析进度" })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
  const addTracksButton = page.getByRole("toolbar", { name: "常用命令" }).getByRole("button", { name: "添加歌曲" });
  await expect(addTracksButton).toBeEnabled();
  const [additionalChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    addTracksButton.click()
  ]);
  await additionalChooser.setFiles({ name: "click-180.wav", mimeType: "audio/wav", buffer: clickTrackWav(180, 30) });
  await expect(grid.getByText("click-180.wav")).toBeVisible();
  const firstRowDuringAnalysis = grid.getByRole("row", { name: /click-176\.wav/ });
  await expect(firstRowDuringAnalysis).toContainText("分析完成", { timeout: 80_000 });
  await expect(page.getByRole("progressbar", { name: "分析进度" })).toBeVisible();
  await firstRowDuringAnalysis.click();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(grid.locator("tbody tr").nth(1)).toContainText("click-176.wav");
  const firstExportCheckbox = grid.getByRole("checkbox", { name: "click-176.wav 加入导出" });
  await expect(firstExportCheckbox).toBeEnabled();
  await firstExportCheckbox.uncheck();
  await firstExportCheckbox.check();
  await page.getByRole("tab", { name: "试听" }).click();
  await expect(page.getByLabel("BPM:")).toBeEnabled();
  await expect(page.getByLabel("首拍(秒):")).toBeEnabled();
  await expect(page.getByLabel("相位:")).toBeEnabled();
  await expect(page.getByLabel("入点(秒):")).toBeEnabled();
  await expect(page.getByLabel("出点(秒):")).toBeEnabled();
  const saveButton = page.getByRole("toolbar", { name: "常用命令" }).getByRole("button", { name: "保存项目" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByRole("progressbar", { name: "分析进度" })).toBeVisible();
  const fileMenuButton = page.getByRole("menubar", { name: "应用程序菜单" }).getByRole("menuitem", { name: /文件\(F\)/ });
  await fileMenuButton.click();
  const backupItem = page.getByRole("menu", { name: "file" }).getByRole("menuitem", { name: /备份项目文件/ });
  await expect(backupItem).toBeEnabled();
  const [projectBackup] = await Promise.all([
    page.waitForEvent("download"),
    backupItem.click()
  ]);
  expect(projectBackup.suggestedFilename()).toMatch(/\.runbeat\.json$/);
  await grid.getByRole("columnheader", { name: "歌曲" }).click();
  await expect(grid.getByRole("columnheader", { name: "歌曲" })).toHaveAttribute("aria-sort", "ascending");
  await openProjectProperties(page);
  const liveProjectProperties = page.getByRole("dialog", { name: "项目属性" });
  await expect(liveProjectProperties).toBeVisible();
  await liveProjectProperties.getByRole("button", { name: "取消" }).click();
  await expect(grid.getByText("分析完成")).toHaveCount(2, { timeout: 80_000 });
  await page.getByRole("tab", { name: "分析" }).click();
  const qualityBreakdown = page.getByRole("group", { name: "质量评估" });
  await expect(qualityBreakdown).toContainText("变速");
  await expect(qualityBreakdown).toContainText("BPM 置信度");
  await expect(qualityBreakdown).toContainText("相位对齐");
  await expect(qualityBreakdown).not.toContainText("决定项");
  await expect(qualityBreakdown).not.toContainText(/优秀范围|良好范围|可接受范围|置信度 ≥/);
  expect(requestedResources.some((name) => name.includes("analysis.worker"))).toBe(true);
  await expect.poll(() => requestedResources.some((name) => name.includes("essentia-wasm"))).toBe(true);
  await expect.poll(() => requestedResources.some((name) => name.includes("rubberband") && name.includes(".wasm"))).toBe(true);
  await expect.poll(() => requestedResources.some((name) => name.includes("ffmpeg-core") && name.includes(".wasm"))).toBe(true);
  await expect(grid.getByRole("columnheader")).toHaveCount(10);
  await expect(grid.getByRole("columnheader", { name: "原始 BPM" })).toBeVisible();
  await expect(grid.getByRole("columnheader", { name: "拍点" })).toBeVisible();
  await expect(grid.getByRole("columnheader", { name: "相位准确率" })).toBeVisible();
  await expect(grid.getByRole("columnheader", { name: "综合质量" })).toBeVisible();
  await expect(grid.getByRole("checkbox", { name: "click-176.wav 加入导出" })).toBeChecked();
  await grid.getByRole("checkbox", { name: "click-180.wav 加入导出" }).uncheck();

  const analyzedRow = grid.getByRole("row", { name: /click-176\.wav/ });
  await expect(analyzedRow).toContainText(/\d+ 个/);
  await expect(analyzedRow).toContainText(/\d+%/);
  await analyzedRow.click();
  await expect(page.getByText("歌曲属性", { exact: true })).toBeVisible();
  await analyzedRow.dblclick();
  await expect(page.getByRole("status")).toHaveText(/准备中|缓冲中|播放中/);
  await expect(page.getByRole("status")).toHaveText("播放中", { timeout: 80_000 });
  await page.getByLabel("首拍(秒):").fill("0.20");
  await page.getByLabel("相位:").selectOption("0.5");
  await expect(page.getByRole("status")).toHaveText("播放中");
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await page.getByRole("tab", { name: "分析" }).click();
  const analysisResults = page.getByRole("group", { name: "节奏与输出" });
  await expect(analysisResults).toContainText(/176|175|177/);
  const beatDetails = page.getByRole("group", { name: "拍点信息" });
  await expect(beatDetails).toContainText("自动首拍:");
  await expect(page.getByRole("tab", { name: "高级" })).toHaveCount(0);
  await page.getByRole("tab", { name: "试听" }).click();
  await expect(page.getByLabel("BPM:")).toBeVisible();
  await expect(page.getByLabel("首拍(秒):")).toHaveAttribute("placeholder", /^\d+\.\d{2}$/);

  const menuBar = page.getByRole("menubar", { name: "应用程序菜单" });
  await menuBar.getByRole("menuitem", { name: /帮助\(H\)/ }).click();
  await page.getByRole("menu", { name: "help" }).getByRole("menuitem", { name: /语言\(L\)/ }).hover();
  await page.getByRole("menu", { name: "language" }).getByRole("menuitemradio", { name: "English", exact: true }).click();

  const calibrationLabels = page.getByRole("group", { name: "Manual Calibration" }).locator(".classic-form-grid > label");
  await expect(calibrationLabels).toHaveCount(3);
  const calibrationLabelMetrics = await calibrationLabels.evaluateAll((labels) => labels.map((label) => ({
    textAlign: getComputedStyle(label).textAlign,
    height: label.getBoundingClientRect().height
  })));
  expect(calibrationLabelMetrics.map(({ textAlign }) => textAlign)).toEqual(["left", "left", "left"]);
  expect(new Set(calibrationLabelMetrics.map(({ height }) => Math.round(height))).size).toBe(1);

  await page.keyboard.press("Control+e");
  const wizard = page.getByRole("dialog", { name: "Export Audio Wizard" });
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: /Next/ }).click();
  await expect(wizard.getByRole("group", { name: "Cover Video (Optional)" })).toBeVisible();
  await expect(wizard.getByRole("button", { name: "Browse..." })).toBeVisible();
  await expect(wizard.getByText("No file selected")).toBeVisible();
  await wizard.getByLabel("Cover image:").setInputFiles({
    name: "morning-cover.png",
    mimeType: "image/png",
    buffer: coverPng()
  });
  await expect(wizard.getByText("morning-cover.png", { exact: true })).toBeVisible();
  await wizard.getByRole("button", { name: /Next/ }).click();
  await expect(wizard.getByRole("group", { name: "Video Format" })).toContainText("H.264");
  await wizard.getByLabel("Audio bit rate:").selectOption("128");
  await expect(wizard.getByLabel("Also export TXT / CSV timeline")).toBeChecked();
  await wizard.getByRole("button", { name: /Next/ }).click();
  await expect(wizard.getByRole("group", { name: "Export Summary" })).toContainText("MP4, H.264 + AAC, 128 kbps");
  await expect(wizard.getByRole("group", { name: "Export Summary" })).toContainText("morning-cover.png");

  const downloadPromise = page.waitForEvent("download", { timeout: 80_000 });
  await wizard.getByRole("button", { name: "Finish" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/180SPM_1min_with-beat\.zip$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const files = unzipSync(await readFile(path!));
  const names = Object.keys(files);
  const mp4Name = names.find((name) => name.endsWith(".mp4"));
  const textName = names.find((name) => name.endsWith("_timeline.txt"));
  const csvName = names.find((name) => name.endsWith("_timeline.csv"));
  expect(mp4Name).toBeDefined();
  expect(mp4Name).toMatch(/_with-beat\.mp4$/);
  expect(textName).toBeDefined();
  expect(csvName).toBeDefined();
  const mp4 = files[mp4Name!];
  expect(strFromU8(mp4.subarray(4, 8))).toBe("ftyp");
  expect(mp4TrackDimensions(mp4)).toContainEqual({ width: 1920, height: 1080 });
  expect(mp4HandlerTypes(mp4)).toEqual(expect.arrayContaining(["vide", "soun"]));
  const text = strFromU8(files[textName!]);
  const csv = strFromU8(files[csvName!]);
  expect(text).toContain("Total duration");
  expect(csv).toContain("Index,Transition Start,Track Start,Track End,Track,Original BPM,Mapped BPM,Tempo Change (%),Overall Quality");
  expect(csv).toMatch(/,(Excellent|Good|Acceptable|Not recommended|Needs calibration)\r?\n/);
  expect(text).not.toMatch(/[\u3400-\u9fff]/);
  expect(csv).not.toMatch(/[\u3400-\u9fff]/);
  await expect(wizard.getByRole("heading", { name: "Export Complete" })).toBeVisible();
  await wizard.getByRole("button", { name: "Finish" }).click();

  expect(browserErrors).toEqual([]);
});
