export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "chore",
        "refactor",
        "test",
        "build",
        "ci",
        "perf",
        "revert",
      ],
    ],
    "subject-case": [2, "always", ["sentence-case", "lower-case"]],
  },
};
