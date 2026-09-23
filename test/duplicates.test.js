import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { TraillineError } from "../src/errors.js";
import { findDuplicateKeys } from "../src/graph/duplicates.js";
import { readGraph, sidecarPath } from "../src/graph/parse.js";
import { tempDir } from "./helpers.js";

const paths = (text) => findDuplicateKeys(text).map((d) => d.path);

describe("findDuplicateKeys", () => {
  it("finds nothing in a graph without repeats", () => {
    assert.deepEqual(
      paths('{"nodes":{"f1":{"from":["v1"]},"f2":{"from":["v1"]}}}'),
      [],
    );
  });

  it("finds a repeated node id", () => {
    const text = '{"nodes":{"f1":{"value":1},"f1":{"value":2}}}';
    const [duplicate] = findDuplicateKeys(text);
    assert.equal(duplicate.path, "nodes.f1");
    assert.equal(text.slice(duplicate.first, duplicate.first + 4), '"f1"');
    assert.ok(duplicate.second > duplicate.first);
  });

  it("finds a repeated field inside a node", () => {
    assert.deepEqual(paths('{"nodes":{"f3":{"sql":"a","sql":"b"}}}'), [
      "nodes.f3.sql",
    ]);
  });

  it("tracks positions inside arrays", () => {
    assert.deepEqual(paths('{"a":[{"k":1},{"k":1,"k":2}]}'), ["a.1.k"]);
  });

  it("does not confuse equal keys in sibling objects", () => {
    assert.deepEqual(paths('{"a":{"x":1},"b":{"x":1}}'), []);
  });

  it("is not fooled by quotes, braces and escapes inside strings", () => {
    const text = JSON.stringify({
      nodes: { q1: { sql: 'select "a", \'{"x":1,"x":2}\' from t\\' } },
    });
    assert.deepEqual(paths(text), []);
  });

  it("compares keys after unescaping", () => {
    assert.deepEqual(paths('{"f1":1,"\\u00661":2}'), ["f1"]);
  });
});

describe("readGraph with repeated keys", () => {
  it("refuses the graph and names both lines", (t) => {
    const dir = tempDir(t);
    const report = join(dir, "r.html");
    mkdirSync(join(dir, ".trailline"));
    writeFileSync(
      sidecarPath(report),
      [
        "{",
        '  "trailline": "1.0",',
        '  "nodes": {',
        '    "f1": { "step": "figure" },',
        '    "f2": { "step": "figure" },',
        '    "f1": { "step": "figure" }',
        "  }",
        "}",
      ].join("\n"),
    );
    assert.throws(
      () => readGraph({ reportPath: report }),
      (error) =>
        error instanceof TraillineError &&
        /same key twice/.test(error.message) &&
        /`nodes\.f1` at line 4 and line 6/.test(error.message),
    );
  });
});
