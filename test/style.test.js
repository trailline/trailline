import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkSqlStyle, dateFunctions, maskSql } from "../src/sql/style.js";
import { readGraph } from "../src/graph/parse.js";
import { FIXTURE_NAMES, loadFixture } from "./helpers.js";

describe("maskSql", () => {
  it("blanks comments and string contents, keeping length and line breaks", () => {
    const sql = "select 'A--b' -- SELECT\nfrom t /* FROM */";
    assert.equal(
      maskSql(sql),
      "select '    '" + " ".repeat(10) + "\nfrom t" + " ".repeat(11),
    );
    assert.equal(
      maskSql(sql, { keepStrings: true }),
      "select 'A--b'" + " ".repeat(10) + "\nfrom t" + " ".repeat(11),
    );
  });

  it("blanks doubled quotes and quoted identifiers", () => {
    const sql = "select 'it''s', \"SELECT\"\nfrom t";
    assert.equal(maskSql(sql), "select '     ', \"      \"\nfrom t");
    assert.equal(
      maskSql(sql, { keepStrings: true }),
      "select 'it''s', \"      \"\nfrom t",
    );
  });
});

describe("dateFunctions", () => {
  it("lists each date function once, as first written, outside strings and comments", () => {
    const sql =
      "where d >= dateadd('day', -30, current_date) and e < CURRENT_DATE and f = 'now()' -- getdate()";
    assert.deepEqual(dateFunctions(sql), ["dateadd", "current_date"]);
  });
});

describe("checkSqlStyle", () => {
  it("rejects select *", () => {
    for (const sql of ["select\n    *\nfrom q1", "select\n    q1.*\nfrom q1"]) {
      assert.deepEqual(checkSqlStyle(sql, { parents: ["q1"] }), [
        { rule: "select-star", message: "uses select *; list the columns" },
      ]);
    }
  });

  it("reports its three rules in order: select *, date functions, parents", () => {
    const sql = "select\n    *\nfrom marts.orders\nwhere d >= current_date";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["q1"] }), [
      { rule: "select-star", message: "uses select *; list the columns" },
      {
        rule: "date-function",
        message: "use literal ISO dates, not date functions: current_date",
      },
      { rule: "parent-ref", message: "refer to parents by node id: q1" },
    ]);
  });

  it("does not count * in arithmetic, count(*), strings or comments", () => {
    const sql =
      "select\n    spend * 2 as doubled, -- not select *\n    count(*) as orders,\n    '*' as mark\nfrom v1";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["v1"] }), []);
  });

  it("ignores keyword case, layout, alias length and unnamed columns", () => {
    const a = "SELECT c.channel, c.cost_per_customer FROM v1 c ORDER BY 2 DESC";
    assert.deepEqual(checkSqlStyle(a, { parents: ["v1"] }), []);

    const b =
      "select channel, sum(spend)\nfrom q1 left join q2 on q2.channel = q1.channel";
    assert.deepEqual(checkSqlStyle(b, { parents: ["q1", "q2"] }), []);
  });

  it("does not treat words inside parentheses as clauses", () => {
    const sql =
      "select\n    rank() over (partition by channel order by retention desc) as retention_rank,\n    extract(month from cohort_month) as month_number\nfrom v1";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["v1"] }), []);
  });

  it("rejects date functions", () => {
    const sql =
      "select\n    channel\nfrom q1\nwhere day >= dateadd('day', -7, '2026-08-31')";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["q1"] }), [
      {
        rule: "date-function",
        message: "use literal ISO dates, not date functions: dateadd",
      },
    ]);
  });

  it("wants each parent named as a table", () => {
    const sql1 = "select\n    channel\nfrom marts.retention";
    const sql2 = "select\n    channel\nfrom v10";
    const issue = [
      {
        rule: "parent-ref",
        message: "refer to parents by node id: v1",
      },
    ];
    assert.deepEqual(checkSqlStyle(sql1, { parents: ["v1"] }), issue);
    assert.deepEqual(checkSqlStyle(sql2, { parents: ["v1"] }), issue);
  });

  it("does not throw on a parent id with regex-special characters", () => {
    const sql = "select\n    channel\nfrom v1";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["a("] }), [
      {
        rule: "parent-ref",
        message: "refer to parents by node id: a(",
      },
    ]);
  });
});

describe("checkSqlStyle on fixtures", () => {
  it("passes every fixture query but messy q2 and v2", () => {
    for (const name of FIXTURE_NAMES) {
      const { reportPath } = loadFixture(name);
      const { graph } = readGraph({ reportPath });
      for (const [id, node] of Object.entries(graph.nodes)) {
        if (typeof node?.sql !== "string") continue;
        if (name === "messy" && (id === "q2" || id === "v2")) continue;
        const parents = node.step === "source" ? [] : (node.from ?? []);
        assert.deepEqual(
          checkSqlStyle(node.sql, { parents }),
          [],
          `${name}/${id}`,
        );
      }
    }
  });

  it("messy q2 only uses date functions", () => {
    const { reportPath } = loadFixture("messy");
    const { graph } = readGraph({ reportPath });
    assert.deepEqual(checkSqlStyle(graph.nodes.q2.sql, { parents: [] }), [
      {
        rule: "date-function",
        message:
          "use literal ISO dates, not date functions: dateadd, current_date",
      },
    ]);
  });

  it("messy v2 only uses select *", () => {
    const { reportPath } = loadFixture("messy");
    const { graph } = readGraph({ reportPath });
    assert.deepEqual(
      checkSqlStyle(graph.nodes.v2.sql, { parents: graph.nodes.v2.from }),
      [
        {
          rule: "select-star",
          message: "uses select *; list the columns",
        },
      ],
    );
  });
});
