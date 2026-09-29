import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { formatSummary, summarize } from "../src/check/summary.js";
import { checkRules } from "../src/check/rules.js";
import { readGraph } from "../src/graph/parse.js";
import { validateGraph } from "../src/graph/schema.js";
import { proseSkip, readPage } from "../src/html/page.js";
import { loadFixture } from "./helpers.js";

const EMPTY_PAGE = { bindings: [], prose: [] };
const bound = (...ids) => ({
  bindings: ids.map((id, offset) => ({ id, text: "", offset })),
  prose: [],
});
const G = (nodes) => ({ trailline: "1.0", nodes });
const src = { step: "source", kind: "sql" };
const ext = { step: "source", kind: "external", ref: "targets.csv" };
const view = { step: "view", from: ["q1"] };
const fig = { step: "figure", from: ["v1"] };
const ins = { step: "insight", from: ["f1"] };
const loose = (step, extra) => ({ step, from: [], ungrounded: true, ...extra });
const issue = (code, severity, node, message) => ({
  code,
  severity,
  node,
  field: null,
  message,
});
const ZERO = {
  sources: { total: 0, external: 0 },
  views: { total: 0, shown: 0 },
  figures: { total: 0, full: 0, partial: 0, ungrounded: 0 },
  insights: { total: 0, full: 0, partial: 0, ungrounded: 0 },
};
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/** Summary of a graph and page with no issues, report `r.html`. */
const sum = (graph, page = EMPTY_PAGE, issues = []) =>
  summarize(graph, page, issues, { report: "r.html" });

describe("summarize", () => {
  it("summarizes an empty graph as zero counts", () => {
    assert.deepEqual(sum(G({})), {
      report: "r.html",
      counts: ZERO,
      ungrounded: [],
      external: [],
      issues: [],
    });
  });

  it("counts sources and the external ones among them", () => {
    const summary = sum(G({ q1: src, q2: src, x1: ext }));
    assert.deepEqual(summary.counts, {
      ...ZERO,
      sources: { total: 3, external: 1 },
    });
  });

  it("counts a view as shown when it has a binding", () => {
    const summary = sum(G({ v1: view, v2: view }), bound("v1", "v1"));
    assert.deepEqual(summary.counts, {
      ...ZERO,
      views: { total: 2, shown: 1 },
    });
  });

  it("counts figures and insights by how far they trace", () => {
    const summary = sum(
      G({
        q1: src,
        v1: view,
        x1: ext,
        f1: fig,
        f2: { step: "figure", from: ["x1"] },
        f3: loose("figure"),
        i1: ins,
        i2: { step: "insight", from: ["f2"] },
        i3: loose("insight", { text: "c" }),
        i4: loose("insight", { text: "d" }),
      }),
    );
    assert.deepEqual(summary.counts.figures, {
      total: 3,
      full: 1,
      partial: 1,
      ungrounded: 1,
    });
    assert.deepEqual(summary.counts.insights, {
      total: 4,
      full: 1,
      partial: 1,
      ungrounded: 2,
    });
  });

  it("leaves out nodes with an unknown step and nodes that are not objects", () => {
    const summary = sum(
      G({
        m1: { step: "metric", from: ["v1"] },
        n1: null,
        n2: [1],
        f1: fig,
      }),
    );
    assert.deepEqual(summary.counts, {
      ...ZERO,
      figures: { total: 1, full: 0, partial: 1, ungrounded: 0 },
    });
  });

  it("gives zero counts for a graph with no readable nodes and keeps its issues", () => {
    const problem = issue(
      "S1",
      "error",
      null,
      "graph must be an object, got null",
    );
    for (const graph of [null, G("x")]) {
      assert.deepEqual(sum(graph, EMPTY_PAGE, [problem]), {
        report: "r.html",
        counts: ZERO,
        ungrounded: [],
        external: [],
        issues: [problem],
      });
    }
  });

  it("lists ungrounded nodes in graph order with their text", () => {
    const summary = sum(
      G({
        i2: loose("insight", { text: "Second claim." }),
        f1: fig,
        i1: loose("insight", { text: "First claim." }),
      }),
    );
    assert.deepEqual(summary.ungrounded, [
      { node: "i2", text: "Second claim." },
      { node: "i1", text: "First claim." },
    ]);
  });

  it("uses a node's label when it has no text, and null when it has neither", () => {
    const summary = sum(
      G({
        f1: loose("figure", { label: "Benchmark cost" }),
        v1: loose("view"),
      }),
    );
    assert.deepEqual(summary.ungrounded, [
      { node: "f1", text: "Benchmark cost" },
      { node: "v1", text: null },
    ]);
  });

  it("ignores a text or label that is not a string", () => {
    const graph = G({
      i1: loose("insight", { text: 42, label: "Named" }),
      f1: loose("figure", { label: 7 }),
    });
    const summary = sum(graph);
    assert.deepEqual(summary.ungrounded, [
      { node: "i1", text: "Named" },
      { node: "f1", text: null },
    ]);
    const lines = formatSummary(summary).split("\n");
    assert.ok(lines.includes('    i1   ungrounded   "Named"'));
    assert.ok(lines.includes("    f1   ungrounded"));
  });

  it("lists external sources in graph order with their ref", () => {
    const summary = sum(
      G({
        x2: { ...ext, ref: "b.csv" },
        q1: src,
        x1: { ...ext, ref: "a.csv" },
        x3: { step: "source", kind: "external", ref: 7 },
        x4: { step: "source", kind: "external" },
      }),
    );
    assert.deepEqual(summary.external, [
      { node: "x2", ref: "b.csv" },
      { node: "x1", ref: "a.csv" },
      { node: "x3", ref: null },
      { node: "x4", ref: null },
    ]);
  });

  it("passes the issues through unchanged and in order", () => {
    const issues = [
      issue("C1", "error", "f9", "a"),
      issue("C2", "warning", "i1", "b"),
    ];
    assert.deepEqual(sum(G({}), EMPTY_PAGE, issues).issues, issues);
  });
});

describe("formatSummary", () => {
  it("prints the report name and four count lines for an empty graph", () => {
    assert.equal(
      formatSummary(sum(G({}))),
      "r.html\n\n  sources    0\n  views      0\n  figures    0\n  insights   0",
    );
  });

  it("describes complete counts", () => {
    const graph = G({ q1: src, x1: ext, v1: view, f1: fig, i1: ins });
    const lines = formatSummary(sum(graph, bound("v1", "f1", "i1"))).split(
      "\n",
    );
    assert.deepEqual(lines.slice(0, 6), [
      "r.html",
      "",
      "  sources    2   (1 external)",
      "  views      1   all shown on the page",
      "  figures    1   all fully traced",
      "  insights   1   all fully traced",
    ]);
  });

  it("describes partial counts, leaving out the parts that are zero", () => {
    const graph = G({
      q1: src,
      x1: ext,
      v1: view,
      v2: view,
      f1: fig,
      f2: { step: "figure", from: ["x1"] },
      i1: ins,
      i2: { step: "insight", from: ["f2"] },
      i3: loose("insight", { text: "c" }),
    });
    const lines = formatSummary(sum(graph, bound("v1"))).split("\n");
    assert.deepEqual(lines.slice(2, 6), [
      "  sources    2   (1 external)",
      "  views      2   1 shown, 1 not on the page",
      "  figures    2   1 fully traced, 1 partially traced",
      "  insights   3   1 fully traced, 1 partially traced, 1 ungrounded",
    ]);
  });

  it("lists an ungrounded node under needs attention, last", () => {
    const graph = G({ i1: loose("insight", { text: "Costs will ease." }) });
    assert.ok(
      formatSummary(sum(graph)).endsWith(
        '\n\n  needs attention\n    i1   ungrounded   "Costs will ease."',
      ),
    );
  });

  it("cuts ungrounded text longer than 40 characters", () => {
    const graph = G({
      i2: loose("insight", {
        text: "Industry benchmarks put paid search cost per customer around $50.",
      }),
      i3: loose("insight", {
        text: "Creative fatigue on the summer campaign.",
      }),
    });
    const lines = formatSummary(sum(graph)).split("\n");
    assert.ok(
      lines.includes(
        '    i2   ungrounded   "Industry benchmarks put paid search cost…"',
      ),
    );
    assert.ok(
      lines.includes(
        '    i3   ungrounded   "Creative fatigue on the summer campaign."',
      ),
    );
  });

  it("collapses whitespace in ungrounded text and prints no detail when there is none", () => {
    const graph = G({
      i1: loose("insight", { text: "Costs\n   will  ease." }),
      v1: loose("view"),
    });
    const lines = formatSummary(sum(graph)).split("\n");
    assert.ok(lines.includes('    i1   ungrounded   "Costs will ease."'));
    assert.ok(lines.includes("    v1   ungrounded"));
  });

  it("lists an external source with its ref", () => {
    const graph = G({
      x1: { ...ext, ref: "q3-targets.csv" },
      x2: { step: "source", kind: "external" },
    });
    const lines = formatSummary(sum(graph)).split("\n");
    assert.ok(
      lines.includes(
        "    x1   external     q3-targets.csv — a reader will be asked to confirm this with you",
      ),
    );
    assert.ok(
      lines.includes(
        "    x2   external     a reader will be asked to confirm this with you",
      ),
    );
  });

  it("lists a warning with its rule code and message", () => {
    const warning = issue(
      "C2",
      "warning",
      "i1",
      'bare number "1,240" is not inside a figure\'s span',
    );
    assert.ok(
      formatSummary(sum(G({}), EMPTY_PAGE, [warning])).endsWith(
        '  needs attention\n    i1   C2 warning   bare number "1,240" is not inside a figure\'s span',
      ),
    );
  });

  it("lists an error with its rule code and message", () => {
    const error = issue(
      "C1",
      "error",
      "f9",
      'data-trailline="f9" resolves to no node',
    );
    const lines = formatSummary(sum(G({}), EMPTY_PAGE, [error])).split("\n");
    assert.ok(
      lines.includes(
        '    f9   C1 error     data-trailline="f9" resolves to no node',
      ),
    );
  });

  it("orders needs attention as ungrounded, external, warnings, errors", () => {
    const graph = G({ x1: ext, i1: loose("insight", { text: "a" }) });
    const issues = [
      issue("C1", "error", "f9", "e"),
      issue("C2", "warning", "i2", "w"),
    ];
    const lines = formatSummary(sum(graph, EMPTY_PAGE, issues)).split("\n");
    const block = lines.slice(lines.indexOf("  needs attention") + 1);
    const heads = [
      "i1 ungrounded",
      "x1 external",
      "i2 C2 warning",
      "f9 C1 error",
    ];
    assert.equal(block.length, heads.length);
    block.forEach((line, n) => {
      assert.ok(line.replace(/ +/g, " ").trim().startsWith(heads[n]), line);
    });
  });

  it("widens the id column for long ids", () => {
    const issues = [
      issue("S2", "error", "Top-Plan", "bad id"),
      issue("C1", "error", "f9", "x"),
    ];
    const lines = formatSummary(sum(G({}), EMPTY_PAGE, issues)).split("\n");
    assert.ok(lines.includes("    Top-Plan   S2 error     bad id"));
    assert.ok(lines.includes("    f9         C1 error     x"));
  });

  it("keeps the id column at least 5 wide", () => {
    const issues = [issue("C1", "error", "a", "x")];
    const lines = formatSummary(sum(G({}), EMPTY_PAGE, issues)).split("\n");
    assert.ok(lines.includes("    a    C1 error     x"));
  });

  it("shows an issue with no node as graph", () => {
    const missing = issue(
      "S1",
      "error",
      null,
      "missing `trailline` format version",
    );
    const lines = formatSummary(sum(G({}), EMPTY_PAGE, [missing])).split("\n");
    assert.ok(
      lines.includes(
        "    graph   S1 error     missing `trailline` format version",
      ),
    );
  });

  it("colours tags only when asked", () => {
    const graph = G({
      i1: loose("insight", { text: "a" }),
      x1: { ...ext, ref: "t.csv" },
    });
    const issues = [
      issue("C2", "warning", "i2", "w"),
      issue("C1", "error", "f9", "e"),
    ];
    const summary = sum(graph, EMPTY_PAGE, issues);
    const lines = formatSummary(summary, { color: true }).split("\n");
    const ask = "a reader will be asked to confirm this with you";
    assert.deepEqual(lines.slice(-4), [
      `    i1   ${YELLOW}ungrounded${RESET}   "a"`,
      `    x1   ${YELLOW}external${RESET}     t.csv — ${ask}`,
      `    i2   ${YELLOW}C2 warning${RESET}   w`,
      `    f9   ${RED}C1 error${RESET}     e`,
    ]);
    const plain = formatSummary(summary);
    assert.equal(formatSummary(summary, { color: false }), plain);
    assert.ok(!plain.includes("\x1b"));
    const stripped = lines
      .join("\n")
      .replaceAll(RED, "")
      .replaceAll(YELLOW, "")
      .replaceAll(RESET, "");
    assert.equal(stripped, plain);
  });
});

/** graph, page, issues and report name for a fixture. */
function fixture(name) {
  const { reportPath, expected } = loadFixture(name);
  const { graph } = readGraph({ reportPath });
  const page = readPage(readFileSync(reportPath, "utf8"), {
    skip: proseSkip(graph),
  });
  const issues = [...validateGraph(graph), ...checkRules(graph, page)];
  return { graph, page, issues, report: expected.report };
}

/** Summary of a fixture, as `[structured, printed]`. */
function summarizeFixture(name) {
  const { graph, page, issues, report } = fixture(name);
  const summary = summarize(graph, page, issues, { report });
  return { summary, issues, text: formatSummary(summary) };
}

describe("fixtures", () => {
  it("summarizes messy as structured data", () => {
    const { summary, issues } = summarizeFixture("messy");
    assert.deepEqual(summary, {
      report: "paid-search-costs.html",
      counts: {
        sources: { total: 3, external: 1 },
        views: { total: 3, shown: 3 },
        figures: { total: 4, full: 2, partial: 2, ungrounded: 0 },
        insights: { total: 4, full: 0, partial: 1, ungrounded: 3 },
      },
      ungrounded: [
        {
          node: "i2",
          text: "Industry benchmarks put paid search cost per customer around $50.",
        },
        {
          node: "i3",
          text: "Creative fatigue on the summer campaign is the likely driver.",
        },
        {
          node: "i4",
          text: "Costs should ease in September once the new creative is live.",
        },
      ],
      external: [{ node: "t1", ref: "q3-targets.csv" }],
      issues,
    });
  });

  it("prints clean", () => {
    assert.equal(
      summarizeFixture("clean").text,
      [
        "august-retention.html",
        "",
        "  sources    2",
        "  views      2   all shown on the page",
        "  figures    6   all fully traced",
        "  insights   3   all fully traced",
      ].join("\n"),
    );
  });

  it("prints messy", () => {
    assert.equal(
      summarizeFixture("messy").text,
      [
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
      ].join("\n"),
    );
  });

  it("prints broken", () => {
    assert.equal(
      summarizeFixture("broken").text,
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
  });
});
