import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

function beatWav(frequency = 440): Buffer {
  const rate = 44_100;
  const frames = 8_820;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) bytes.writeInt16LE(Math.round(25000 * Math.sin(2 * Math.PI * frequency * frame / rate) * Math.exp(-frame / 1200)), 44 + frame * 2);
  return bytes;
}

async function seed(page: Page, ids: string[], projectIds: string[] = []) {
  await page.evaluate(async ({ ids, projectIds }) => {
    const dbUrl = "/src/services/db.ts";
    const typesUrl = "/src/domain/types.ts";
    const { db } = await import(dbUrl);
    const { createProject } = await import(typesUrl);
    for (const [index, id] of ids.entries()) {
      await db.customBeatResources.put({ id, channels: [Float32Array.from([0.9, (index + 1) / 10])], sampleRate: 44_100, name: id, nameKey: id.toLowerCase(), fileName: `${id}.wav`, fileSize: 4, mimeType: "audio/wav", lastModified: 1, durationSeconds: 2 / 44100, createdAt: Date.now() + index });
    }
    for (const id of projectIds) {
      const project = createProject(id); project.id = id;
      project.beatTrack = { ...project.beatTrack, sound: "custom", customSample: { resourceId: ids[0], fileName: `${ids[0]}.wav`, fileSize: 4, mimeType: "audio/wav", lastModified: 1, durationSeconds: 2 / 44100, available: true } };
      await db.projects.put({ id, updatedAt: project.updatedAt, project });
    }
  }, { ids, projectIds });
}

async function selectInStore(page: Page, id: string) {
  await page.evaluate(async (id) => {
    const storeUrl = "/src/store/projectStore.ts";
    const { useProjectStore } = await import(storeUrl);
    const state = useProjectStore.getState();
    await state.applyProjectProperties({ beatTrack: { ...state.project.beatTrack, sound: "custom", customSample: { resourceId: id, fileName: `${id}.wav`, fileSize: 4, mimeType: "audio/wav", lastModified: 1, durationSeconds: 2 / 44100, available: true } } });
  }, id);
}

async function remove(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const libraryUrl = "/src/services/beatLibrary.ts";
    try { await (await import(libraryUrl)).deleteLibraryBeat(id); return "deleted"; }
    catch (error) { return String(error); }
  }, id);
}

async function openLibrary(page: Page) {
  await page.getByRole("menubar").getByRole("menuitem", { name: /工具\(T\)/ }).click();
  await page.getByRole("menu", { name: "tools" }).getByRole("menuitem", { name: /鼓点库/ }).click();
  return page.getByRole("dialog", { name: "鼓点库", exact: true });
}
async function properties(page: Page) {
  await page.getByRole("grid", { name: "歌曲详细列表" }).waitFor();
  const projectId = new URL(page.url()).searchParams.get("project");
  if (projectId) await expect.poll(() => page.evaluate(async () => {
    const url = "/src/store/projectStore.ts";
    return (await import(url)).useProjectStore.getState().project.id;
  })).toBe(projectId);
  await page.getByRole("menubar").getByRole("menuitem", { name: /项目\(P\)/ }).click();
  await page.getByRole("menu", { name: "project" }).getByRole("menuitem", { name: /项目属性/ }).click();
  const dialog = page.getByRole("dialog", { name: "项目属性", exact: true });
  await dialog.getByRole("tab", { name: "节拍轨" }).click();
  return dialog;
}

test("library works without a project: upload, deduplicate, preview, original download and delete", async ({ page }) => {
  await page.goto("/projects");
  const library = await openLibrary(page);
  const bytes = beatWav();
  await library.getByLabel("上传鼓点", { exact: true }).setInputFiles({ name: "My beat.wav", mimeType: "audio/wav", buffer: bytes });
  await expect(library.getByRole("row", { name: /^My beat 0/ })).toBeVisible();
  await library.getByLabel("上传鼓点", { exact: true }).setInputFiles({ name: "Same beat.wav", mimeType: "audio/wav", buffer: bytes });
  await expect(library.getByText("已加入鼓点库；相同文件会自动复用。", { exact: true })).toBeVisible();
  await expect(library.getByRole("row")).toHaveCount(2);
  await library.getByRole("button", { name: "试听", exact: true }).click();
  await expect(library.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await library.getByRole("button", { name: "停止", exact: true }).click();
  const pendingDownload = page.waitForEvent("download");
  await library.getByRole("button", { name: "下载", exact: true }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("My beat.wav");
  expect(await readFile((await download.path())!)).toEqual(bytes);
  await library.getByLabel("上传鼓点", { exact: true }).setInputFiles({ name: "Second beat.wav", mimeType: "audio/wav", buffer: beatWav(880) });
  await expect(library.getByRole("row")).toHaveCount(3);
  await page.screenshot({ path: "test-results/beat-library.png" });
  await library.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog", { name: "删除鼓点", exact: true }).getByRole("button", { name: "删除", exact: true }).click();
  await expect(library.getByRole("row")).toHaveCount(2);
  await library.getByRole("button", { name: "清理未使用...", exact: true }).click();
  await page.getByRole("dialog", { name: "清理未使用鼓点", exact: true }).getByRole("button", { name: "删除", exact: true }).click();
  await expect(library.getByText("鼓点库为空，点击“上传”添加第一个鼓点。", { exact: true })).toBeVisible();
});

test("names same-name uploads and renames shared beats without changing audio or project references", async ({ page }) => {
  await page.goto("/projects");
  let library = await openLibrary(page);
  const bytes = beatWav();
  const upload = library.getByLabel("上传鼓点", { exact: true });
  await upload.setInputFiles({ name: "Kick.wav", mimeType: "audio/wav", buffer: bytes });
  await expect(library.getByRole("row", { name: /^Kick 0/ })).toBeVisible();
  await upload.setInputFiles({ name: "Kick.wav", mimeType: "audio/wav", buffer: beatWav(880) });
  await expect(library.getByRole("row", { name: /^Kick \(2\) 0/ })).toBeVisible();
  await library.getByRole("row", { name: /^Kick 0/ }).click();
  await library.getByRole("row", { name: /^Kick 0/ }).press("F2");
  let rename = page.getByRole("dialog", { name: "重命名鼓点", exact: true });
  await expect(rename.getByLabel("鼓点名称:")).toHaveValue("Kick");
  await rename.getByLabel("鼓点名称:").fill(" ");
  await expect(rename.getByRole("button", { name: "确定", exact: true })).toBeDisabled();
  await rename.getByLabel("鼓点名称:").fill(" KICK (2) ");
  await rename.getByRole("button", { name: "确定", exact: true }).click();
  await expect(rename.getByRole("alert")).toHaveText("鼓点库中已有这个名称，请换一个名称。");
  await rename.getByLabel("鼓点名称:").fill(" 厚实底鼓 ");
  await rename.getByRole("button", { name: "确定", exact: true }).click();
  await expect(rename).toBeHidden();
  await expect(library.getByRole("row", { name: /^厚实底鼓 / })).toBeVisible();
  await library.getByRole("button", { name: "试听", exact: true }).click();
  await library.getByRole("button", { name: "停止", exact: true }).click();
  const pendingDownload = page.waitForEvent("download");
  await library.getByRole("button", { name: "下载", exact: true }).click();
  const downloaded = await pendingDownload;
  expect(downloaded.suggestedFilename()).toBe("Kick.wav");
  expect(await readFile((await downloaded.path())!)).toEqual(bytes);
  await upload.setInputFiles({ name: "Renamed upload.wav", mimeType: "audio/wav", buffer: bytes });
  await expect(library.getByRole("button", { name: "上传...", exact: true })).toBeEnabled();
  await expect(library.getByRole("row")).toHaveCount(3);
  await expect(library.getByRole("row", { name: /^厚实底鼓 / })).toBeVisible();
  await library.getByLabel("查找鼓点:").fill("Kick.wav");
  await expect(library.getByRole("row")).toHaveCount(3);

  const resourceId = await page.evaluate(async () => {
    const dbUrl = "/src/services/db.ts"; const typesUrl = "/src/domain/types.ts"; const libraryUrl = "/src/services/beatLibrary.ts";
    const { db } = await import(dbUrl); const { createProject } = await import(typesUrl); const { beatSampleReference } = await import(libraryUrl);
    const resource = await db.customBeatResources.where("nameKey").equals("厚实底鼓").first();
    for (const id of ["named-first", "named-second"]) {
      const project = createProject(id); project.id = id;
      project.beatTrack = { ...project.beatTrack, sound: "custom", customSample: beatSampleReference(resource) };
      await db.projects.put({ id, updatedAt: project.updatedAt, project });
    }
    return resource.id;
  });
  await page.goto("/studio?project=named-first");
  const dialog = await properties(page);
  await expect(dialog.getByRole("combobox", { name: "声音:" })).toHaveValue(`custom:${resourceId}`);
  await expect(dialog.getByText("厚实底鼓 · 180 SPM", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "打开鼓点库", exact: true }).click();
  library = page.getByRole("dialog", { name: "鼓点库", exact: true });
  await library.getByRole("row", { name: /^厚实底鼓 / }).click();
  await expect(library.getByRole("button", { name: "删除", exact: true })).toBeDisabled();
  await library.getByRole("button", { name: "重命名...", exact: true }).click();
  rename = page.getByRole("dialog", { name: "重命名鼓点", exact: true });
  await rename.getByLabel("鼓点名称:").fill("晨跑鼓点");
  await rename.getByRole("button", { name: "确定", exact: true }).click();
  await expect(rename).toBeHidden();
  await expect(library.getByRole("row", { name: /^晨跑鼓点 / })).toBeVisible();
  await page.screenshot({ path: "test-results/beat-library-names.png" });
  await library.getByRole("button", { name: "关闭", exact: true }).last().click();
  await expect(dialog.getByText("晨跑鼓点 · 180 SPM", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "声音:" }).locator("option:checked")).toHaveText("晨跑鼓点");
  await expect(dialog.getByRole("button", { name: "试听", exact: true })).toBeEnabled();
  expect(await page.evaluate(async () => {
    const dbUrl = "/src/services/db.ts";
    return (await (await import(dbUrl)).db.projects.toArray()).map(({ project }: { project: { beatTrack: { customSample: { resourceId: string; fileName: string } } } }) => ({ id: project.beatTrack.customSample.resourceId, fileName: project.beatTrack.customSample.fileName }));
  })).toEqual([{ id: resourceId, fileName: "Kick.wav" }, { id: resourceId, fileName: "Kick.wav" }]);
  await page.goto("/studio?project=named-second");
  const second = await properties(page);
  await expect(second.getByRole("combobox", { name: "声音:" }).locator("option:checked")).toHaveText("晨跑鼓点");
  await expect(second.getByRole("button", { name: "试听", exact: true })).toBeEnabled();
});

test("concurrent additions and renames keep names unique and within the length limit", async ({ page }) => {
  await page.goto("/projects");
  const result = await page.evaluate(async () => {
    const dbUrl = "/src/services/db.ts"; const libraryUrl = "/src/services/beatLibrary.ts";
    const { db, saveCustomBeatResource } = await import(dbUrl); const { renameLibraryBeat } = await import(libraryUrl);
    const resources = await Promise.all(["a", "b", "c"].map((id) => saveCustomBeatResource({ id, channels: [Float32Array.from([0.9])], sampleRate: 44100, fileName: `${"x".repeat(100)}.wav`, fileSize: 4, mimeType: "audio/wav", lastModified: 1, durationSeconds: 1 / 44100, createdAt: 1 })));
    const renames = await Promise.allSettled([renameLibraryBeat("a", "Shared"), renameLibraryBeat("b", " SHARED ")]);
    const invalid = await Promise.allSettled([renameLibraryBeat("c", " "), renameLibraryBeat("c", "x".repeat(81))]);
    return { defaults: resources.map((item) => item.name), renamed: renames.map((item) => item.status), invalid: invalid.map((item) => item.status), keys: await db.customBeatResources.orderBy("nameKey").keys() };
  });
  expect(result.defaults).toEqual(["x".repeat(80), `${"x".repeat(76)} (2)`, `${"x".repeat(76)} (3)`]);
  expect(result.renamed.filter((status) => status === "fulfilled")).toHaveLength(1);
  expect(result.invalid).toEqual(["rejected", "rejected"]);
  expect(new Set(result.keys).size).toBe(3);
});

test("existing library entries gain distinct default names while IDs, originals and audio stay intact", async ({ page }) => {
  await page.route("**/name-migration-seed", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Name migration fixture</title>" }));
  await page.goto("/name-migration-seed");
  const original = beatWav();
  await page.evaluate(async (bytes) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("runbeat", 30);
      request.onupgradeneeded = () => {
        const projects = request.result.createObjectStore("projects", { keyPath: "id" }); projects.createIndex("updatedAt", "updatedAt");
        const resources = request.result.createObjectStore("customBeatResources", { keyPath: "id" });
        resources.createIndex("createdAt", "createdAt"); resources.createIndex("contentHash", "contentHash", { unique: true });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result; const transaction = database.transaction("customBeatResources", "readwrite");
        for (const [index, id] of ["a", "b"].entries()) transaction.objectStore("customBeatResources").put({ id, fileName: index ? "Kick.mp3" : "Kick.wav", fileSize: bytes.length, mimeType: "audio/wav", lastModified: 1, durationSeconds: 0.2, createdAt: index, contentHash: id.repeat(64), channels: [Float32Array.from([0.9, 0.1])], sampleRate: 44100, originalFile: new Blob([Uint8Array.from(bytes)], { type: "audio/wav" }) });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, [...original]);
  await page.goto("/projects");
  const library = await openLibrary(page);
  await expect(library.getByRole("row", { name: /^Kick 0/ })).toBeVisible();
  await expect(library.getByRole("row", { name: /^Kick \(2\) 0/ })).toBeVisible();
  expect(await page.evaluate(async () => {
    const dbUrl = "/src/services/db.ts";
    return (await (await import(dbUrl)).db.customBeatResources.orderBy("createdAt").toArray()).map((resource: { id: string; name: string; fileName: string; contentHash: string; channels: Float32Array[]; originalFile: Blob }) => ({ id: resource.id, name: resource.name, fileName: resource.fileName, hash: resource.contentHash, frames: resource.channels[0].length, originalSize: resource.originalFile.size }));
  })).toEqual([
    { id: "a", name: "Kick", fileName: "Kick.wav", hash: "a".repeat(64), frames: 2, originalSize: original.length },
    { id: "b", name: "Kick (2)", fileName: "Kick.mp3", hash: "b".repeat(64), frames: 2, originalSize: original.length }
  ]);
});

test("project selection survives built-in switches, apply, save and reload", async ({ page }) => {
  await page.goto("/projects");
  await seed(page, ["a", "b"], ["saved-a"]);
  await page.goto("/studio?project=saved-a");
  let dialog = await properties(page);
  await expect(dialog.getByRole("combobox", { name: "声音:" })).toHaveValue("custom:a");
  await expect(dialog.getByRole("button", { name: "试听", exact: true })).toBeEnabled();
  expect(await dialog.locator('input[type="file"]').count()).toBe(0);
  await dialog.getByRole("combobox", { name: "声音:" }).selectOption("click");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  dialog = await properties(page);
  await dialog.getByRole("combobox", { name: "声音:" }).selectOption("custom:b");
  await expect(dialog.getByRole("button", { name: "试听", exact: true })).toBeEnabled();
  await dialog.getByRole("combobox", { name: "声音:" }).selectOption("click");
  await dialog.getByRole("button", { name: "应用", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "应用", exact: true })).toBeEnabled();
  await dialog.getByRole("combobox", { name: "声音:" }).selectOption("custom:a");
  await expect(dialog.getByRole("button", { name: "试听", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "试听", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await page.evaluate(async () => {
    const storeUrl = "/src/store/projectStore.ts";
    await (await import(storeUrl)).useProjectStore.getState().saveCurrent();
  });
  await page.reload();
  dialog = await properties(page);
  await expect(dialog.getByRole("combobox", { name: "声音:" })).toHaveValue("custom:a");
  await expect(dialog.getByRole("button", { name: "试听", exact: true })).toBeEnabled();
  expect(await page.evaluate(async () => {
    const storeUrl = "/src/store/projectStore.ts"; const beatUrl = "/src/services/customBeat.ts";
    const state = (await import(storeUrl)).useProjectStore.getState();
    return (await import(beatUrl)).getCustomBeatSample(state.project.beatTrack.customSample).channels[0][1];
  })).toBeCloseTo(0.1);
});

test("deleting a project preserves shared library audio until its last saved reference is gone", async ({ page }) => {
  await page.goto("/projects");
  await seed(page, ["shared"], ["first", "second"]);
  await page.evaluate(async () => { const url = "/src/services/db.ts"; await (await import(url)).deleteProject("first"); });
  expect(await remove(page, "shared")).toContain("仍被项目");
  await page.evaluate(async () => { const url = "/src/services/db.ts"; await (await import(url)).deleteProject("second"); });
  expect(await remove(page, "shared")).toBe("deleted");
});

test("other tabs cannot delete unsaved choices, undo or redo resources; closing the editing tab releases them", async ({ page, context }) => {
  await page.goto("/studio");
  await page.getByRole("grid", { name: "歌曲详细列表" }).waitFor();
  await seed(page, ["a", "b"]);
  await selectInStore(page, "a");
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.some((lock) => lock.name === "runbeat:beat-resource:a"))).toBe(true);
  const other = await context.newPage();
  await other.goto("/projects");
  expect(await remove(other, "a")).toContain("仍被项目");
  const draft = await properties(page);
  await draft.getByRole("combobox", { name: "声音:" }).selectOption("custom:b");
  await expect(draft.getByRole("button", { name: "试听", exact: true })).toBeEnabled();
  expect(await remove(other, "b")).toContain("仍被项目");
  await draft.getByRole("button", { name: "取消", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.some((lock) => lock.name === "runbeat:beat-resource:b"))).toBe(false);
  // Separate user edits beyond the existing 750 ms history grouping window.
  await page.waitForTimeout(800);
  await selectInStore(page, "b");
  expect(await remove(other, "a")).toContain("仍被项目");
  await page.evaluate(async () => { const url = "/src/store/projectStore.ts"; (await import(url)).useProjectStore.getState().undo(); });
  expect(await remove(other, "b")).toContain("仍被项目");
  await page.close();
  await expect.poll(() => remove(other, "a")).toBe("deleted");
  expect(await remove(other, "b")).toBe("deleted");
  await other.close();
});

test("cleanup rechecks references and only acts on the confirmed resource IDs", async ({ page }) => {
  await page.goto("/projects");
  await seed(page, ["used", "unused", "new-upload"], ["project"]);
  const result = await page.evaluate(async () => {
    const libraryUrl = "/src/services/beatLibrary.ts"; const dbUrl = "/src/services/db.ts";
    const result = await (await import(libraryUrl)).cleanUnusedLibraryBeats(["used", "unused"]);
    return { ...result, remaining: await (await import(dbUrl)).db.customBeatResources.toCollection().primaryKeys() };
  });
  expect(result).toEqual({ deleted: 1, skipped: 1, remaining: ["new-upload", "used"] });
});

test("upgrades PR-era PCM resources without losing project references and downloads legacy audio as WAV", async ({ page }) => {
  await page.route("**/migration-seed", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Migration fixture</title>" }));
  await page.goto("/migration-seed");
  await page.evaluate(async () => {
    const typesUrl = "/src/domain/types.ts";
    const project = (await import(typesUrl)).createProject("Legacy"); project.id = "legacy-project";
    project.beatTrack = { ...project.beatTrack, sound: "custom", customSample: { resourceId: "legacy", fileName: "Old beat.mp3", fileSize: 4, mimeType: "audio/mpeg", lastModified: 1, durationSeconds: 1, available: true } };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("runbeat", 20);
      request.onupgradeneeded = () => {
        const projects = request.result.createObjectStore("projects", { keyPath: "id" }); projects.createIndex("updatedAt", "updatedAt");
        request.result.createObjectStore("customBeatResources", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result; const transaction = database.transaction(["projects", "customBeatResources"], "readwrite");
        transaction.objectStore("projects").put({ id: project.id, updatedAt: project.updatedAt, project });
        const pcm = new Float32Array(44100); pcm[0] = 0.9;
        transaction.objectStore("customBeatResources").put({ id: "legacy", channels: [pcm], sampleRate: 44100 });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.goto("/studio?project=legacy-project");
  const dialog = await properties(page);
  await expect(dialog.getByRole("combobox", { name: "声音:" })).toHaveValue("custom:legacy");
  await expect(dialog.getByRole("button", { name: "试听", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "打开鼓点库", exact: true }).click();
  const library = page.getByRole("dialog", { name: "鼓点库", exact: true });
  await expect(library.getByRole("row", { name: /^Old beat / })).toBeVisible();
  await expect(library.getByRole("button", { name: "删除", exact: true })).toBeDisabled();
  const pending = page.waitForEvent("download");
  await library.getByRole("button", { name: "下载", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("Old beat.wav");
  expect((await readFile((await download.path())!)).subarray(0, 4).toString()).toBe("RIFF");
  await library.getByRole("button", { name: "关闭", exact: true }).last().click();
  await expect(dialog).toBeVisible();
});
