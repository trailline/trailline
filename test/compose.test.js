import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readGraph } from "../src/graph/parse.js";
import { composeSql } from "../src/sql/compose.js";
import { CLEAN_SQL, loadFixture, MESSY_SQL } from "./helpers.js";

const G = (nodes) => ({ trailline: "1.0", nodes });
const compose = (graph) => composeSql(graph, { report: "r.html" });
const q1 = { step: "source", kind: "sql", sql: "select amount from sales" };
const fig = (from, sql, label) => ({
  step: "figure",
  from: [from],
  sql,
  label,
});
const f1 = fig("q1", "select amount from q1", "Sales");

const HEAD = "-- r.html\nwith\nq1 as (\n    select amount from sales\n)";
const F1_CTE = "f1 (value) as (\n    select amount from q1\n)";
const F1_ROW =
  "select 'f1' as figure, 'Sales' as label, cast((select value from f1) as varchar) as value";
const F2_CTE = "f2 (value) as (\n    select count(amount) from q1\n)";
const F2_ROW = "select 'f2', 'Orders', cast((select value from f2) as varchar)";
const f2 = fig("q1", "select count(amount) from q1", "Orders");
const calc = (expr, label = "Calc") => ({
  step: "figure",
  from: ["f1", "f2"],
  expr,
  label,
});
const x1 = {
  step: "source",
  kind: "external",
  type: "csv",
  ref: "targets.csv",
  given: "Q3 targets",
};
const NOT_COVERED = "\n\n-- not covered by this script:";
const X1_LINE = "\n-- x1 external: targets.csv";
const fx = (from, value, label = "Target") => ({
  step: "figure",
  from: [from],
  sql: `select target from ${from}`,
  value,
  display: String(value),
  label,
});
const loose = (extra) => ({
  step: "figure",
  from: [],
  ungrounded: true,
  ...extra,
});
const ONE = `${HEAD},\n${F1_CTE}\n${F1_ROW}`;
const TWO = `${HEAD},\n${F1_CTE},\n${F2_CTE}\n${F1_ROW}\nunion all\n${F2_ROW}`;

describe("composeSql", () => {
  it("says there is nothing to compose for an empty graph", () => {
    assert.equal(
      compose(G({})),
      "-- r.html\n-- no figures, so there is nothing to compose",
    );
  });

  it("composes one source and one figure", () => {
    assert.equal(compose(G({ q1, f1 })), ONE);
  });

  it("adds a union all row per figure, naming the columns only once", () => {
    assert.equal(compose(G({ q1, f1, f2 })), TWO);
  });

  it("leaves out the with clause when there are sources but no figures", () => {
    assert.equal(
      compose(G({ q1 })),
      "-- r.html\n-- no figures, so there is nothing to compose",
    );
  });
});

const v1 = {
  step: "view",
  from: ["q1"],
  sql: "select amount from q1 where amount > 0",
};
const V1_CTE = "v1 as (\n    select amount from q1 where amount > 0\n)";

describe("CTE order", () => {
  it("puts a view between its source and the figures", () => {
    assert.equal(
      compose(
        G({ q1, v1, f1: fig("v1", "select sum(amount) from v1", "Sales") }),
      ),
      `${HEAD},\n${V1_CTE},\nf1 (value) as (\n    select sum(amount) from v1\n)\n${F1_ROW}`,
    );
  });

  it("puts sources, then views, then figures, whatever the graph order", () => {
    assert.equal(
      compose(
        G({ f1: fig("v1", "select sum(amount) from v1", "Sales"), v1, q1 }),
      ),
      `${HEAD},\n${V1_CTE},\nf1 (value) as (\n    select sum(amount) from v1\n)\n${F1_ROW}`,
    );
  });

  it("puts a view over a view after the view it reads", () => {
    const v2 = { step: "view", from: ["v1"], sql: "select amount from v1" };
    assert.equal(
      compose(
        G({
          v2,
          v1,
          q1,
          f1: fig("v2", "select sum(amount) from v2", "Sales"),
        }),
      ),
      `${HEAD},\n${V1_CTE},\nv2 as (\n    select amount from v1\n),\nf1 (value) as (\n    select sum(amount) from v2\n)\n${F1_ROW}`,
    );
  });
});

describe("CTE bodies", () => {
  it("indents every line of the node's SQL and leaves blank lines empty", () => {
    assert.equal(
      compose(
        G({
          q1: { ...q1, sql: "-- sales\nselect\n    amount\n\nfrom sales" },
          f1,
        }),
      ),
      `-- r.html\nwith\nq1 as (\n    -- sales\n    select\n        amount\n\n    from sales\n),\n${F1_CTE}\n${F1_ROW}`,
    );
  });

  it("drops surrounding whitespace and a trailing semicolon", () => {
    assert.equal(
      compose(
        G({ q1: { ...q1, sql: "\n  select amount from sales;\n\n" }, f1 }),
      ),
      ONE,
    );
  });
});

describe("expressions", () => {
  it("compiles an expression from its tree, reading each figure through a subquery", () => {
    assert.equal(
      compose(G({ q1, f1, f2, f3: calc("(f1-f2)/f2", "Change") })),
      `${TWO}\nunion all\nselect 'f3', 'Change', cast(((select value from f1) - (select value from f2)) / (select value from f2) as varchar)`,
    );
  });

  it("keeps precedence by wrapping every operation inside another", () => {
    assert.equal(
      compose(
        G({ q1, f1, f2, f3: calc("f1 + f2 * f1"), f4: calc("f1 - f2 - f1") }),
      ),
      `${TWO}\nunion all\nselect 'f3', 'Calc', cast((select value from f1) + ((select value from f2) * (select value from f1)) as varchar)\nunion all\nselect 'f4', 'Calc', cast(((select value from f1) - (select value from f2)) - (select value from f1) as varchar)`,
    );
  });

  it("compiles number literals, abs and round", () => {
    assert.equal(
      compose(
        G({
          q1,
          f1,
          f2,
          f3: calc("round(abs(f1 - f2) * 100, 1)"),
          f4: calc("f1 * .5"),
        }),
      ),
      `${TWO}\nunion all\nselect 'f3', 'Calc', cast(round(abs((select value from f1) - (select value from f2)) * 100, 1) as varchar)\nunion all\nselect 'f4', 'Calc', cast((select value from f1) * 0.5 as varchar)`,
    );
  });

  it("compiles negation", () => {
    assert.equal(
      compose(G({ q1, f1, f2, f3: calc("-f1"), f4: calc("-(f1 + f2)") })),
      `${TWO}\nunion all\nselect 'f3', 'Calc', cast(-(select value from f1) as varchar)\nunion all\nselect 'f4', 'Calc', cast(-((select value from f1) + (select value from f2)) as varchar)`,
    );
  });

  it("never writes two minus signs together, which would start a comment", () => {
    assert.equal(
      compose(G({ q1, f1, f2, f3: calc("- -f1") })),
      `${TWO}\nunion all\nselect 'f3', 'Calc', cast(-(-(select value from f1)) as varchar)`,
    );
  });

  it("inlines an expression figure used by another expression", () => {
    assert.equal(
      compose(
        G({
          q1,
          f1,
          f2,
          f3: calc("f1 - f2"),
          f4: { step: "figure", from: ["f3"], expr: "f3 * 2", label: "Calc" },
        }),
      ),
      `${TWO}\nunion all\nselect 'f3', 'Calc', cast((select value from f1) - (select value from f2) as varchar)\nunion all\nselect 'f4', 'Calc', cast(((select value from f1) - (select value from f2)) * 2 as varchar)`,
    );
  });
});

describe("labels", () => {
  it("doubles a single quote in a label", () => {
    assert.equal(
      compose(
        G({ q1, f1: fig("q1", "select amount from q1", "Paid social's rank") }),
      ),
      ONE.replace("'Sales'", "'Paid social''s rank'"),
    );
  });

  it("writes null for a figure with no label", () => {
    assert.equal(
      compose(
        G({
          q1,
          f1: { step: "figure", from: ["q1"], sql: "select amount from q1" },
        }),
      ),
      ONE.replace("'Sales'", "null"),
    );
  });
});

describe("not covered", () => {
  it("lists an external source in a trailing comment", () => {
    assert.equal(compose(G({ q1, f1, x1 })), ONE + NOT_COVERED + X1_LINE);
  });
});

describe("external", () => {
  const F2_EXT = (select, from = "x1") =>
    `f2 (value) as (\n    -- from the report: rests on external ${from}\n    select ${select}\n)`;
  const F2_ROW_EXT =
    "select 'f2', 'Target', cast((select value from f2) as varchar)";

  it("gives a figure over an external source a CTE holding its recorded value", () => {
    assert.equal(
      compose(G({ q1, f1, x1, f2: fx("x1", 0.5) })),
      `${HEAD},\n${F1_CTE},\n${F2_EXT("0.5")}\n${F1_ROW}\nunion all\n${F2_ROW_EXT}${NOT_COVERED}${X1_LINE}`,
    );
  });

  it("hardcodes a string value as a quoted literal", () => {
    assert.equal(
      compose(G({ q1, f1, x1, f2: fx("x1", "Paid social's") })),
      `${HEAD},\n${F1_CTE},\n${F2_EXT("'Paid social''s'")}\n${F1_ROW}\nunion all\n${F2_ROW_EXT}${NOT_COVERED}${X1_LINE}`,
    );
  });

  it("hardcodes null when the figure has no recorded value", () => {
    assert.equal(
      compose(
        G({
          q1,
          f1,
          x1,
          f2: {
            step: "figure",
            from: ["x1"],
            sql: "select target from x1",
            label: "Target",
          },
        }),
      ),
      `${HEAD},\n${F1_CTE},\n${F2_EXT("null")}\n${F1_ROW}\nunion all\n${F2_ROW_EXT}${NOT_COVERED}${X1_LINE}`,
    );
  });

  it("drops a view over an external source and still computes expressions over the figure", () => {
    assert.equal(
      compose(
        G({
          q1,
          f1,
          x1,
          v1: { step: "view", from: ["x1"], sql: "select target from x1" },
          f2: fx("v1", 0.5),
          f3: calc("f1 - f2"),
        }),
      ),
      `${HEAD},\n${F1_CTE},\n${F2_EXT("0.5")}\n${F1_ROW}\nunion all\n${F2_ROW_EXT}\nunion all\nselect 'f3', 'Calc', cast((select value from f1) - (select value from f2) as varchar)${NOT_COVERED}${X1_LINE}`,
    );
  });

  it("names every external source below the figure, even when it also reads the warehouse", () => {
    const x2 = { ...x1, ref: "benchmarks.csv" };
    assert.equal(
      compose(
        G({
          q1,
          f1,
          x1,
          x2,
          v1: {
            step: "view",
            from: ["q1", "x1", "x2"],
            sql: "select target from x1",
          },
          f2: fx("v1", 0.5),
        }),
      ),
      `${HEAD},\n${F1_CTE},\n${F2_EXT("0.5", "x1, x2")}\n${F1_ROW}\nunion all\n${F2_ROW_EXT}${NOT_COVERED}${X1_LINE}\n-- x2 external: benchmarks.csv`,
    );
  });
});

describe("not covered", () => {
  it("lists an external source's ref on one line", () => {
    assert.equal(
      compose(G({ q1, f1, x1: { ...x1, ref: "a.csv\nselect 1" } })),
      `${ONE}${NOT_COVERED}\n-- x1 external: a.csv select 1`,
    );
  });

  it("lists an external source with no ref by id alone", () => {
    assert.equal(
      compose(G({ q1, f1, x1: { ...x1, ref: undefined } })),
      `${ONE}${NOT_COVERED}\n-- x1 external`,
    );
  });

  it("writes the report name in the header on one line", () => {
    assert.equal(
      composeSql(G({ q1, f1 }), { report: "r\nselect 1.html" }),
      ONE.replace("-- r.html", "-- r select 1.html"),
    );
  });

  it("lists an ungrounded insight with its text on one line", () => {
    assert.equal(
      compose(
        G({
          q1,
          f1,
          i1: {
            step: "insight",
            from: [],
            ungrounded: true,
            text: "Benchmarks sit\n  around 35%.",
          },
        }),
      ),
      `${ONE}${NOT_COVERED}\n-- i1 ungrounded: Benchmarks sit around 35%.`,
    );
  });

  it("gives an ungrounded figure a null value and lists it by label", () => {
    assert.equal(
      compose(
        G({
          q1,
          f1,
          f2: loose({ value: 0.35, display: "35%", label: "Benchmark" }),
        }),
      ),
      `${ONE}\nunion all\nselect 'f2', 'Benchmark', null${NOT_COVERED}\n-- f2 ungrounded: Benchmark`,
    );
  });

  it("lists an ungrounded node with no text or label by id alone", () => {
    assert.equal(
      compose(G({ q1, f1, f2: loose({ value: 0.35 }) })),
      `${ONE}\nunion all\nselect 'f2', null, null${NOT_COVERED}\n-- f2 ungrounded`,
    );
  });

  it("gives an expression over an ungrounded figure a null value", () => {
    assert.equal(
      compose(
        G({
          q1,
          f1,
          f2: loose({ value: 0.35, label: "Benchmark" }),
          f3: calc("f1 - f2"),
        }),
      ),
      `${ONE}\nunion all\nselect 'f2', 'Benchmark', null\nunion all\nselect 'f3', 'Calc', null${NOT_COVERED}\n-- f2 ungrounded: Benchmark`,
    );
  });

  it("never hardcodes an ungrounded figure, even one that has sql", () => {
    assert.equal(
      compose(
        G({
          q1,
          f1,
          f2: loose({
            sql: "select 7",
            value: 7,
            label: "Benchmark",
          }),
        }),
      ),
      `${ONE}\nunion all\nselect 'f2', 'Benchmark', null${NOT_COVERED}\n-- f2 ungrounded: Benchmark`,
    );
  });

  it("leaves a figure over an ungrounded view null, with no CTE", () => {
    assert.equal(
      compose(
        G({
          q1,
          f1,
          v9: { step: "view", from: [], ungrounded: true, sql: "select 7" },
          f2: { ...fig("v9", "select 7 from v9", "Seven"), value: 7 },
          f3: calc("f1 - f2"),
        }),
      ),
      `${ONE}\nunion all\nselect 'f2', 'Seven', null\nunion all\nselect 'f3', 'Calc', null${NOT_COVERED}\n-- v9 ungrounded`,
    );
  });

  it("leaves out the with clause when no figure has a CTE", () => {
    assert.equal(
      compose(G({ f1: loose({ value: 0.35, label: "Benchmark" }) })),
      `-- r.html\nselect 'f1' as figure, 'Benchmark' as label, null as value${NOT_COVERED}\n-- f1 ungrounded: Benchmark`,
    );
  });
});

describe("fixtures", () => {
  it("composes clean", () => {
    const { graph } = readGraph({
      reportPath: loadFixture("clean").reportPath,
    });
    assert.equal(
      composeSql(graph, { report: "august-retention.html" }),
      CLEAN_SQL,
    );
  });

  it("composes messy", () => {
    const { graph } = readGraph({
      reportPath: loadFixture("messy").reportPath,
    });
    assert.equal(
      composeSql(graph, { report: "paid-search-costs.html" }),
      MESSY_SQL,
    );
  });
});
