import js from "@eslint/js";

// Node globals this project actually uses. Kept explicit rather than pulled
// from a globals package, so the dependency list stays at zero runtime and
// four dev entries.
const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  AbortController: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  structuredClone: "readonly",
};

// Browser globals the viewer page uses (src/viewer/client/viewer.js).
const browserGlobals = {
  CSS: "readonly",
  document: "readonly",
  fetch: "readonly",
  history: "readonly",
  localStorage: "readonly",
  location: "readonly",
  matchMedia: "readonly",
  navigator: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
};

export default [
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/viewer/client/**/*.js"],
    languageOptions: { globals: browserGlobals },
  },
  {
    ignores: ["node_modules/", "docs/", ".claude/"],
  },
];
