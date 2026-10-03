import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CLEAN_SQL,
  loadFixture,
  MESSY_SQL,
  runCli,
  tempDir,
} from "./helpers.js";

const REFUSED = (name) =>
  `trailline: ${name} does not pass \`trailline check\`, so no script was composed`;
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

describe("sql: invocation", () => {
  it("exits 2 when no report is given", async () => {
    const { code, out, err } = await runCli(["sql"]);
    assert.equal(code, 2);
    assert.equal(out, "");
    assert.equal(
      err,
      "trailline: missing the report to compose\nTry `trailline sql --help`.",
    );
  });

  it("exits 2 on --out, which is not an option", async () => {
    const { code, out } = await runCli(["sql", "a.html", "--out", "x.sql"]);
    assert.equal(code, 2);
    assert.equal(out, "");
  });

  it("exits 2 when more than one report is given", async () => {
    const { code, out, err } = await runCli(["sql", "a.html", "b.html"]);
    assert.equal(code, 2);
    assert.equal(out, "");
    assert.equal(
      err,
      "trailline: expected one report, got 2\nTry `trailline sql --help`.",
    );
  });
});

describe("sql: reading", () => {
  it("reads the --graph file instead of the sidecar", async (t) => {
    const { dir, path } = report(t, R_F1, { trailline: "1.0", nodes: {} });
    const other = join(dir, "other.json");
    writeFileSync(other, JSON.stringify(G1));
    const { code, out } = await runCli(["sql", path, "--graph", other]);
    assert.equal(code, 0);
    assert.equal(out, ONE);
  });

  it("fails when the report has no graph", async (t) => {
    const { dir, path } = report(t, R0);
    const { code, out, err } = await runCli(["sql", path]);
    assert.equal(code, 1);
    assert.equal(out, "");
    assert.equal(
      err,
      `trailline: no lineage graph found for ${path}. Looked for ${join(dir, ".trailline", "r.json")} and a <script type="application/trailline+json"> block in the report.`,
    );
  });
});

describe("sql: output", () => {
  it("prints the composed script, with warnings allowed", async (t) => {
    const { path } = report(t, R_F1, G1);
    const { code, out, err } = await runCli(["sql", path]);
    assert.equal(code, 0);
    assert.equal(out, ONE);
    assert.equal(err, "");
  });

  it("never writes to the report", async (t) => {
    const { path } = report(t, R_F1, G1);
    await runCli(["sql", path]);
    assert.equal(readFileSync(path, "utf8"), R_F1);
  });

  it("refuses a report that check would fail", async (t) => {
    const { path } = report(t, R0, G1);
    const { code, out, err } = await runCli(["sql", path]);
    assert.equal(code, 1);
    assert.equal(out, "");
    assert.equal(err, REFUSED("r.html"));
  });
});

describe("sql: schema errors", () => {
  it("refuses a report whose only error comes from the schema", async (t) => {
    const graph = structuredClone(G1);
    graph.nodes.f2 = {
      step: "figure",
      from: ["f1"],
      expr: "f1 +",
      label: "Broken",
    };
    const html = R_F1.replace(
      "</p>",
      ' <span data-trailline="f2">1</span></p>',
    );
    const { path } = report(t, html, graph);
    const { code, out, err } = await runCli(["sql", path]);
    assert.equal(code, 1);
    assert.equal(out, "");
    assert.equal(err, REFUSED("r.html"));
  });
});

describe("sql: fixtures", () => {
  it("prints clean's script", async () => {
    const { reportPath } = loadFixture("clean");
    const before = readFileSync(reportPath, "utf8");
    const { code, out, err } = await runCli(["sql", reportPath]);
    assert.equal(code, 0);
    assert.equal(out, CLEAN_SQL);
    assert.equal(err, "");
    assert.equal(readFileSync(reportPath, "utf8"), before);
  });

  it("prints messy's script", async () => {
    const { code, out, err } = await runCli([
      "sql",
      loadFixture("messy").reportPath,
    ]);
    assert.equal(code, 0);
    assert.equal(out, MESSY_SQL);
    assert.equal(err, "");
  });

  it("refuses broken", async () => {
    const { code, out, err } = await runCli([
      "sql",
      loadFixture("broken").reportPath,
    ]);
    assert.equal(code, 1);
    assert.equal(out, "");
    assert.equal(err, REFUSED("churn-drivers.html"));
  });
});
