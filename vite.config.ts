import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { Buffer } from "node:buffer";
import type { Plugin } from "vite";

function fix98CssMediaQuery(): Plugin {
  return {
    name: "fix-98-css-media-query",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("98.css") || !id.endsWith(".css")) return null;
      return code.replaceAll("@media (not(hover))", "@media (hover: none)");
    }
  };
}

function externalizeEssentiaWasm(): Plugin {
  const embeddedDeclarationPrefix = 'var wasmBinaryFile="data:application/octet-stream;base64,';
  const locateEmbeddedWasm = "if(!isDataURI(wasmBinaryFile)){wasmBinaryFile=locateFile(wasmBinaryFile)}";

  return {
    name: "externalize-essentia-wasm",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?")[0].endsWith("/essentia.js/dist/essentia-wasm.es.js")) return null;
      const declarationStart = code.indexOf(embeddedDeclarationPrefix);
      const declarationEnd = declarationStart < 0 ? -1 : code.indexOf('";', declarationStart);
      if (declarationStart < 0 || declarationEnd < 0 || !code.includes(locateEmbeddedWasm)) {
        this.error("The installed Essentia WASM wrapper no longer matches the externalization transform");
      }
      const encodedWasm = code.slice(declarationStart + embeddedDeclarationPrefix.length, declarationEnd);
      const wasmReference = this.emitFile({
        type: "asset",
        name: "essentia-wasm.es.wasm",
        source: Buffer.from(encodedWasm, "base64")
      });
      const withoutEmbeddedBinary = `${code.slice(0, declarationStart)}var wasmBinaryFile=import.meta.ROLLUP_FILE_URL_${wasmReference}${code.slice(declarationEnd + 1)}`;
      return {
        code: withoutEmbeddedBinary.replace(locateEmbeddedWasm, ""),
        map: null
      };
    }
  };
}

function preloadPrimaryStudioChunk(): Plugin {
  return {
    name: "preload-primary-studio-chunk",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const studioChunk = Object.values(context.bundle ?? {}).find((output) =>
          output.type === "chunk"
          && Object.keys(output.modules).some((id) => id.endsWith("/src/pages/StudioPage.tsx"))
        );
        if (!studioChunk || studioChunk.type !== "chunk") {
          throw new Error("Could not resolve the primary Studio chunk for preload");
        }
        return [{
          tag: "link",
          attrs: {
            rel: "modulepreload",
            crossorigin: true,
            href: `/${studioChunk.fileName}`
          },
          injectTo: "head"
        }];
      }
    }
  };
}

export default defineConfig({
  plugins: [
    fix98CssMediaQuery(),
    externalizeEssentiaWasm(),
    react(),
    tailwindcss(),
    preloadPrimaryStudioChunk()
  ],
  worker: {
    format: "es",
    plugins: () => [externalizeEssentiaWasm()]
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    exclude: ["e2e/**", "node_modules/**", "dist/**"]
  }
});
