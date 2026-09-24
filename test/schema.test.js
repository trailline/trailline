import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readGraph } from "../src/graph/parse.js";
import { RULES, validateGraph } from "../src/graph/schema.js";
import { FIXTURE_NAMES, loadFixture } from "./helpers.js";

const key = ({ code, severity, node }) => `${code} ${severity} ${node}`;

/** The rule codes validateGraph found, as sorted `code severity node` keys. */
function codes(graph) {
  return validateGraph(graph).map(key).sort();
}

/** A copy of `node` without the named fields. */
function without(node, ...fields) {
  const copy = { ...node };
  for (const field of fields) delete copy[field];
  return copy;
}

/** A minimal graph around the given nodes. */
const graphOf = (nodes) => ({ trailline: "1.0", nodes });

const sqlSource = {
  step: "source",
  kind: "sql",
  mart: "marts.orders",
  period: { from: "2026-01-01", to: "2026-01-31" },
  sql: "select\n    order_id\nfrom marts.orders",
  columns: ["order_id"],
};
const view = { step: "view", from: ["q1"], sql: "select 1", columns: ["a"] };
const figure = {
  step: "figure",
  from: ["v1"],
  sql: "select a from v1",
  value: 1,
  display: "1",
  label: "One",
};

describe("fixtures", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} raises exactly the schema issues in expected.json`, () => {
      const { reportPath, expected } = loadFixture(name);
      const { graph } = readGraph({ reportPath });
      const owned = expected.issues.filter((issue) => issue.code in RULES);
      assert.deepEqual(codes(graph), owned.map(key).sort());
    });
  }

  it("every expected severity matches the rule table", () => {
    for (const name of FIXTURE_NAMES) {
      for (const issue of loadFixture(name).expected.issues) {
        if (issue.code in RULES) {
          assert.equal(issue.severity, RULES[issue.code].severity, key(issue));
        }
      }
    }
  });
});

describe("header", () => {
  it("accepts a minimal graph", () => {
    assert.deepEqual(codes(graphOf({})), []);
  });

  it("accepts the reserved signature field", () => {
    assert.deepEqual(codes({ ...graphOf({}), signature: null }), []);
  });

  const bad = {
    "a missing version": [{ nodes: {} }, ["S1 error null"]],
    "a numeric version": [{ trailline: 1, nodes: {} }, ["S1 error null"]],
    "another major version": [
      { trailline: "2.0", nodes: {} },
      ["S1 error null"],
    ],
    "missing nodes": [{ trailline: "1.0" }, ["S1 error null"]],
    "nodes as a list": [{ trailline: "1.0", nodes: [] }, ["S1 error null"]],
    "a bad built_at": [
      { ...graphOf({}), built_at: "last tuesday" },
      ["S1 error null"],
    ],
    "a date-only built_at": [
      { ...graphOf({}), built_at: "2026-09-16" },
      ["S1 error null"],
    ],
    "an impossible built_at": [
      { ...graphOf({}), built_at: "2026-02-30T00:00:00Z" },
      ["S1 error null"],
    ],
    "an empty report_id": [
      { ...graphOf({}), report_id: "" },
      ["S1 error null"],
    ],
    "an unknown field": [{ ...graphOf({}), title: "x" }, ["S5 warning null"]],
  };
  for (const [what, [graph, expected]] of Object.entries(bad)) {
    it(`flags ${what}`, () => {
      assert.deepEqual(codes(graph), expected);
    });
  }

  it("accepts a built_at with seconds, fractions or an offset", () => {
    for (const built_at of [
      "2026-09-16T14:20Z",
      "2026-09-16T14:20:00.123Z",
      "2026-09-16T14:20:00+05:30",
    ]) {
      assert.deepEqual(codes({ ...graphOf({}), built_at }), []);
    }
  });

  it("accepts a later minor version", () => {
    assert.deepEqual(codes({ trailline: "1.4", nodes: {} }), []);
  });

  for (const input of [null, [], "graph", 42]) {
    it(`does not throw on ${JSON.stringify(input)}`, () => {
      assert.deepEqual(codes(input), ["S1 error null"]);
    });
  }
});

describe("nodes", () => {
  it("accepts well-formed nodes of every step", () => {
    const graph = graphOf({
      q1: sqlSource,
      x1: {
        step: "source",
        kind: "external",
        type: "csv",
        ref: "targets.csv",
        given: "A CSV",
      },
      v1: view,
      f1: figure,
      f2: { ...figure, from: ["f1"], sql: undefined, expr: "f1 * 2" },
      i1: { step: "insight", from: ["f1"], text: "It went up." },
    });
    delete graph.nodes.f2.sql;
    assert.deepEqual(codes(graph), []);
  });

  it("flags an id that is not a lowercase identifier", () => {
    assert.deepEqual(codes(graphOf({ "f-1": figure })), ["S2 error f-1"]);
  });

  it("flags a node that is not an object", () => {
    assert.deepEqual(codes(graphOf({ f1: "46.6%" })), ["S4 error f1"]);
  });

  it("flags a missing or unknown step and checks nothing else", () => {
    assert.deepEqual(codes(graphOf({ f1: { from: 3 } })), ["S3 error f1"]);
    assert.deepEqual(codes(graphOf({ k1: { step: "kpi", junk: 1 } })), [
      "S3 error k1",
    ]);
  });

  it("warns when the id prefix does not match the step", () => {
    assert.deepEqual(codes(graphOf({ v1: figure })), ["S6 warning v1"]);
    assert.deepEqual(
      codes(
        graphOf({
          q9: {
            step: "source",
            kind: "external",
            type: "a",
            ref: "b",
            given: "c",
          },
        }),
      ),
      ["S6 warning q9"],
    );
  });

  it("warns on unknown fields, including ones from another kind", () => {
    assert.deepEqual(codes(graphOf({ q1: { ...sqlSource, ref: "x" } })), [
      "S5 warning q1",
    ]);
  });
});

describe("sources", () => {
  it("needs a known kind", () => {
    assert.deepEqual(codes(graphOf({ q1: { step: "source" } })), [
      "S4 error q1",
    ]);
    assert.deepEqual(codes(graphOf({ q1: { step: "source", kind: "api" } })), [
      "S4 error q1",
    ]);
  });

  it("leaves missing sql-source fields to C7", () => {
    assert.deepEqual(
      codes(graphOf({ q1: { step: "source", kind: "sql" } })),
      [],
    );
  });

  it("warns when an external source does not say what it is", () => {
    assert.deepEqual(
      codes(graphOf({ x1: { step: "source", kind: "external" } })),
      ["S7 warning x1", "S7 warning x1", "S7 warning x1"],
    );
  });

  it("treats blank descriptive fields as missing", () => {
    const blank = {
      step: "source",
      kind: "external",
      type: "",
      ref: " ",
      given: "",
    };
    assert.deepEqual(codes(graphOf({ x1: blank })), [
      "S7 warning x1",
      "S7 warning x1",
      "S7 warning x1",
    ]);
  });

  const badSource = {
    "a reversed period": { period: { from: "2026-02-01", to: "2026-01-01" } },
    "an impossible date": { period: { from: "2026-02-30", to: "2026-03-01" } },
    "a period as a string": { period: "2026-01-01:2026-01-31" },
    "an unknown how": { how: "guessed" },
    "columns that are not strings": { columns: [1, 2] },
    "more than ten rows": {
      rows: { order_id: Array.from({ length: 11 }, (_, i) => i) },
    },
    "ragged rows": { rows: { a: [1, 2], b: [1] } },
    "row-shaped rows": { rows: [{ order_id: 1 }] },
  };
  for (const [what, patch] of Object.entries(badSource)) {
    it(`flags ${what}`, () => {
      assert.deepEqual(codes(graphOf({ q1: { ...sqlSource, ...patch } })), [
        "S4 error q1",
      ]);
    });
  }

  it("accepts null rows and up to ten columnar rows", () => {
    assert.deepEqual(codes(graphOf({ q1: { ...sqlSource, rows: null } })), []);
    const rows = { order_id: Array.from({ length: 10 }, (_, i) => i) };
    assert.deepEqual(codes(graphOf({ q1: { ...sqlSource, rows } })), []);
  });
});

describe("views, figures, insights", () => {
  it("needs `from` as a list of ids", () => {
    const noFrom = without(view, "from");
    assert.deepEqual(codes(graphOf({ v1: noFrom })), ["S4 error v1"]);
    assert.deepEqual(codes(graphOf({ v1: { ...view, from: "q1" } })), [
      "S4 error v1",
    ]);
  });

  it("C4: empty `from` is an error unless marked ungrounded", () => {
    assert.deepEqual(codes(graphOf({ v1: { ...view, from: [] } })), [
      "C4 error v1",
    ]);
    assert.deepEqual(
      codes(graphOf({ v1: { ...view, from: [], ungrounded: true } })),
      [],
    );
  });

  it("needs sql on a view, unless it is ungrounded", () => {
    const noSql = without(view, "sql");
    assert.deepEqual(codes(graphOf({ v1: noSql })), ["S4 error v1"]);
    assert.deepEqual(
      codes(graphOf({ v1: { ...noSql, from: [], ungrounded: true } })),
      [],
    );
  });

  it("flags an encoding with an unknown channel", () => {
    assert.deepEqual(
      codes(graphOf({ v1: { ...view, encoding: { x: "a", colour: "b" } } })),
      ["S4 error v1"],
    );
  });

  it("C9: a figure needs exactly one of sql and expr", () => {
    assert.deepEqual(codes(graphOf({ f1: { ...figure, expr: "f2 + 1" } })), [
      "C9 error f1",
    ]);
    const neither = without(figure, "sql");
    assert.deepEqual(codes(graphOf({ f1: neither })), ["C9 error f1"]);
  });

  it("lets an ungrounded figure have neither sql nor expr", () => {
    const neither = without(figure, "sql");
    assert.deepEqual(
      codes(graphOf({ f1: { ...neither, from: [], ungrounded: true } })),
      [],
    );
  });

  it("S8: an expression outside the language", () => {
    const base = without(figure, "sql");
    const issues = validateGraph(
      graphOf({ f1: { ...base, from: ["f2"], expr: "rank_of(f2)" } }),
    );
    assert.deepEqual(issues.map(key), ["S8 error f1"]);
    assert.match(issues[0].message, /unknown function `rank_of`/);
  });

  it("accepts a string value and a null value", () => {
    for (const value of ["paid_social", null]) {
      assert.deepEqual(codes(graphOf({ f1: { ...figure, value } })), []);
    }
  });

  it("flags a value that is neither number nor string", () => {
    assert.deepEqual(codes(graphOf({ f1: { ...figure, value: [1] } })), [
      "S4 error f1",
    ]);
  });

  it("warns on each missing descriptive field of a figure", () => {
    const bare = without(figure, "value", "display", "label");
    assert.deepEqual(codes(graphOf({ f1: bare })), [
      "S7 warning f1",
      "S7 warning f1",
      "S7 warning f1",
    ]);
  });

  it("needs text on an insight", () => {
    assert.deepEqual(
      codes(graphOf({ i1: { step: "insight", from: ["f1"], text: " " } })),
      ["S4 error i1"],
    );
  });

  it("messages name the node's step and the field", () => {
    const [issue] = validateGraph(
      graphOf({ i1: { step: "insight", from: ["f1"] } }),
    );
    assert.equal(issue.field, "text");
    assert.equal(issue.message, "insight is missing `text`");
  });
});
