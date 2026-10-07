import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { TraillineError } from "../src/errors.js";
import { readGraph } from "../src/graph/parse.js";
import { buildPayload } from "../src/viewer/payload.js";
import {
  CLEAN_F3_SQL,
  CLEAN_I3_SQL,
  CLEAN_SQL,
  FIXTURE_NAMES,
  loadFixture,
  MESSY_F3_SQL,
  MESSY_SQL,
  runCli,
  tempDir,
} from "./helpers.js";

const R0 =
  "<html><head><title>r</title></head><body><p>Hello.</p></body></html>";

const G1 = {
  trailline: "1.0",
  nodes: {
    q1: { step: "source", kind: "sql", sql: "select amount from sales" },
    f1: {
      step: "figure",
      from: ["q1"],
      sql: "select amount from q1",
      label: "Sales",
      value: 12,
      display: "12",
    },
  },
};
const R_F1 =
  '<html><head></head><body><p>Sales were <span data-trailline="f1">12</span>.</p></body></html>';
const ONE =
  "-- r.html\nwith\nq1 as (\n    select amount from sales\n),\nf1 (value) as (\n    select amount from q1\n)\nselect 'f1' as figure, 'Sales' as label, cast((select value from f1) as varchar) as value";

const G2 = {
  trailline: "1.0",
  nodes: {
    q1: G1.nodes.q1,
    x1: {
      step: "source",
      kind: "external",
      type: "csv",
      ref: "t.csv",
      given: "Q3 targets",
    },
    v1: { step: "view", from: ["x1"], sql: "select target from x1" },
    f1: G1.nodes.f1,
    i1: {
      step: "insight",
      from: [],
      ungrounded: true,
      text: "Benchmarks sit around 35%.",
    },
  },
};
const R_G2 =
  '<html><head></head><body><p>Sales were <span data-trailline="f1">12</span>.</p>' +
  '<table data-trailline="v1"><tr><td>a</td></tr></table>' +
  '<p data-trailline="i1">Benchmarks sit around 35%.</p></body></html>';

/** Write <dir>/r.html, and <dir>/.trailline/r.json when a graph is given. */
function report(t, html, graph) {
  const dir = tempDir(t);
  const path = join(dir, "r.html");
  writeFileSync(path, html);
  if (graph) {
    mkdirSync(join(dir, ".trailline"));
    writeFileSync(join(dir, ".trailline", "r.json"), JSON.stringify(graph));
  }
  return { dir, path };
}

const pay = (path, graphPath) => buildPayload({ reportPath: path, graphPath });
const F1_SQL = ONE.replace("-- r.html", "-- r.html (f1)");
const Q1_SQL =
  "-- r.html (q1)\nwith\nq1 as (\n    select amount from sales\n)\nselect * from q1";
const REFUSED = (name) =>
  `${name} does not pass \`trailline check\`, so no script was composed`;
const checkJson = async (path) =>
  JSON.parse((await runCli(["check", path, "--no-embed", "--json"])).out);

describe("buildPayload", () => {
  it("returns the report's file name and its HTML as read", (t) => {
    const { path } = report(t, R_F1, G1);
    const p = pay(path);
    assert.equal(p.report, "r.html");
    assert.equal(p.html, R_F1);
  });

  it("returns the graph from the sidecar", (t) => {
    const { path } = report(t, R_F1, G1);
    assert.deepEqual(pay(path).graph, G1);
  });

  it("reads the graph from graphPath when given", (t) => {
    const { dir, path } = report(t, R_F1);
    writeFileSync(join(dir, "other.json"), JSON.stringify(G1));
    assert.deepEqual(pay(path, join(dir, "other.json")).graph, G1);
  });

  it("gives each node's trace state as a plain object", (t) => {
    const { path } = report(t, R_F1, G1);
    assert.deepEqual(pay(path).trace, { q1: "full", f1: "full" });
  });

  it("gives the summary check --json prints", async (t) => {
    const { path } = report(t, R_F1, G1);
    const { summary } = pay(path);
    assert.deepEqual(summary, await checkJson(path));
    assert.equal(summary.issues.length, 1);
    const [issue] = summary.issues;
    assert.deepEqual(
      [issue.code, issue.severity, issue.node],
      ["C7", "warning", "q1"],
    );
  });

  it("composes the whole report as trailline sql does", (t) => {
    const { path } = report(t, R_F1, G1);
    assert.equal(pay(path).composedReport, ONE);
  });

  it("composes each node as trailline sql --id does", (t) => {
    const { path } = report(t, R_F1, G1);
    assert.deepEqual(pay(path).composed, { q1: Q1_SQL, f1: F1_SQL });
  });

  it("leaves out nodes with nothing to run", (t) => {
    const { path } = report(t, R_G2, G2);
    assert.deepEqual(pay(path).composed, { q1: Q1_SQL, f1: F1_SQL });
  });

  it("has exactly the panel's keys, refused null when the report passes", (t) => {
    const { path } = report(t, R_F1, G1);
    const p = pay(path);
    assert.deepEqual(Object.keys(p), [
      "report",
      "html",
      "graph",
      "trace",
      "summary",
      "composedReport",
      "composed",
      "refused",
    ]);
    assert.equal(p.refused, null);
  });

  it("says why a failing report has no SQL", (t) => {
    const { path } = report(t, R0, G1);
    assert.equal(pay(path).refused, REFUSED("r.html"));
  });

  it("composes nothing for a failing report", (t) => {
    const { path } = report(t, R0, G1);
    const p = pay(path);
    assert.equal(p.composedReport, null);
    assert.deepEqual(p.composed, {});
  });

  it("still opens a graph that is valid JSON but not an object", async (t) => {
    const { dir, path } = report(t, R0);
    mkdirSync(join(dir, ".trailline"));
    writeFileSync(join(dir, ".trailline", "r.json"), "null");
    const p = pay(path);
    assert.equal(p.graph, null);
    assert.deepEqual(p.trace, {});
    assert.deepEqual(p.summary, await checkJson(path));
    assert.equal(p.refused, REFUSED("r.html"));
    assert.equal(p.composedReport, null);
    assert.deepEqual(p.composed, {});
  });

  it("throws check's error when there is no graph", (t) => {
    const { dir, path } = report(t, R0);
    assert.throws(
      () => pay(path),
      (err) =>
        err instanceof TraillineError &&
        err.message ===
          `no lineage graph found for ${path}. Looked for ${join(dir, ".trailline", "r.json")} and a <script type="application/trailline+json"> block in the report.`,
    );
  });

  it("throws check's error when the graph is not valid JSON", async (t) => {
    const { dir, path } = report(t, R0);
    mkdirSync(join(dir, ".trailline"));
    writeFileSync(join(dir, ".trailline", "r.json"), '{"trailline": }');
    const { err } = await runCli(["check", path, "--no-embed"]);
    assert.throws(
      () => pay(path),
      (e) => e instanceof TraillineError && `trailline: ${e.message}` === err,
    );
  });
});

const fx = (name) => pay(loadFixture(name).reportPath);
// Sorted: `expected.json` lists issues by rule, `check` by when it found them.
const issueKeys = (list) =>
  list
    .map(({ code, severity, node }) => ({ code, severity, node }))
    .sort((a, b) => `${a.code} ${a.node}`.localeCompare(`${b.code} ${b.node}`));
const CLEAN_IDS = [
  "q1",
  "q2",
  "v1",
  "v2",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "i1",
  "i2",
  "i3",
];

describe("buildPayload: fixtures", () => {
  it("composes clean as trailline sql does", () => {
    const p = fx("clean");
    assert.equal(p.report, "august-retention.html");
    assert.equal(p.composedReport, CLEAN_SQL);
    assert.equal(p.refused, null);
  });

  it("composes each of clean's nodes as trailline sql --id does", () => {
    const { composed } = fx("clean");
    assert.deepEqual(Object.keys(composed), CLEAN_IDS);
    assert.equal(composed.f3, CLEAN_F3_SQL);
    assert.equal(composed.i3, CLEAN_I3_SQL);
  });

  it("gives clean's summary and trace", async () => {
    const { summary, trace } = fx("clean");
    assert.deepEqual(summary, await checkJson(loadFixture("clean").reportPath));
    assert.deepEqual(summary.issues, []);
    assert.deepEqual(
      trace,
      Object.fromEntries(CLEAN_IDS.map((id) => [id, "full"])),
    );
  });

  it("composes messy, holding f2 at its recorded value", () => {
    const p = fx("messy");
    assert.equal(p.composedReport, MESSY_SQL);
    assert.equal(p.composed.f3, MESSY_F3_SQL);
    assert.deepEqual(Object.keys(p.composed), [
      "q1",
      "q2",
      "v1",
      "v2",
      "v3",
      "f1",
      "f2",
      "f3",
      "f4",
      "i1",
    ]);
    assert.equal(p.refused, null);
  });

  it("gives messy's warnings and trace", async () => {
    const { summary, trace } = fx("messy");
    const { reportPath, expected } = loadFixture("messy");
    assert.deepEqual(summary, await checkJson(reportPath));
    assert.deepEqual(issueKeys(summary.issues), issueKeys(expected.issues));
    assert.deepEqual(trace, {
      q1: "full",
      q2: "full",
      t1: "partial",
      v1: "full",
      v2: "full",
      v3: "full",
      f1: "full",
      f2: "partial",
      f3: "partial",
      f4: "full",
      i1: "partial",
      i2: "ungrounded",
      i3: "ungrounded",
      i4: "ungrounded",
    });
  });

  it("opens broken with its errors and no SQL", () => {
    const { reportPath, expected } = loadFixture("broken");
    const p = pay(reportPath);
    assert.equal(p.refused, REFUSED("churn-drivers.html"));
    assert.equal(p.composedReport, null);
    assert.deepEqual(p.composed, {});
    assert.deepEqual(p.graph, readGraph({ reportPath }).graph);
    assert.deepEqual(issueKeys(p.summary.issues), issueKeys(expected.issues));
  });

  it("leaves every fixture file untouched", () => {
    const files = FIXTURE_NAMES.flatMap((name) => {
      const { reportPath } = loadFixture(name);
      const sidecar = join(
        reportPath,
        "..",
        ".trailline",
        `${basename(reportPath, ".html")}.json`,
      );
      return [reportPath, sidecar].filter((file) => existsSync(file));
    });
    const before = files.map((file) => readFileSync(file));
    FIXTURE_NAMES.forEach(fx);
    files.forEach((file, i) => {
      assert.deepEqual(readFileSync(file), before[i], file);
    });
  });
});
