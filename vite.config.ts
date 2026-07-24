import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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

export default defineConfig({
  plugins: [fix98CssMediaQuery(), react(), tailwindcss()],
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    exclude: ["e2e/**", "node_modules/**", "dist/**"]
  }
});
