import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { findEmbeddedGraph, readGraph } from "../src/graph/parse.js";
import { embedGraph } from "../src/html/embed.js";
import { loadFixture, runCli, tempDir } from "./helpers.js";

const GX = {
  trailline: "1.0",
  nodes: {
    x1: {
      step: "source",
      kind: "external",
      type: "csv",
      ref: "t.csv",
      given: "Q3 targets",
    },
  },
};
const G0 = { trailline: "1.0", nodes: {} };
const R0 =
  "<html><head><title>r</title></head><body><p>Hello.</p></body></html>";

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

describe("check: invocation", () => {
  it("exits 2 when no report is given", async () => {
    const { code, out, err } = await runCli(["check"]);
    assert.equal(code, 2);
    assert.equal(out, "");
    assert.equal(
      err,
      "trailline: missing the report to check\nTry `trailline check --help`.",
    );
  });

  it("exits 2 when more than one report is given", async () => {
    const { code, out, err } = await runCli(["check", "a.html", "b.html"]);
    assert.equal(code, 2);
    assert.equal(out, "");
    assert.equal(
      err,
      "trailline: expected one report, got 2\nTry `trailline check --help`.",
    );
  });
});

describe("check: reading", () => {
  it("fails when the report has no graph", async (t) => {
    const { dir, path } = report(t, R0);
    const { code, out, err } = await runCli(["check", path]);
    assert.equal(code, 1);
    assert.equal(out, "");
    assert.equal(
      err,
      `trailline: no lineage graph found for ${path}. Looked for ${join(dir, ".trailline", "r.json")} and a <script type="application/trailline+json"> block in the report.`,
    );
  });

  it("uses the --graph file instead of the sidecar, for the summary and the embed", async (t) => {
    const { dir, path } = report(t, R0, G0);
    const other = join(dir, "other.json");
    writeFileSync(other, JSON.stringify(GX));
    const { code, out } = await runCli(["check", path, "--graph", other]);
    assert.equal(code, 0);
    assert.equal(
      out,
      "r.html\n\n  sources    1   (1 external)\n  views      0\n  figures    0\n  insights   0\n\n  needs attention\n    x1   external     t.csv — a reader will be asked to confirm this with you",
    );
    assert.equal(readFileSync(path, "utf8"), embedGraph(R0, GX));
    assert.equal(
      readFileSync(join(dir, ".trailline", "r.json"), "utf8"),
      JSON.stringify(G0),
    );
  });

  it("fails when the sidecar exists but the report does not", async (t) => {
    const { dir, path } = report(t, R0, G0);
    rmSync(path);
    const { code, out, err } = await runCli(["check", path]);
    assert.equal(code, 1);
    assert.equal(out, "");
    assert.equal(err, `trailline: report not found: ${join(dir, "r.html")}`);
  });

  it("fails with a TraillineError when the report cannot be read", async (t) => {
    const { dir, path } = report(t, R0, G0);
    rmSync(path);
    mkdirSync(path);
    const { code, out, err } = await runCli(["check", path]);
    assert.equal(code, 1);
    assert.equal(out, "");
    assert.ok(
      err.startsWith(`trailline: could not read ${join(dir, "r.html")}: `),
      err,
    );
    assert.ok(!err.includes("\n    at "), err);
  });

  it("reads the --graph file and fails when it is missing", async (t) => {
    const { dir, path } = report(t, R0, G0);
    const missing = join(dir, "missing.json");
    const { code, out, err } = await runCli([
      "check",
      path,
      "--graph",
      missing,
    ]);
    assert.equal(code, 1);
    assert.equal(out, "");
    assert.equal(err, `trailline: graph file not found: ${missing}`);
  });
});

const R_ERR =
  '<html><head></head><body><p data-trailline="f9">x</p></body></html>';
const C1_LINE = '    f9   C1 error     data-trailline="f9" resolves to no node';

const R_WARN =
  "<html><head></head><body><p>We had 1,240 visits.</p></body></html>";
const C2_MSG = 'bare number "1,240" is not inside a figure\'s span';

const ZERO =
  "r.html\n\n  sources    0\n  views      0\n  figures    0\n  insights   0";

const EMBEDDED_R0 =
  '<html><head><title>r</title><meta name="trailline" content="1.0">\n</head>' +
  '<body><p>Hello.</p><script type="application/trailline+json" id="trailline-graph">' +
  '{\n  "trailline": "1.0",\n  "nodes": {}\n}</script>\n</body></html>';

describe("check: summary", () => {
  it("prints the summary of a report with nothing to flag", async (t) => {
    const { path } = report(t, R0, G0);
    const { code, out, err } = await runCli(["check", path]);
    assert.equal(code, 0);
    assert.equal(out, ZERO);
    assert.equal(err, "");
  });
});

describe("check: embedding", () => {
  it("embeds the graph into the report", async (t) => {
    const { path } = report(t, R0, G0);
    await runCli(["check", path]);
    assert.equal(readFileSync(path, "utf8"), EMBEDDED_R0);
  });

  it("leaves the report untouched with --no-embed", async (t) => {
    const { path } = report(t, R0, G0);
    const { code, out } = await runCli(["check", path, "--no-embed"]);
    assert.equal(code, 0);
    assert.equal(out, ZERO);
    assert.equal(readFileSync(path, "utf8"), R0);
  });

  it("does not embed when an error remains", async (t) => {
    const { path } = report(t, R_ERR, G0);
    const { code } = await runCli(["check", path]);
    assert.equal(code, 1);
    assert.equal(readFileSync(path, "utf8"), R_ERR);
  });
});

describe("check: exit code", () => {
  it("exits 1 when an error remains", async (t) => {
    const { path } = report(t, R_ERR, G0);
    const { code, out, err } = await runCli(["check", path, "--no-embed"]);
    assert.equal(code, 1);
    assert.equal(out, `${ZERO}\n\n  needs attention\n${C1_LINE}`);
    assert.equal(err, "");
  });

  it("prints the summary, then fails, when the report cannot take the graph", async (t) => {
    const html = "<html><head></head><body><p>Hello.</p></html>";
    const { path } = report(t, html, G0);
    const { code, out, err } = await runCli(["check", path]);
    assert.equal(code, 1);
    assert.equal(out, ZERO);
    assert.equal(
      err,
      "trailline: the report has no </body> tag, so the lineage graph was not embedded",
    );
    assert.equal(readFileSync(path, "utf8"), html);
  });

  it("exits 0 and embeds when only warnings remain", async (t) => {
    const { path } = report(t, R_WARN, G0);
    const { code, out } = await runCli(["check", path]);
    assert.equal(code, 0);
    assert.equal(
      out,
      `${ZERO}\n\n  needs attention\n    graph   C2 warning   ${C2_MSG}`,
    );
    assert.equal(readFileSync(path, "utf8"), embedGraph(R_WARN, G0));
  });
});

describe("check: output", () => {
  it("prints the summary as JSON with --json", async (t) => {
    const html =
      '<html><head></head><body><p>We had 1,240 visits.</p><p data-trailline="f9">x</p></body></html>';
    const { path } = report(t, html, G0);
    const { code, out, err } = await runCli([
      "check",
      path,
      "--json",
      "--no-embed",
    ]);
    const expected = {
      report: "r.html",
      counts: {
        sources: { total: 0, external: 0 },
        views: { total: 0, shown: 0 },
        figures: { total: 0, full: 0, partial: 0, ungrounded: 0 },
        insights: { total: 0, full: 0, partial: 0, ungrounded: 0 },
      },
      ungrounded: [],
      external: [],
      issues: [
        {
          code: "C1",
          severity: "error",
          node: "f9",
          field: null,
          message: 'data-trailline="f9" resolves to no node',
        },
        {
          code: "C2",
          severity: "warning",
          node: null,
          field: null,
          message: C2_MSG,
        },
      ],
    };
    assert.equal(code, 1);
    assert.equal(err, "");
    assert.equal(out, JSON.stringify(expected, null, 2));
  });

  it("prints nothing with --quiet but still sets the exit code and embeds", async (t) => {
    const a = report(t, R_ERR, G0);
    const runA = await runCli(["check", a.path, "--quiet"]);
    assert.deepEqual([runA.code, runA.out, runA.err], [1, "", ""]);
    assert.equal(readFileSync(a.path, "utf8"), R_ERR);

    const b = report(t, R0, G0);
    const runB = await runCli(["check", b.path, "--quiet"]);
    assert.deepEqual([runB.code, runB.out, runB.err], [0, "", ""]);
    assert.equal(readFileSync(b.path, "utf8"), EMBEDDED_R0);
  });

  it("--quiet wins over --json", async (t) => {
    const { path } = report(t, R0, G0);
    const { code, out } = await runCli(["check", path, "--quiet", "--json"]);
    assert.equal(code, 0);
    assert.equal(out, "");
  });

  it("colours the summary when the io asks for colour", async (t) => {
    const html =
      '<html><head></head><body><p>We had 1,240 visits.</p><p data-trailline="f9">x</p></body></html>';
    const { path } = report(t, html, G0);
    const { code, out } = await runCli(["check", path, "--no-embed"], {
      color: true,
    });
    assert.equal(code, 1);
    assert.equal(
      out,
      `${ZERO}\n\n  needs attention\n    graph   \x1b[33mC2 warning\x1b[0m   ${C2_MSG}\n    f9      \x1b[31mC1 error\x1b[0m     data-trailline="f9" resolves to no node`,
    );
  });
});

/** Copy a whole fixture directory into a temp dir; returns the report path. */
function copyFixture(t, name) {
  const { dir, reportPath } = loadFixture(name);
  const copy = tempDir(t);
  cpSync(dir, copy, { recursive: true });
  return join(copy, reportPath.slice(dir.length + 1));
}

describe("check: fixtures", () => {
  it("leaves a copy of clean untouched and exits 0", async (t) => {
    const path = copyFixture(t, "clean");
    const before = readFileSync(path);
    utimesSync(path, 1e9, 1e9);
    const { code, out, err } = await runCli(["check", path]);
    assert.equal(code, 0);
    assert.equal(
      out,
      [
        "august-retention.html",
        "",
        "  sources    2",
        "  views      2   all shown on the page",
        "  figures    6   all fully traced",
        "  insights   3   all fully traced",
      ].join("\n"),
    );
    assert.equal(err, "");
    assert.deepEqual(readFileSync(path), before);
    assert.equal(statSync(path).mtimeMs, 1e12);
  });

  const MESSY_OUT = [
    "paid-search-costs.html",
    "",
    "  sources    3   (1 external)",
    "  views      3   all shown on the page",
    "  figures    4   2 fully traced, 2 partially traced",
    "  insights   4   1 partially traced, 3 ungrounded",
    "",
    "  needs attention",
    '    i2   ungrounded   "Industry benchmarks put paid search cost…"',
    '    i3   ungrounded   "Creative fatigue on the summer campaign…"',
    '    i4   ungrounded   "Costs should ease in September once the…"',
    "    t1   external     q3-targets.csv — a reader will be asked to confirm this with you",
    "    t1   S6 warning   external source ids conventionally start with `x`, e.g. x1",
    "    v1   S5 warning   unknown field `notes` on a view",
    "    f2   S7 warning   figure has no `label` (what the number is, in words)",
    '    i1   C2 warning   bare number "1,240" is not inside a figure\'s span',
    '    f1   C3 warning   page shows "$58.90" but display is "$61.20"',
    "    q2   C7 warning   sql source is missing `columns`; SQL does not contain the period as literal dates: '2026-08-01', '2026-08-31'; SQL uses date functions: current_date",
    "    v2   C8 warning   SQL style: uses select *; list the columns",
  ].join("\n");

  it("embeds messy's sidecar into a copy and exits 0", async (t) => {
    const path = copyFixture(t, "messy");
    const { reportPath } = loadFixture("messy");
    const original = readFileSync(reportPath, "utf8");
    const { graph } = readGraph({ reportPath });
    const { code, out } = await runCli(["check", path]);
    assert.equal(code, 0);
    assert.equal(out, MESSY_OUT);
    assert.equal(readFileSync(path, "utf8"), embedGraph(original, graph));
    assert.equal(findEmbeddedGraph(original), null);
  });

  it("changes nothing when messy is checked twice", async (t) => {
    const path = copyFixture(t, "messy");
    await runCli(["check", path]);
    const first = readFileSync(path);
    const { code } = await runCli(["check", path]);
    assert.equal(code, 0);
    assert.deepEqual(readFileSync(path), first);
  });

  it("leaves a copy of broken untouched and exits 1", async (t) => {
    const path = copyFixture(t, "broken");
    const before = readFileSync(path);
    const { code, out, err } = await runCli(["check", path]);
    assert.equal(code, 1);
    assert.equal(
      out,
      [
        "churn-drivers.html",
        "",
        "  sources    1",
        "  views      2   1 shown, 1 not on the page",
        "  figures    5   3 fully traced, 2 partially traced",
        "  insights   4   3 fully traced, 1 partially traced",
        "",
        "  needs attention",
        "    f2         C9 error     figure has both `sql` and `expr`; keep exactly one",
        "    f5         S8 error     cannot read `f1 ^ 2` at character 4: unexpected `^`",
        "    i1         C4 error     `from` is empty; list the parents, or set `ungrounded: true` if there are none",
        "    i3         S4 error     insight is missing `text`",
        "    Top-Plan   S2 error     `Top-Plan` is not a valid id: use lowercase letters, digits and _, starting with a letter",
        '    m1         S3 error     unknown step "metric"; expected one of source, view, figure, insight',
        '    f9         C1 error     data-trailline="f9" resolves to no node',
        "    v2         C1 error     view is not bound to any element on the page",
        "    i2         C5 error     an insight rests on figures and insights only",
        "    f3         C6 error     cycle f3 -> f4 -> f3",
      ].join("\n"),
    );
    assert.equal(err, "");
    assert.deepEqual(readFileSync(path), before);
  });
});
