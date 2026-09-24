import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "../src/cli.js";

/** Run the CLI in-process and collect everything it printed. */
export async function runCli(argv) {
  const out = [];
  const err = [];
  const code = await main(argv, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** Paths and the expected-issues contract for one fixture report. */
export function loadFixture(name) {
  const dir = join(FIXTURES, name);
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  return { dir, reportPath: join(dir, expected.report), expected };
}

export const FIXTURE_NAMES = ["clean", "messy", "broken"];

/** A throwaway directory, removed when the test finishes. */
export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "trailline-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
