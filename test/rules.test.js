import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { RULES, checkRules, parseDisplayNumber } from "../src/check/rules.js";
import { proseSkip, readPage } from "../src/html/page.js";
import { readGraph } from "../src/graph/parse.js";
import { RULES as SCHEMA_RULES, validateGraph } from "../src/graph/schema.js";
import { FIXTURE_NAMES, loadFixture } from "./helpers.js";

const pageOf = (bindings, prose = []) => ({
  bindings: bindings.map((b, offset) =>
    Array.isArray(b)
      ? { id: b[0], text: b[1], offset }
      : { id: b, text: "", offset },
  ),
  prose,
});
const only = (issues, code) => issues.filter((i) => i.code === code);
const pick = ({ code, severity, node }) => ({ code, severity, node });
const key = ({ code, severity, node }) => `${code} ${severity} ${node}`;

/** graph, page (with proseSkip) for a fixture. */
function fixture(name) {
  const { reportPath } = loadFixture(name);
  const { graph } = readGraph({ reportPath });
  const page = readPage(readFileSync(reportPath, "utf8"), {
    skip: proseSkip(graph),
  });
  return { graph, page };
}

const fig = (extra) => ({
  step: "figure",
  from: ["v1"],
  sql: "select\n    a\nfrom v1",
  ...extra,
});

describe("parseDisplayNumber", () => {
  it("reads the display forms figures use", () => {
    const cases = {
      "$61.20": { number: 61.2, decimals: 2, percent: false },
      "46.6%": { number: 46.6, decimals: 1, percent: true },
      "48,210": { number: 48210, decimals: 0, percent: false },
      "#1": { number: 1, decimals: 0, percent: false },
      "+11.8%": { number: 11.8, decimals: 1, percent: true },
      "-3.5 %": { number: -3.5, decimals: 1, percent: true },
      "−2": { number: -2, decimals: 0, percent: false },
      "€1,204.5": { number: 1204.5, decimals: 1, percent: false },
    };
    for (const [text, expected] of Object.entries(cases)) {
      assert.deepEqual(parseDisplayNumber(text), expected, text);
    }
    for (const text of [
      "Paid social",
      "",
      "12 pp",
      "$2bn",
      "1,24",
      "3rd",
      "4.8%%",
    ]) {
      assert.equal(parseDisplayNumber(text), null, text);
    }
  });
});

describe("C1", () => {
  it("reports each unknown id once", () => {
    const nodes = { f1: fig({}) };
    const page = pageOf(["f1", "zz", "zz", ""]);
    const issues = only(checkRules({ nodes }, page), "C1");
    assert.deepEqual(issues, [
      {
        code: "C1",
        severity: "error",
        node: "zz",
        field: null,
        message: 'data-trailline="zz" resolves to no node',
      },
      {
        code: "C1",
        severity: "error",
        node: "",
        field: null,
        message: 'data-trailline="" resolves to no node',
      },
    ]);
  });

  it("reports views, figures and insights bound nowhere", () => {
    const nodes = {
      q1: { step: "source", kind: "sql" },
      x1: { step: "source", kind: "external" },
      v1: { step: "view", from: ["q1"] },
      f1: { step: "figure", from: ["v1"] },
      i1: { step: "insight", from: ["f1"] },
      i2: { step: "insight", from: [], ungrounded: true },
      m1: { step: "metric" },
      n1: null,
    };
    const issues = only(checkRules({ nodes }, pageOf([])), "C1");
    assert.deepEqual(issues, [
      {
        code: "C1",
        severity: "error",
        node: "v1",
        field: null,
        message: "view is not bound to any element on the page",
      },
      {
        code: "C1",
        severity: "error",
        node: "f1",
        field: null,
        message: "figure is not bound to any element on the page",
      },
      {
        code: "C1",
        severity: "error",
        node: "i1",
        field: null,
        message: "insight is not bound to any element on the page",
      },
      {
        code: "C1",
        severity: "error",
        node: "i2",
        field: null,
        message: "insight is not bound to any element on the page",
      },
    ]);
  });

  it("accepts a node bound several times", () => {
    const nodes = { f1: fig({}) };
    const issues = only(checkRules({ nodes }, pageOf(["f1", "f1"])), "C1");
    assert.deepEqual(issues, []);
  });

  it("reports a bound source once", () => {
    const nodes = { q1: { step: "source", kind: "sql" } };
    const issues = only(checkRules({ nodes }, pageOf(["q1", "q1"])), "C1");
    assert.deepEqual(issues, [
      {
        code: "C1",
        severity: "error",
        node: "q1",
        field: null,
        message: "`q1` is a source; bind a figure over it instead",
      },
    ]);
  });
});

describe("C2", () => {
  it("reports each bare number in counted prose on its nearest binding", () => {
    const nodes = { i1: { step: "insight", from: ["f1"], text: "t" } };
    const page = pageOf(
      [],
      [
        { text: "rose 12% on 1,240 users in 2026", node: "i1", offset: 0 },
        { text: "30-day churn", node: null, offset: 40 },
        { text: "up 5%", node: null, offset: 60 },
      ],
    );
    const issues = only(checkRules({ nodes }, page), "C2");
    assert.deepEqual(issues, [
      {
        code: "C2",
        severity: "warning",
        node: "i1",
        field: null,
        message: 'bare number "12%" is not inside a figure\'s span',
      },
      {
        code: "C2",
        severity: "warning",
        node: "i1",
        field: null,
        message: 'bare number "1,240" is not inside a figure\'s span',
      },
      {
        code: "C2",
        severity: "warning",
        node: null,
        field: null,
        message: 'bare number "5%" is not inside a figure\'s span',
      },
    ]);
  });
});

describe("C3", () => {
  it("accepts text equal to display", () => {
    const nodes = { f1: fig({ value: 0.466, display: "46.6%" }) };
    const page = pageOf([["f1", "46.6%"]]);
    assert.deepEqual(only(checkRules({ nodes }, page), "C3"), []);
  });

  it("accepts a parsed value within half a unit", () => {
    const cases = [
      [fig({ value: 0.1175, display: "11.75%" }), "11.8%"],
      [fig({ value: 61.2, display: "$61.2" }), "$61.20"],
      [fig({ value: 48210, display: "48210" }), "48,210"],
    ];
    for (const [f1, text] of cases) {
      const page = pageOf([["f1", text]]);
      assert.deepEqual(only(checkRules({ nodes: { f1 } }, page), "C3"), []);
    }
  });

  it("rejects a value outside half a unit", () => {
    const f1 = fig({ value: 0.1175, display: "11.75%" });
    const page = pageOf([["f1", "11.9%"]]);
    assert.deepEqual(only(checkRules({ nodes: { f1 } }, page), "C3"), [
      {
        code: "C3",
        severity: "warning",
        node: "f1",
        field: "display",
        message: 'page shows "11.9%" but display is "11.75%"',
      },
    ]);
  });

  it("compares string values on display only", () => {
    const f1 = fig({ value: "paid_social", display: "Paid social" });
    const bad = pageOf([["f1", "Paid Social"]]);
    assert.deepEqual(only(checkRules({ nodes: { f1 } }, bad), "C3"), [
      {
        code: "C3",
        severity: "warning",
        node: "f1",
        field: "display",
        message: 'page shows "Paid Social" but display is "Paid social"',
      },
    ]);
    const good = pageOf([["f1", "Paid social"]]);
    assert.deepEqual(only(checkRules({ nodes: { f1 } }, good), "C3"), []);
  });

  it("reports once per figure, listing each wrong text once", () => {
    const f1 = fig({ value: 61.2, display: "$61.20" });
    const page = pageOf([
      ["f1", "$58.90"],
      ["f1", "$58.90"],
      ["f1", "$61.20"],
      ["f1", "$57.00"],
    ]);
    assert.deepEqual(only(checkRules({ nodes: { f1 } }, page), "C3"), [
      {
        code: "C3",
        severity: "warning",
        node: "f1",
        field: "display",
        message: 'page shows "$58.90", "$57.00" but display is "$61.20"',
      },
    ]);
  });

  it("falls back to value, and skips what it cannot compare", () => {
    const ungroundedFigure = { step: "figure", from: [], ungrounded: true };
    let page = pageOf([["f1", "12%"]]);
    assert.deepEqual(
      only(checkRules({ nodes: { f1: ungroundedFigure } }, page), "C3"),
      [],
    );

    const f1 = fig({ value: 0.5 });
    page = pageOf([["f1", "50%"]]);
    assert.deepEqual(only(checkRules({ nodes: { f1 } }, page), "C3"), []);
    page = pageOf([["f1", "51%"]]);
    assert.deepEqual(only(checkRules({ nodes: { f1 } }, page), "C3"), [
      {
        code: "C3",
        severity: "warning",
        node: "f1",
        field: "display",
        message: 'page shows "51%" but value is 0.5',
      },
    ]);

    const f1c = fig({ value: 0.048, display: "4.8%" });
    page = pageOf([["f1", "n/a"]]);
    assert.deepEqual(only(checkRules({ nodes: { f1: f1c } }, page), "C3"), [
      {
        code: "C3",
        severity: "warning",
        node: "f1",
        field: "display",
        message: 'page shows "n/a" but display is "4.8%"',
      },
    ]);

    const i1 = { step: "insight", from: ["f1"], text: "t" };
    page = pageOf([["i1", "12%"]]);
    assert.deepEqual(only(checkRules({ nodes: { i1 } }, page), "C3"), []);
  });
});

const chain = {
  q1: { step: "source", kind: "sql" },
  q2: { step: "source", kind: "sql" },
  v1: { step: "view", from: ["q1", "q2"], sql: "s" },
  v2: { step: "view", from: ["v1"], sql: "s" },
  v3: { step: "view", from: ["v1", "q1"], sql: "s" },
  v4: { step: "view", from: ["v1", "v2"], sql: "s" },
  v5: { step: "view", from: ["fa"], sql: "s" },
  fa: { step: "figure", from: ["v1"], sql: "s" },
  fb: { step: "figure", from: ["v1", "q1"], sql: "s" },
  fc: { step: "figure", from: ["fa"], sql: "s" },
  fd: { step: "figure", from: ["fa"], expr: "fa * 2" },
  fe: { step: "figure", from: ["v1"], expr: "v1 + 1" },
  ff: { step: "figure", from: ["fa"], expr: "fa + fd" },
  ia: { step: "insight", from: ["fa", "ib"], text: "t" },
  ib: { step: "insight", from: ["fd"], text: "t" },
  ic: { step: "insight", from: ["v1"], text: "t" },
};

describe("C5", () => {
  it("checks each step's parents", () => {
    const issues = only(checkRules({ nodes: chain }, pageOf([])), "C5");
    assert.deepEqual(
      issues.map(({ node, message }) => [node, message]),
      [
        ["v3", "a view rests on sources, or on exactly one view"],
        ["v4", "a view rests on sources, or on exactly one view"],
        ["v5", "a view rests on sources, or on exactly one view"],
        ["fb", "a figure with `sql` rests on exactly one view or source"],
        ["fc", "a figure with `sql` rests on exactly one view or source"],
        ["fe", "a figure with `expr` rests on figures only"],
        ["ff", "`expr` uses fd, which is not in `from`"],
        ["ic", "an insight rests on figures and insights only"],
      ],
    );
    for (const issue of issues) {
      assert.equal(issue.severity, "error");
      assert.equal(issue.field, "from");
    }
  });

  it("skips nodes it cannot read", () => {
    const nodes = {
      q1: { step: "source", kind: "sql" },
      v1: { step: "view", from: ["q1"], sql: "s" },
      fg: { step: "figure", from: ["v1", "q1"], sql: "s", expr: "fa" },
      fh: { step: "figure", from: ["v1"], expr: "fa ^ 2" },
      fi: { step: "figure", from: ["v1"], ungrounded: true },
      fj: { step: "figure", from: "v1", sql: "s" },
      fk: { step: "figure", from: [], sql: "s" },
      id: { step: "insight", from: ["m1"], text: "t" },
      m1: { step: "metric" },
    };
    assert.deepEqual(only(checkRules({ nodes }, pageOf([])), "C5"), []);
  });

  it("reports parents that are not nodes", () => {
    const nodes = {
      q1: { step: "source", kind: "sql" },
      ig: { step: "insight", from: ["zz"], text: "t" },
      vz: { step: "view", from: ["q9", "zz", "q1"], sql: "s" },
    };
    assert.deepEqual(only(checkRules({ nodes }, pageOf([])), "C5"), [
      {
        code: "C5",
        severity: "error",
        node: "ig",
        field: "from",
        message: "`from` names zz, which is not a node",
      },
      {
        code: "C5",
        severity: "error",
        node: "vz",
        field: "from",
        message: "`from` names q9, zz, which are not nodes",
      },
    ]);
  });
});

describe("C6", () => {
  it("reports a cycle once, on its first id in the graph", () => {
    const nodes = { f3: { from: ["f4"] }, f4: { from: ["f3"] } };
    assert.deepEqual(only(checkRules({ nodes }, pageOf([])), "C6"), [
      {
        code: "C6",
        severity: "error",
        node: "f3",
        field: "from",
        message: "cycle f3 -> f4 -> f3",
      },
    ]);

    const reversed = { f4: nodes.f4, f3: nodes.f3 };
    assert.deepEqual(only(checkRules({ nodes: reversed }, pageOf([])), "C6"), [
      {
        code: "C6",
        severity: "error",
        node: "f4",
        field: "from",
        message: "cycle f4 -> f3 -> f4",
      },
    ]);
  });

  it("finds self-loops and separate cycles, and nothing in a diamond", () => {
    const a = { f1: { from: ["f1"] } };
    assert.deepEqual(
      only(checkRules({ nodes: a }, pageOf([])), "C6").map(pick),
      [{ code: "C6", severity: "error", node: "f1" }],
    );
    assert.equal(
      only(checkRules({ nodes: a }, pageOf([])), "C6")[0].message,
      "cycle f1 -> f1",
    );

    const b = {
      a: { from: ["b"] },
      b: { from: ["a"] },
      c: { from: ["d"] },
      d: { from: ["c"] },
    };
    const bIssues = only(checkRules({ nodes: b }, pageOf([])), "C6");
    assert.deepEqual(
      bIssues.map(({ node, message }) => [node, message]),
      [
        ["a", "cycle a -> b -> a"],
        ["c", "cycle c -> d -> c"],
      ],
    );

    const c = {
      q1: { step: "source" },
      f1: { from: ["q1"] },
      f2: { from: ["q1"] },
      f3: { from: ["f1", "f2"] },
      i1: { from: ["f1", "f2", "f3"] },
    };
    assert.deepEqual(only(checkRules({ nodes: c }, pageOf([])), "C6"), []);

    const d = { a: { from: ["zz"] } };
    assert.deepEqual(only(checkRules({ nodes: d }, pageOf([])), "C6"), []);
  });
});

const source = {
  step: "source",
  kind: "sql",
  mart: "marts.orders",
  period: { from: "2026-01-01", to: "2026-01-31" },
  sql: "select\n    order_id\nfrom marts.orders\nwhere order_date between '2026-01-01' and '2026-01-31'",
  columns: ["order_id"],
};

describe("C7", () => {
  it("accepts a complete, pinned sql source", () => {
    const nodes = { q1: source };
    const page = pageOf([]);
    assert.deepEqual(only(checkRules({ nodes }, page), "C7"), []);
    assert.deepEqual(only(checkRules({ nodes }, page), "C8"), []);
  });

  it("messy q2 is incomplete, unpinned and uses date functions", () => {
    const { graph } = fixture("messy");
    assert.deepEqual(
      only(checkRules(graph, pageOf([])), "C7").filter((i) => i.node === "q2"),
      [
        {
          code: "C7",
          severity: "warning",
          node: "q2",
          field: null,
          message:
            "sql source is missing `columns`; SQL does not contain the period as literal dates: '2026-08-01', '2026-08-31'; SQL uses date functions: current_date",
        },
      ],
    );
  });

  it("lists every missing field", () => {
    const nodes = { q1: { step: "source", kind: "sql" } };
    assert.deepEqual(only(checkRules({ nodes }, pageOf([])), "C7"), [
      {
        code: "C7",
        severity: "warning",
        node: "q1",
        field: null,
        message: "sql source is missing `mart`, `period`, `sql`, `columns`",
      },
    ]);
  });

  it("wants each period date as a literal outside comments", () => {
    const nodes = {
      q1: {
        ...source,
        sql: "-- through '2026-01-31'\nselect\n    order_id\nfrom marts.orders\nwhere order_date between '2026-01-01' and '2026-02-28'",
      },
    };
    assert.deepEqual(only(checkRules({ nodes }, pageOf([])), "C7"), [
      {
        code: "C7",
        severity: "warning",
        node: "q1",
        field: null,
        message:
          "SQL does not contain the period as literal dates: '2026-01-31'",
      },
    ]);
  });

  it("ignores external sources and other steps", () => {
    const nodes = {
      x1: { step: "source", kind: "external" },
      v1: { step: "view", from: ["x1"] },
    };
    assert.deepEqual(only(checkRules({ nodes }, pageOf([])), "C7"), []);
  });
});

describe("C8", () => {
  it("reports messy v2 once", () => {
    const { graph } = fixture("messy");
    assert.deepEqual(
      only(checkRules(graph, pageOf([])), "C8").filter((i) => i.node === "v2"),
      [
        {
          code: "C8",
          severity: "warning",
          node: "v2",
          field: "sql",
          message: "SQL style: uses select *; list the columns",
        },
      ],
    );
  });

  it("leaves date functions in a source to C7", () => {
    const nodes = {
      q1: {
        ...source,
        period: { from: "2026-08-01", to: "2026-08-31" },
        sql: "select\n    *\nfrom marts.web\nwhere d >= dateadd('day', -1, current_date)",
      },
    };
    assert.deepEqual(only(checkRules({ nodes }, pageOf([])), "C8"), [
      {
        code: "C8",
        severity: "warning",
        node: "q1",
        field: "sql",
        message: "SQL style: uses select *; list the columns",
      },
    ]);
    assert.deepEqual(only(checkRules({ nodes }, pageOf([])), "C7"), [
      {
        code: "C7",
        severity: "warning",
        node: "q1",
        field: null,
        message:
          "SQL does not contain the period as literal dates: '2026-08-01', '2026-08-31'; SQL uses date functions: current_date",
      },
    ]);
  });

  it("checks sql figures against their parents, and nothing else", () => {
    const nodes = {
      q1: source,
      v1: {
        step: "view",
        from: ["q1"],
        sql: "select\n    order_id\nfrom q1",
      },
      fa: { step: "figure", from: ["v1"], sql: "select\n    x\nfrom v2" },
      fb: { step: "figure", from: ["fa"], expr: "fa * 2" },
      fc: { step: "figure", from: ["v1"], sql: 5 },
    };
    assert.deepEqual(only(checkRules({ nodes }, pageOf([])), "C8"), [
      {
        code: "C8",
        severity: "warning",
        node: "fa",
        field: "sql",
        message: "SQL style: refer to parents by node id: v1",
      },
    ]);
  });
});

describe("checkRules on fixtures", () => {
  it("clean raises nothing", () => {
    const { graph, page } = fixture("clean");
    assert.deepEqual(checkRules(graph, page), []);
  });

  it("messy raises every warning rule once, in rule order", () => {
    const { graph, page } = fixture("messy");
    const issues = checkRules(graph, page);
    assert.deepEqual(issues.map(pick), [
      { code: "C2", severity: "warning", node: "i1" },
      { code: "C3", severity: "warning", node: "f1" },
      { code: "C7", severity: "warning", node: "q2" },
      { code: "C8", severity: "warning", node: "v2" },
    ]);
    assert.equal(
      issues.find((i) => i.code === "C2").message,
      'bare number "1,240" is not inside a figure\'s span',
    );
    assert.equal(
      issues.find((i) => i.code === "C3").message,
      'page shows "$58.90" but display is "$61.20"',
    );
  });

  it("broken raises every error rule, in rule order", () => {
    const { graph, page } = fixture("broken");
    const issues = checkRules(graph, page);
    assert.deepEqual(issues.map(pick), [
      { code: "C1", severity: "error", node: "f9" },
      { code: "C1", severity: "error", node: "v2" },
      { code: "C5", severity: "error", node: "i2" },
      { code: "C6", severity: "error", node: "f3" },
    ]);
    assert.equal(
      issues.find((i) => i.code === "C5").message,
      "an insight rests on figures and insights only",
    );
    assert.equal(
      issues.find((i) => i.code === "C6").message,
      "cycle f3 -> f4 -> f3",
    );
  });
});

describe("fixture contract", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} matches expected.json`, () => {
      const { graph, page } = fixture(name);
      const { expected } = loadFixture(name);
      const actual = [...validateGraph(graph), ...checkRules(graph, page)]
        .map(key)
        .sort();
      const wanted = expected.issues.map(key).sort();
      assert.deepEqual(actual, wanted);
    });
  }

  it("every expected code is a rule, with that rule's severity", () => {
    for (const name of FIXTURE_NAMES) {
      for (const issue of loadFixture(name).expected.issues) {
        const table = issue.code in SCHEMA_RULES ? SCHEMA_RULES : RULES;
        assert.ok(issue.code in table, key(issue));
        assert.equal(issue.severity, table[issue.code].severity, key(issue));
      }
    }
  });
});

describe("checkRules", () => {
  it("raises only the rules it lists", () => {
    assert.deepEqual(Object.keys(RULES), [
      "C1",
      "C2",
      "C3",
      "C5",
      "C6",
      "C7",
      "C8",
    ]);
  });

  it("returns nothing for a graph without a nodes object", () => {
    assert.deepEqual(checkRules({}, pageOf(["a"])), []);
    assert.deepEqual(checkRules(null, pageOf(["a"])), []);
    assert.deepEqual(checkRules({ nodes: [] }, pageOf(["a"])), []);
    assert.deepEqual(
      checkRules({ nodes: { a: null, b: 5 } }, pageOf(["a"])),
      [],
    );
  });
});
