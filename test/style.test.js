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

  it("wants lowercase keywords, ignoring strings", () => {
    const sql = "select\n    channel\nFrom q1\nwhere channel = 'SELECT'";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["q1"] }), [
      {
        rule: "lowercase",
        message: "keywords must be lowercase: From",
      },
    ]);
  });

  it("wants each clause on its own line", () => {
    const sql = "select\n    channel\nfrom q1 where channel = 'x'";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["q1"] }), [
      {
        rule: "clause-per-line",
        message: "each clause starts its own line: where",
      },
    ]);
  });

  it("does not treat words inside parentheses as clauses", () => {
    const sql =
      "select\n    rank() over (partition by channel order by retention desc) as retention_rank,\n    extract(month from cohort_month) as month_number\nfrom v1";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["v1"] }), []);
  });

  it("lets a join keep its modifiers on its line", () => {
    const good =
      "select\n    q1.channel\nfrom q1\nleft join q2\n    on q2.channel = q1.channel";
    assert.deepEqual(checkSqlStyle(good, { parents: ["q1", "q2"] }), []);

    const bad =
      "select\n    q1.channel\nfrom q1 left join q2 on q2.channel = q1.channel";
    assert.deepEqual(checkSqlStyle(bad, { parents: ["q1", "q2"] }), [
      {
        rule: "clause-per-line",
        message: "each clause starts its own line: join",
      },
    ]);
  });

  it("wants selected columns one per line, indented", () => {
    const bad1 = "select channel, retention\nfrom v1";
    const bad2 = "select\n    channel,\nretention\nfrom v1";
    const good = "select retention\nfrom v1";
    const issue = [
      {
        rule: "column-per-line",
        message: "put each selected column on its own line, indented",
      },
    ];
    assert.deepEqual(checkSqlStyle(bad1, { parents: ["v1"] }), issue);
    assert.deepEqual(checkSqlStyle(bad2, { parents: ["v1"] }), issue);
    assert.deepEqual(checkSqlStyle(good, { parents: ["v1"] }), []);
  });

  it("wants computed columns named with as", () => {
    const sql =
      "select\n    channel,\n    avg(retention_30d),\n    sum(spend)   total\nfrom q1\ngroup by channel";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["q1"] }), [
      {
        rule: "unnamed-column",
        message:
          "name each computed column with `as`: avg(retention_30d), sum(spend) total",
      },
    ]);
  });

  it("rejects aliases shorter than three characters", () => {
    const sql =
      "select\n    r.channel,\n    count(r.id) as n\nfrom q1 as r\njoin q2 rc\n    on rc.channel = r.channel";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["q1", "q2"] }), [
      {
        rule: "short-alias",
        message: "aliases need at least 3 characters: n, r, rc",
      },
    ]);
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

  it("lets a full outer join or natural left join keep its modifiers on its line", () => {
    for (const [modifiers, join] of [
      ["left outer", "left outer join"],
      ["full outer", "full outer join"],
      ["natural left", "natural left join"],
    ]) {
      const good = `select\n    q1.channel\nfrom q1\n${join} q2\n    on q2.channel = q1.channel`;
      assert.deepEqual(
        checkSqlStyle(good, { parents: ["q1", "q2"] }),
        [],
        modifiers,
      );
    }
  });

  it("reads select-list layout from the masked code, not comments", () => {
    const sql = "select\n    a, -- the key\n    b -- other\nfrom v1";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["v1"] }), []);
  });

  it("wants selected columns one per line, indented, on CRLF SQL", () => {
    const sql = "select\r\n    a,\r\n    b\r\nfrom v1";
    assert.deepEqual(checkSqlStyle(sql, { parents: ["v1"] }), []);
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

  it("messy v2 breaks four rules, in rule order", () => {
    const { reportPath } = loadFixture("messy");
    const { graph } = readGraph({ reportPath });
    assert.deepEqual(
      checkSqlStyle(graph.nodes.v2.sql, { parents: graph.nodes.v2.from }),
      [
        {
          rule: "lowercase",
          message: "keywords must be lowercase: SELECT, FROM, ORDER, BY, DESC",
        },
        {
          rule: "clause-per-line",
          message: "each clause starts its own line: FROM, ORDER BY",
        },
        {
          rule: "column-per-line",
          message: "put each selected column on its own line, indented",
        },
        {
          rule: "short-alias",
          message: "aliases need at least 3 characters: c",
        },
      ],
    );
  });
});
