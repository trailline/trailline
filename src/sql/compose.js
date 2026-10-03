/**
 * Compose a lineage graph into one SQL script. Pure: no file I/O.
 */

import { exprRefs, parseExpr } from "../graph/expr.js";
import { traceGraph } from "../graph/trace.js";

const quote = (text) => `'${text.replaceAll("'", "''")}'`;

/** A recorded value as a SQL literal: number as written, string quoted, else null. */
const literal = (value) => {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return quote(value);
  return "null";
};

/** The node's SQL as written, minus outer whitespace and one final `;`, indented. */
const indent = (sql) =>
  sql
    .trim()
    .replace(/\s*;$/, "")
    .replace(/^(?=.)/gm, "    ");

/** An expression compiler that reads figures from `nodes`. */
function compiler(nodes) {
  // An operation inside another is wrapped; a negation inside a negation too,
  // so `--` never appears (it would start a SQL comment).
  const wrapped = (tree) =>
    tree.type === "binary" || tree.type === "neg"
      ? `(${compile(tree)})`
      : compile(tree);

  function compile(tree) {
    if (tree.type === "ref") {
      const { expr } = nodes[tree.id];
      return expr
        ? `(${compile(parseExpr(expr))})`
        : `(select value from ${tree.id})`;
    }
    if (tree.type === "number") return String(tree.value);
    if (tree.type === "call") {
      return `${tree.name}(${tree.args.map(compile).join(", ")})`;
    }
    if (tree.type === "neg") return `-${wrapped(tree.arg)}`;
    return `${wrapped(tree.left)} ${tree.op} ${wrapped(tree.right)}`;
  }
  return compile;
}

/**
 * @param {object} graph a graph with no error-severity issues
 * @param {{ report: string }} options `report` is the file name for the header
 * @returns {string} the script, with no trailing newline
 */
export function composeSql(graph, { report }) {
  const entries = Object.entries(graph.nodes);
  const figures = entries.filter(([, node]) => node.step === "figure");
  if (figures.length === 0) {
    return `-- ${report}\n-- no figures, so there is nothing to compose`;
  }
  const compile = compiler(graph.nodes);
  const states = traceGraph(graph);
  const ofStep = (step) => entries.filter(([, node]) => node.step === step);
  const views = [];
  const visit = ([id, node]) => {
    if (views.some(([seen]) => seen === id)) return;
    for (const parent of node.from) {
      if (graph.nodes[parent].step === "view") {
        visit([parent, graph.nodes[parent]]);
      }
    }
    views.push([id, node]);
  };
  ofStep("view")
    .filter(([id]) => states.get(id) === "full")
    .forEach(visit);
  const sqlSources = ofStep("source").filter(([, node]) => node.kind === "sql");
  const ctes = [...sqlSources, ...views].map(
    ([id, node]) => `${id} as (\n${indent(node.sql)}\n)`,
  );
  // External sources anywhere below a node, in graph order.
  const externalsBelow = (id) => {
    const below = new Set();
    const walk = (parent) => {
      if (graph.nodes[parent].kind === "external") below.add(parent);
      (graph.nodes[parent].from ?? []).forEach(walk);
    };
    walk(id);
    return entries.map(([other]) => other).filter((other) => below.has(other));
  };
  // A sql figure with no CTE cannot be read: its value is null.
  const unread = new Set();
  for (const [id, node] of figures.filter(([, node]) => node.sql)) {
    const externals = externalsBelow(id);
    if (states.get(id) === "full") {
      ctes.push(`${id} (value) as (\n${indent(node.sql)}\n)`);
    } else if (externals.length > 0 && !node.ungrounded) {
      ctes.push(
        `${id} (value) as (\n    -- from the report: rests on external ${externals.join(", ")}\n    select ${literal(node.value)}\n)`,
      );
    } else {
      unread.add(id);
    }
  }
  const isNull = (id) =>
    graph.nodes[id].ungrounded === true ||
    unread.has(id) ||
    (graph.nodes[id].expr !== undefined &&
      exprRefs(graph.nodes[id].expr).some(isNull));
  const rows = figures.map(([id, node], i) => {
    const reading = node.expr
      ? compile(parseExpr(node.expr))
      : `(select value from ${id})`;
    const [figure, label, value] = [
      `'${id}'`,
      node.label === undefined ? "null" : quote(node.label),
      isNull(id) ? "null" : `cast(${reading} as varchar)`,
    ];
    return i === 0
      ? `select ${figure} as figure, ${label} as label, ${value} as value`
      : `select ${figure}, ${label}, ${value}`;
  });
  const oneLine = (text) => text.replace(/\s+/g, " ").trim();
  const notCovered = entries.flatMap(([id, node]) => {
    if (node.kind === "external") {
      return [`-- ${id} external: ${oneLine(node.ref)}`];
    }
    if (node.ungrounded) {
      const text = oneLine(node.text ?? node.label ?? "");
      return [text ? `-- ${id} ungrounded: ${text}` : `-- ${id} ungrounded`];
    }
    return [];
  });
  const tail =
    notCovered.length > 0
      ? `\n\n-- not covered by this script:\n${notCovered.join("\n")}`
      : "";
  const withClause = ctes.length > 0 ? `with\n${ctes.join(",\n")}\n` : "";
  return `-- ${report}\n${withClause}${rows.join("\nunion all\n")}${tail}`;
}
