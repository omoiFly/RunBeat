import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "vendor/rubberband", "src/assets/wasm"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly" }
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { window: "readonly", document: "readonly", navigator: "readonly", crypto: "readonly", alert: "readonly", self: "readonly", Audio: "readonly", AudioContext: "readonly", File: "readonly", Blob: "readonly", Worker: "readonly", URL: "readonly", DOMException: "readonly", console: "readonly", setTimeout: "readonly", performance: "readonly" } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: { ...reactHooks.configs.recommended.rules, ...reactRefresh.configs.vite.rules, "@typescript-eslint/no-explicit-any": "off" }
  }
);
