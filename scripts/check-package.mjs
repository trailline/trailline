/**
 * Assert the published tarball actually contains the CLI.
 *
 * The `files` array in package.json is an allowlist, so adding a directory to
 * the repo does not add it to the package. Forgetting to widen it publishes a
 * tarball whose bin entry points at nothing, and npm reports no error. This
 * runs in CI so that failure is loud and early.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REQUIRED = [
  "index.js",
  "src/cli.js",
  "src/errors.js",
  "src/help.js",
  "src/meta.js",
  "src/commands/index.js",
  "src/commands/check.js",
  "src/commands/source.js",
  "src/commands/sql.js",
  "src/commands/view.js",
  "src/graph/duplicates.js",
  "src/graph/expr.js",
  "src/graph/ids.js",
  "src/graph/numbers.js",
  "src/graph/parse.js",
  "src/graph/schema.js",
  "package.json",
  "README.md",
  "LICENSE",
];

const FORBIDDEN = [/^docs\//, /^test\//, /^scripts\//, /^\.env/];

// npm writes to its cache even for a dry run. Point it at a scratch directory
// so this works on a locked-down machine and cannot be skewed by a warm cache.
const cache = mkdtempSync(join(tmpdir(), "trailline-pack-"));

let raw;
try {
  raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--cache", cache], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  console.error("Could not run `npm pack --dry-run`:");
  console.error((error.stdout || error.stderr || error.message).trim());
  process.exit(1);
} finally {
  rmSync(cache, { recursive: true, force: true });
}

const [tarball] = JSON.parse(raw);
const shipped = new Set(tarball.files.map((file) => file.path));

const missing = REQUIRED.filter((path) => !shipped.has(path));
const leaked = [...shipped].filter((path) =>
  FORBIDDEN.some((pattern) => pattern.test(path)),
);

if (missing.length > 0) {
  console.error("Package is missing required files:");
  for (const path of missing) console.error(`  ${path}`);
}
if (leaked.length > 0) {
  console.error("Package contains files that should not ship:");
  for (const path of leaked) console.error(`  ${path}`);
}
if (missing.length > 0 || leaked.length > 0) {
  console.error(`\n${shipped.size} files were staged for publish.`);
  process.exit(1);
}

console.log(
  `Package looks right: ${shipped.size} files, ${tarball.size} bytes packed.`,
);
