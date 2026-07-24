#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceFont = join(
  projectRoot,
  "third_party/wenquanyi-bitmap-song/WenQuanYi-Bitmap-Song-14px.ttf"
);
const coreFont = join(projectRoot, "src/assets/fonts/runbeat-bitmap-ui-core.woff2");
const fullFont = join(projectRoot, "src/assets/fonts/wenquanyi-bitmap-song-14px-full.woff2");
const productionExtensions = new Set([".css", ".ts", ".tsx"]);
const fontToolsBinDirectory = process.env.RUNBEAT_FONTTOOLS_BIN_DIR;

function productionSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    if (
      !productionExtensions.has(extname(entry.name))
      || entry.name.includes(".test.")
      || entry.name.includes(".spec.")
    ) return [];
    return [path];
  });
}

function uiUnicodeRanges() {
  const files = [
    ...productionSourceFiles(join(projectRoot, "src")),
    join(projectRoot, "index.html")
  ];
  const codePoints = new Set();
  for (let codePoint = 0x20; codePoint <= 0x7e; codePoint += 1) {
    codePoints.add(codePoint);
  }
  for (const file of files) {
    for (const character of readFileSync(file, "utf8")) {
      const codePoint = character.codePointAt(0);
      if (codePoint != null && codePoint >= 0x80) codePoints.add(codePoint);
    }
  }

  const ranges = [];
  for (const codePoint of [...codePoints].sort((left, right) => left - right)) {
    const previous = ranges.at(-1);
    if (previous && codePoint === previous[1] + 1) previous[1] = codePoint;
    else ranges.push([codePoint, codePoint]);
  }
  const hex = (value) => value.toString(16).toUpperCase().padStart(4, "0");
  return {
    codePointCount: codePoints.size,
    value: ranges
      .map(([start, end]) => start === end ? `U+${hex(start)}` : `U+${hex(start)}-${hex(end)}`)
      .join(",")
  };
}

function run(command, args) {
  const executable = fontToolsBinDirectory ? join(fontToolsBinDirectory, command) : command;
  const result = spawnSync(executable, args, { cwd: projectRoot, stdio: "inherit" });
  if (result.error?.code === "ENOENT") {
    throw new Error(
      `${command} is required. Install FontTools with WOFF support: pip install "fonttools[woff]"`
    );
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function fileSummary(path) {
  const content = readFileSync(path);
  return {
    path: relative(projectRoot, path),
    bytes: statSync(path).size,
    sha256: createHash("sha256").update(content).digest("hex")
  };
}

mkdirSync(dirname(coreFont), { recursive: true });
const unicodeRanges = uiUnicodeRanges();

run("fonttools", [
  "ttLib.woff2",
  "compress",
  sourceFont,
  "-o",
  fullFont
]);
run("pyftsubset", [
  sourceFont,
  `--unicodes=${unicodeRanges.value}`,
  "--flavor=woff2",
  `--output-file=${coreFont}`,
  "--name-IDs=*",
  "--name-languages=*"
]);

console.log(JSON.stringify({
  uiCodePoints: unicodeRanges.codePointCount,
  outputs: [fileSummary(coreFont), fileSummary(fullFont)]
}, null, 2));
