import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildPayload } from "../src/viewer/payload.js";
import {
  CLEAN_F3_SQL,
  CLEAN_SQL,
  loadFixture,
  runCli,
  tempDir,
} from "./helpers.js";

import {
  nodeState,
  title,
  beats,
  reviewerWording,
  highlightSql,
  needsAttention,
  overview,
  reportSql,
  chainSql,
  stepSql,
  nodesOf,
  copyText,
  fromReport,
} from "../src/viewer/client/lineage.js";

const G = {
  trailline: "1.0",
  nodes: {
    q1: {
      step: "source",
      kind: "sql",
      mart: "marts.sales",
      sql: "-- Sales by day\nselect day, amount from marts.sales",
    },
    q2: {
      step: "source",
      kind: "sql",
      mart: "marts.costs",
      sql: "select day, cost from marts.costs",
    },
    x1: { step: "source", kind: "external", type: "csv", ref: "targets.csv" },
    v1: {
      step: "view",
      from: ["q1"],
      sql: "-- Daily sales\nselect day, amount from q1",
      encoding: { visual: "table" },
    },
    v2: {
      step: "view",
      from: ["v1"],
      sql: "select day from v1",
      encoding: { visual: "bar" },
    },
    f1: {
      step: "figure",
      from: ["v1"],
      sql: "select sum(amount) from v1",
      label: "Sales",
      value: 12,
      display: "12",
    },
    f2: {
      step: "figure",
      from: ["q2"],
      sql: "select sum(cost) from q2",
      label: "Cost",
      value: 4,
      display: "4",
    },
    f3: {
      step: "figure",
      from: ["f2", "f1"],
      expr: "f1 - f2",
      label: "Margin",
      value: 8,
      display: "8",
    },
    f4: {
      step: "figure",
      from: ["x1"],
      sql: "select target from x1",
      value: 10,
      display: "10",
    },
    f5: {
      step: "figure",
      from: ["v1"],
      sql: "select count(day) from v1",
      label: "Days",
      value: 3,
      display: "3",
    },
    f6: {
      step: "figure",
      from: ["f1", "f5"],
      expr: "f1 / f5",
      label: "Sales per day",
      value: 4,
      display: "4",
    },
    f7: {
      step: "figure",
      from: ["f1", "f9"],
      expr: "f1 + f9",
      label: "Broken",
      value: 12,
      display: "12",
    },
    i1: { step: "insight", from: ["f3"], text: "Margin was 8." },
    i2: {
      step: "insight",
      from: [],
      ungrounded: true,
      text: "Margins will rise.",
    },
  },
};
// A /data.json object; override what a test needs.
const data = (over = {}) => ({
  report: "r.html",
  html: "",
  graph: G,
  trace: {},
  summary: {
    report: "r.html",
    counts: {},
    ungrounded: [],
    external: [],
    issues: [],
  },
  composedReport: null,
  composed: {},
  refused: null,
  ...over,
});

const fx = (name) => buildPayload({ reportPath: loadFixture(name).reportPath });
const items = (name) => needsAttention(fx(name).summary).items;

const REFUSED =
  "r.html does not pass `trailline check`, so no script was composed";
// Figures f1.. with the given trace states, plus one sql source q1 (never counted).
const nums = (...states) => {
  const ids = states.map((_, k) => `f${k + 1}`);
  return data({
    graph: {
      nodes: {
        q1: { step: "source", kind: "sql" },
        ...Object.fromEntries(ids.map((id) => [id, { step: "figure" }])),
      },
    },
    trace: {
      q1: "full",
      ...Object.fromEntries(ids.map((id, k) => [id, states[k]])),
    },
  });
};
// Issues as check reports them.
const issue = (code, node, message, severity = "warning") => ({
  code,
  severity,
  node,
  field: null,
  message,
});
const C7_MESSY =
  "sql source is missing `columns`; SQL does not contain the period as literal dates: '2026-08-01', '2026-08-31'; SQL uses date functions: current_date";

describe("nodesOf", () => {
  it("gives a graph's nodes as they are", () => {
    assert.deepEqual(nodesOf(G), G.nodes);
  });
  it("gives no nodes for a graph that is not an object", () => {
    for (const graph of [null, "x", 5, []]) {
      assert.deepEqual(nodesOf(graph), {});
    }
  });
  it("gives no nodes when nodes is missing or not an object", () => {
    for (const nodes of [undefined, 5, [], null]) {
      assert.deepEqual(nodesOf({ trailline: "1.0", nodes }), {});
    }
  });
  it("leaves out nodes that are not objects", () => {
    assert.deepEqual(
      nodesOf({ nodes: { q1: G.nodes.q1, a: null, b: "x", c: [] } }),
      { q1: G.nodes.q1 },
    );
  });
  it("gives a from that is not a list no parents", () => {
    const f1 = { step: "figure", from: "q1" };
    assert.deepEqual(nodesOf({ nodes: { q1: G.nodes.q1, f1 } }), {
      q1: G.nodes.q1,
      f1: { step: "figure", from: [] },
    });
    assert.equal(f1.from, "q1");
  });
});

describe("copyText", () => {
  // A fake execCopy that records what it was asked to copy.
  const fallback = (result) => {
    const calls = [];
    const execCopy = (text) => {
      calls.push(text);
      if (result instanceof Error) throw result;
      return result;
    };
    return { calls, execCopy };
  };
  const refuses = { writeText: async () => Promise.reject(new Error("no")) };
  it("is true when the clipboard takes the text", async () => {
    const { calls, execCopy } = fallback(false);
    const clipboard = { writeText: async () => {} };
    assert.equal(await copyText("select 1", { clipboard, execCopy }), true);
    assert.deepEqual(calls, []);
  });
  it("is false when the clipboard and the fallback both fail", async () => {
    const { execCopy } = fallback(false);
    assert.equal(
      await copyText("select 1", { clipboard: refuses, execCopy }),
      false,
    );
  });
  it("falls back when the clipboard refuses", async () => {
    const { calls, execCopy } = fallback(true);
    assert.equal(
      await copyText("select 1", { clipboard: refuses, execCopy }),
      true,
    );
    assert.deepEqual(calls, ["select 1"]);
  });
  it("falls back when there is no clipboard", async () => {
    for (const clipboard of [undefined, {}]) {
      const { execCopy } = fallback(true);
      assert.equal(await copyText("select 1", { clipboard, execCopy }), true);
    }
  });
  it("is false when the fallback throws", async () => {
    const { execCopy } = fallback(new Error("blocked"));
    assert.equal(
      await copyText("select 1", { clipboard: undefined, execCopy }),
      false,
    );
  });
});

describe("fromReport", () => {
  const d = data();
  it("ignores anything that is not a bridge message", () => {
    for (const m of [
      null,
      "select",
      5,
      {},
      { type: "select", id: "f1" },
      { trailline: "paint" },
    ]) {
      assert.equal(fromReport(d, m), null, JSON.stringify(m));
    }
  });
  it("reads a click on a bound element", () => {
    assert.deepEqual(fromReport(d, { trailline: "select", id: "f1" }), {
      type: "select",
      id: "f1",
    });
  });
  it("ignores a select for an id not in the graph", () => {
    for (const id of [
      "nope",
      "constructor",
      "__proto__",
      "toString",
      5,
      ["f1"],
    ]) {
      assert.equal(
        fromReport(d, { trailline: "select", id }),
        null,
        String(id),
      );
    }
  });
  it("ignores a select when the graph has no nodes", () => {
    const m = { trailline: "select", id: "f1" };
    assert.equal(fromReport({ ...d, graph: null }, m), null);
    assert.equal(fromReport({ ...d, graph: { nodes: 5 } }, m), null);
  });
  it("reads Escape in the report as back", () => {
    assert.deepEqual(fromReport(d, { trailline: "back" }), { type: "back" });
  });
  it("reads how many places each node has on the page", () => {
    const counts = { f1: 2, v1: 1 };
    assert.deepEqual(fromReport(d, { trailline: "ready", counts }), {
      type: "ready",
      counts,
    });
  });
  it("keeps only counts of known nodes that are whole and positive", () => {
    const counts = {
      f1: 2,
      nope: 1,
      constructor: 1,
      f3: "2",
      v1: 0,
      i1: 1.5,
      q1: -1,
    };
    assert.deepEqual(fromReport(d, { trailline: "ready", counts }), {
      type: "ready",
      counts: { f1: 2 },
    });
  });
  it("reads ready with no usable counts as none", () => {
    for (const counts of [undefined, null, 5, []]) {
      assert.deepEqual(fromReport(d, { trailline: "ready", counts }), {
        type: "ready",
        counts: {},
      });
    }
  });
});

describe("nodeState", () => {
  it("gives the node's trace state", () => {
    const d = data({ trace: { q1: "full", x1: "partial" } });
    assert.equal(nodeState(d, "q1"), "full");
    assert.equal(nodeState(d, "x1"), "partial");
  });
  it("calls a node with no trace state partial", () => {
    assert.equal(nodeState(data({ trace: {} }), "f1"), "partial");
  });
  it("calls an id that is not in the graph ungrounded", () => {
    assert.equal(nodeState(data(), "f9"), "ungrounded");
  });
});

describe("title", () => {
  it("uses a figure's label", () => {
    assert.equal(title(G, "f3"), "Margin");
  });
  it("uses an insight's text", () => {
    assert.equal(title(G, "i1"), "Margin was 8.");
  });
  it("uses a view's leading SQL comment", () => {
    assert.equal(title(G, "v1"), "Daily sales");
  });
  it("falls back to a view's visual when its SQL has no comment", () => {
    assert.equal(title(G, "v2"), "bar");
  });
  it("calls a view with no comment and no visual a view", () => {
    const graph = {
      nodes: { v9: { step: "view", from: [], sql: "select 1" } },
    };
    assert.equal(title(graph, "v9"), "view");
  });
  it("uses a sql source's mart, and an external source's ref", () => {
    assert.equal(title(G, "q1"), "marts.sales");
    assert.equal(title(G, "x1"), "targets.csv");
  });
  it("says when an id is not in the graph", () => {
    assert.equal(title(G, "f9"), "Not in the graph");
  });
});

describe("beats", () => {
  it("puts a source alone at step 1", () => {
    assert.deepEqual(beats(G, "q1"), [{ n: 1, ids: ["q1"] }]);
  });
  it("puts a view above its source", () => {
    assert.deepEqual(beats(G, "v1"), [
      { n: 2, ids: ["v1"] },
      { n: 1, ids: ["q1"] },
    ]);
  });
  it("stacks a longer chain one step per beat", () => {
    assert.deepEqual(beats(G, "v2"), [
      { n: 3, ids: ["v2"] },
      { n: 2, ids: ["v1"] },
      { n: 1, ids: ["q1"] },
    ]);
  });
  it("sits each node one above its tallest parent, every source at step 1, in graph order", () => {
    assert.deepEqual(beats(G, "f3"), [
      { n: 4, ids: ["f3"] },
      { n: 3, ids: ["f1"] },
      { n: 2, ids: ["v1", "f2"] },
      { n: 1, ids: ["q1", "q2"] },
    ]);
  });
  it("shows a shared ancestor once", () => {
    assert.deepEqual(beats(G, "f6"), [
      { n: 4, ids: ["f6"] },
      { n: 3, ids: ["f1", "f5"] },
      { n: 2, ids: ["v1"] },
      { n: 1, ids: ["q1"] },
    ]);
  });
  it("puts a parent missing from the graph at step 1, after the known ids", () => {
    assert.deepEqual(beats(G, "f7"), [
      { n: 4, ids: ["f7"] },
      { n: 3, ids: ["f1"] },
      { n: 2, ids: ["v1"] },
      { n: 1, ids: ["q1", "f9"] },
    ]);
  });
  it("ends on a cycle, numbering the steps from 1 with no gap", () => {
    const cycle = {
      nodes: {
        f3: { step: "figure", from: ["f4"], expr: "f4 + 1" },
        f4: { step: "figure", from: ["f3"], expr: "f3 * 2" },
      },
    };
    assert.deepEqual(beats(cycle, "f3"), [
      { n: 2, ids: ["f3"] },
      { n: 1, ids: ["f4"] },
    ]);
  });
  it("treats a from that is not a list as no parents", () => {
    const graph = {
      nodes: {
        q1: { step: "source", kind: "sql" },
        f1: { step: "figure", from: "q1" },
        i1: null,
      },
    };
    assert.deepEqual(beats(graph, "f1"), [{ n: 1, ids: ["f1"] }]);
    assert.deepEqual(beats(graph, "i1"), [{ n: 1, ids: ["i1"] }]);
  });
});

describe("reviewerWording", () => {
  it("hands a builder warning over as a note, code in backticks shown as code", () => {
    assert.deepEqual(
      reviewerWording(issue("S5", "v1", "unknown field `notes` on a view")),
      {
        tone: "note",
        html: "For the builder: unknown field <code>notes</code> on a view",
      },
    );
  });
  it("says what C3 found in the reviewer's words", () => {
    assert.deepEqual(
      reviewerWording(
        issue("C3", "f1", 'page shows "$58.90" but display is "$61.20"'),
      ),
      {
        tone: "stop",
        html: "The page shows <b>$58.90</b>, but the lineage records <b>$61.20</b>.",
      },
    );
  });
  it("falls back to check's message for a C3 it cannot read", () => {
    assert.deepEqual(reviewerWording(issue("C3", "f1", "display is `x`")), {
      tone: "stop",
      html: "display is <code>x</code>",
    });
  });
  it("says what C2 found", () => {
    assert.deepEqual(
      reviewerWording(
        issue("C2", "i1", 'bare number "1,240" is not inside a figure\'s span'),
      ),
      {
        tone: "warn",
        html: "<b>1,240</b> in this sentence isn't bound to any figure, so it has no lineage.",
      },
    );
  });
  it("says what one C7 part means", () => {
    assert.deepEqual(
      reviewerWording(
        issue("C7", "q2", "SQL uses date functions: current_date"),
      ),
      {
        tone: "warn",
        html: "Dates aren't pinned. It uses <code>current_date</code>, so re-running it gives different numbers.",
      },
    );
  });
  it("says what each C7 part means, in order", () => {
    assert.deepEqual(reviewerWording(issue("C7", "q2", C7_MESSY)), {
      tone: "warn",
      html: "Dates aren't pinned. No columns are recorded. The SQL doesn't use the recorded period as fixed dates. It uses <code>current_date</code>, so re-running it gives different numbers.",
    });
  });
  it("falls back to check's message for a C2 it cannot read", () => {
    assert.deepEqual(reviewerWording(issue("C2", "i1", "odd `thing`")), {
      tone: "warn",
      html: "odd <code>thing</code>",
    });
  });
  it("falls back to check's message for a C7 part it cannot read", () => {
    assert.deepEqual(reviewerWording(issue("C7", "q2", "odd `thing`")), {
      tone: "warn",
      html: "Dates aren't pinned. odd <code>thing</code>",
    });
  });
  it("gives an error as check's message, escaped", () => {
    assert.deepEqual(
      reviewerWording(issue("C6", "f3", "cycle f3 -> f4 -> f3", "error")),
      { tone: "stop", html: "cycle f3 -&gt; f4 -&gt; f3" },
    );
  });
});

describe("highlightSql", () => {
  it("escapes text that is not a keyword", () => {
    assert.equal(highlightSql("a < b & c"), "a &lt; b &amp; c");
  });
  it("marks keywords", () => {
    assert.equal(
      highlightSql("select x from t"),
      '<span class="kw">select</span> x <span class="kw">from</span> t',
    );
  });
  it("marks keywords in any case, keeping the case", () => {
    assert.equal(highlightSql("SELECT x"), '<span class="kw">SELECT</span> x');
  });
  it("marks a string, with no keywords inside it", () => {
    assert.equal(
      highlightSql("where d = 'select'"),
      '<span class="kw">where</span> d = <span class="str">\'select\'</span>',
    );
  });
  it("marks a comment to the end of its line, and whole numbers", () => {
    assert.equal(
      highlightSql("-- from q1\nselect 1"),
      '<span class="cm">-- from q1</span>\n<span class="kw">select</span> <span class="num">1</span>',
    );
  });
});

describe("needsAttention", () => {
  it("has nothing for a clean summary", () => {
    assert.deepEqual(needsAttention(data().summary), { items: [], notes: [] });
  });
  it("lists an ungrounded node", () => {
    const summary = {
      ...data().summary,
      ungrounded: [{ node: "i2", text: "Margins will rise." }],
    };
    assert.deepEqual(needsAttention(summary).items, [
      {
        node: "i2",
        swatch: "ungrounded",
        tone: "stop",
        tag: "Nothing behind it",
        html: "Margins will rise.",
      },
    ]);
  });
  it("lists an external source", () => {
    const summary = {
      ...data().summary,
      external: [{ node: "x1", ref: "targets.csv" }],
    };
    assert.deepEqual(needsAttention(summary).items, [
      {
        node: "x1",
        swatch: "partial",
        tone: "ext",
        tag: "External source",
        html: "targets.csv. Trailline can't see inside it.",
      },
    ]);
  });
  it('lists a C7 without repeating "Dates aren\'t pinned"', () => {
    const summary = {
      ...data().summary,
      issues: [issue("C7", "q2", C7_MESSY)],
    };
    assert.deepEqual(needsAttention(summary), {
      items: [
        {
          node: "q2",
          swatch: "warn",
          tone: "warn",
          tag: "C7 · Dates not pinned",
          html: "No columns are recorded. The SQL doesn't use the recorded period as fixed dates. It uses <code>current_date</code>, so re-running it gives different numbers.",
        },
      ],
      notes: [],
    });
  });
  it("lists a C3 as a stop", () => {
    const summary = {
      ...data().summary,
      issues: [
        issue("C3", "f1", 'page shows "$58.90" but display is "$61.20"'),
      ],
    };
    assert.deepEqual(needsAttention(summary).items, [
      {
        node: "f1",
        swatch: "stopw",
        tone: "stop",
        tag: "C3 · Page differs from lineage",
        html: "The page shows <b>$58.90</b>, but the lineage records <b>$61.20</b>.",
      },
    ]);
  });
  it("lists a C2 as a warning", () => {
    const summary = {
      ...data().summary,
      issues: [
        issue("C2", "i1", 'bare number "1,240" is not inside a figure\'s span'),
      ],
    };
    const [item] = needsAttention(summary).items;
    assert.equal(item.tag, "C2 · Number not bound");
    assert.equal(item.swatch, "warn");
    assert.equal(item.tone, "warn");
  });
  it("puts the builder's warnings in notes, not items", () => {
    const s5 = issue("S5", "v1", "unknown field `notes` on a view");
    const summary = { ...data().summary, issues: [s5] };
    assert.deepEqual(needsAttention(summary), { items: [], notes: [s5] });
  });
  it("orders stops, then warnings, then external sources", () => {
    const summary = {
      ...data().summary,
      ungrounded: [{ node: "i2", text: "Margins will rise." }],
      external: [{ node: "x1", ref: "targets.csv" }],
      issues: [issue("C7", "q2", C7_MESSY)],
    };
    assert.deepEqual(
      needsAttention(summary).items.map((item) => item.node),
      ["i2", "q2", "x1"],
    );
  });
  it("puts a C3 before a C7 whatever order check gave them", () => {
    const summary = {
      ...data().summary,
      issues: [
        issue("C7", "q2", C7_MESSY),
        issue("C3", "f1", 'page shows "1" but display is "2"'),
      ],
    };
    assert.deepEqual(
      needsAttention(summary).items.map((item) => item.node),
      ["f1", "q2"],
    );
  });
  it("puts errors before everything else, in check's order", () => {
    const summary = {
      ...data().summary,
      ungrounded: [{ node: "i2", text: "Margins will rise." }],
      issues: [
        issue("C1", "f9", 'data-trailline="f9" resolves to no node', "error"),
        issue("C4", "i1", "`from` is empty", "error"),
      ],
    };
    assert.deepEqual(needsAttention(summary), {
      items: [
        {
          node: "f9",
          swatch: "stopw",
          tone: "stop",
          tag: "C1 · Error",
          html: "data-trailline=&quot;f9&quot; resolves to no node",
        },
        {
          node: "i1",
          swatch: "stopw",
          tone: "stop",
          tag: "C4 · Error",
          html: "<code>from</code> is empty",
        },
        {
          node: "i2",
          swatch: "ungrounded",
          tone: "stop",
          tag: "Nothing behind it",
          html: "Margins will rise.",
        },
      ],
      notes: [],
    });
  });
});

describe("overview", () => {
  it("says when every number and claim traces to SQL", () => {
    assert.deepEqual(overview(nums("full", "full")), {
      lede: "All 2 numbers and claims trace back to SQL.",
      sub: "Click any of them in the report to see how it was computed.",
    });
  });
  it("counts what traces, what is external and what has nothing behind it", () => {
    assert.deepEqual(
      overview(nums("full", "partial", "partial", "ungrounded", "ungrounded")),
      {
        lede: "1 of 5 numbers and claims trace back to SQL.",
        sub: "2 rest on an external source. 2 have nothing recorded behind them.",
      },
    );
  });
  it("uses the singular for one", () => {
    assert.equal(
      overview(nums("full", "partial", "ungrounded")).sub,
      "1 rests on an external source. 1 has nothing recorded behind it.",
    );
  });
  it("leaves out a part with nothing in it", () => {
    assert.equal(
      overview(nums("full", "ungrounded")).sub,
      "1 has nothing recorded behind it.",
    );
  });
  it("leads with the errors when the report fails check", () => {
    const failing = (...codes) => ({
      ...nums("full"),
      refused: REFUSED,
      summary: {
        ...data().summary,
        issues: [
          ...codes.map((code) => issue(code, "f9", "x", "error")),
          issue("S5", "v1", "z"),
        ],
      },
    });
    assert.deepEqual(overview(failing("C1", "C6")), {
      lede: "This report does not pass check: 2 errors.",
      sub: "The lineage shows as far as it goes. Copying SQL is off until the errors are fixed.",
    });
    assert.equal(
      overview(failing("C1")).lede,
      "This report does not pass check: 1 error.",
    );
  });
});

describe("reportSql", () => {
  it("copies the composed report", () => {
    assert.deepEqual(
      reportSql(data({ composedReport: "-- r.html\nselect 1" })),
      { sql: "-- r.html\nselect 1", reason: null },
    );
  });
  it("is off with sql's reason when the report fails check", () => {
    assert.deepEqual(reportSql(data({ refused: REFUSED })), {
      sql: null,
      reason: REFUSED,
    });
  });
});

describe("chainSql", () => {
  it("copies the one-node script", () => {
    assert.deepEqual(
      chainSql(data({ composed: { f1: "-- r.html (f1)\nselect 1" } }), "f1"),
      { sql: "-- r.html (f1)\nselect 1", reason: null },
    );
  });
  it("is off when there is nothing to run", () => {
    assert.deepEqual(chainSql(data({ composed: { f1: "…" } }), "x1"), {
      sql: null,
      reason: "Nothing here to run",
    });
  });
  it("is off with sql's reason when the report fails check", () => {
    assert.deepEqual(chainSql(data({ refused: REFUSED }), "f1"), {
      sql: null,
      reason: REFUSED,
    });
  });
});

describe("stepSql", () => {
  it("copies the step's own SQL", () => {
    assert.deepEqual(stepSql(data(), "v1"), {
      sql: G.nodes.v1.sql,
      reason: null,
    });
  });
  it("is off with sql's reason when the report fails check", () => {
    assert.deepEqual(stepSql(data({ refused: REFUSED }), "v1"), {
      sql: null,
      reason: REFUSED,
    });
  });
});

describe("lineage: fixtures", () => {
  it("lays out clean's 11.8% from q1 at step 1 up to f3", () => {
    assert.deepEqual(beats(fx("clean").graph, "f3"), [
      { n: 4, ids: ["f3"] },
      { n: 3, ids: ["f1", "f2"] },
      { n: 2, ids: ["v1"] },
      { n: 1, ids: ["q1"] },
    ]);
  });
  it("copies clean's SQL as trailline sql does", () => {
    const d = fx("clean");
    assert.equal(reportSql(d).sql, CLEAN_SQL);
    assert.equal(chainSql(d, "f3").sql, CLEAN_F3_SQL);
  });
  it("gives clean a calm summary", () => {
    const d = fx("clean");
    assert.deepEqual(overview(d), {
      lede: "All 9 numbers and claims trace back to SQL.",
      sub: "Click any of them in the report to see how it was computed.",
    });
    assert.deepEqual(needsAttention(d.summary), { items: [], notes: [] });
  });
  it("lists messy's 7 items that need attention", () => {
    assert.deepEqual(
      items("messy").map((i) => i.node),
      ["i2", "i3", "i4", "f1", "i1", "q2", "t1"],
    );
    assert.deepEqual(
      items("messy").map((i) => i.tag),
      [
        "Nothing behind it",
        "Nothing behind it",
        "Nothing behind it",
        "C3 · Page differs from lineage",
        "C2 · Number not bound",
        "C7 · Dates not pinned",
        "External source",
      ],
    );
  });
  it("gives messy's builder notes and lede", () => {
    const d = fx("messy");
    assert.deepEqual(
      needsAttention(d.summary).notes.map((i) => i.code),
      ["S6", "S5", "S7", "C8"],
    );
    assert.deepEqual(overview(d), {
      lede: "2 of 8 numbers and claims trace back to SQL.",
      sub: "3 rest on an external source. 3 have nothing recorded behind them.",
    });
  });
  it("shows messy's C3 and C7 in the reviewer's words", () => {
    const { issues } = fx("messy").summary;
    const on = (node, code) =>
      reviewerWording(issues.find((i) => i.node === node && i.code === code));
    assert.deepEqual(on("f1", "C3"), {
      tone: "stop",
      html: "The page shows <b>$58.90</b>, but the lineage records <b>$61.20</b>.",
    });
    assert.deepEqual(on("q2", "C7"), {
      tone: "warn",
      html: "Dates aren't pinned. No columns are recorded. The SQL doesn't use the recorded period as fixed dates. It uses <code>current_date</code>, so re-running it gives different numbers.",
    });
  });
  it("lists broken's 10 errors first", () => {
    const d = fx("broken");
    assert.equal(d.summary.issues.length, 10);
    assert.deepEqual(
      items("broken").map((i) => i.tag),
      d.summary.issues.map((i) => `${i.code} · Error`),
    );
    assert.deepEqual(needsAttention(d.summary).notes, []);
    assert.equal(
      overview(d).lede,
      "This report does not pass check: 10 errors.",
    );
  });
  it("turns off every copy button on broken", async () => {
    const d = fx("broken");
    const off = { sql: null, reason: d.refused };
    const printed = await runCli(["sql", loadFixture("broken").reportPath]);
    assert.equal(`trailline: ${d.refused}`, printed.err);
    assert.deepEqual(reportSql(d), off);
    for (const [id, node] of Object.entries(d.graph.nodes)) {
      assert.deepEqual(chainSql(d, id), off, id);
      if (node.sql) assert.deepEqual(stepSql(d, id), off, id);
    }
  });
  it("lists S1 for a graph the page cannot read", (t) => {
    const dir = tempDir(t);
    for (const text of [
      "null",
      "[]",
      '"x"',
      '{"trailline":"1.0"}',
      '{"trailline":"1.0","nodes":5}',
      '{"trailline":"1.0","nodes":[]}',
    ]) {
      const graphPath = join(dir, "g.json");
      writeFileSync(graphPath, text);
      const d = buildPayload({
        reportPath: loadFixture("clean").reportPath,
        graphPath,
      });
      assert.deepEqual(nodesOf(d.graph), {}, text);
      assert.deepEqual(
        needsAttention(d.summary).items.map((i) => i.tag),
        ["S1 · Error"],
        text,
      );
      assert.equal(
        overview(d).lede,
        "This report does not pass check: 1 error.",
        text,
      );
      assert.equal(reportSql(d).sql, null, text);
    }
  });
  it("gives every fixture's nodes through nodesOf", () => {
    for (const name of ["clean", "messy", "broken"]) {
      const d = fx(name);
      assert.deepEqual(
        Object.keys(nodesOf(d.graph)),
        Object.keys(d.graph.nodes).filter(
          (id) => d.graph.nodes[id] && typeof d.graph.nodes[id] === "object",
        ),
        name,
      );
    }
  });
  it("selects every bound id on clean", () => {
    const d = fx("clean");
    const ids = [...d.html.matchAll(/data-trailline="([^"]*)"/g)].map(
      (m) => m[1],
    );
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.deepEqual(
        fromReport(d, { trailline: "select", id }),
        { type: "select", id },
        id,
      );
    }
  });
  it("lays out broken's cycle without hanging", () => {
    assert.deepEqual(beats(fx("broken").graph, "f3"), [
      { n: 2, ids: ["f3"] },
      { n: 1, ids: ["f4"] },
    ]);
  });
});
