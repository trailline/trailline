import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Read name and version straight from package.json rather than importing it,
 * so this works identically on every supported Node version without relying
 * on import attributes.
 */
export function packageMeta() {
  const path = fileURLToPath(new URL("../package.json", import.meta.url));
  const { name, version } = JSON.parse(readFileSync(path, "utf8"));
  return { name, version };
}
