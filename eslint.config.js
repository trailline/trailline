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
    ignores: ["node_modules/", "docs/"],
  },
];
