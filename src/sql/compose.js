/**
 * Compose a lineage graph into one SQL script. Pure: no file I/O.
 */

import { exprRefs, parseExpr } from "../graph/expr.js";
import { traceGraph } from "../graph/trace.js";

/** Text collapsed to one line, so it cannot end a `--` comment early. */
const oneLine = (text) => text.replace(/\s+/g, " ").trim();

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

/** Why a report that fails `check` gets no script. */
export const refusal = (report) =>
  `${report} does not pass \`trailline check\`, so no script was composed`;

const NOTHING = ", so there is nothing to compose";

/** Whether `script`, from `composeSql`, says there was nothing to compose. */
export const isEmptyScript = (script) =>
  script.split("\n")[1].endsWith(NOTHING);

/**
 * @param {object} graph a graph with no error-severity issues
 * @param {{ report: string, id?: string }} options `report` is the file name
 *   for the header; `id` limits the script to that node and what is below it
 * @returns {string} the script, with no trailing newline
 */
export function composeSql(graph, options) {
  const report = oneLine(options.report);
  const header =
    options.id === undefined ? report : `${report} (${options.id})`;
  // The node and everything below it through `from`; the whole graph without an id.
  const scope = new Set();
  const collect = (id) => {
    if (scope.has(id)) return;
    scope.add(id);
    (graph.nodes[id].from ?? []).forEach(collect);
  };
  if (options.id === undefined) Object.keys(graph.nodes).forEach(collect);
  else collect(options.id);
  const entries = Object.entries(graph.nodes).filter(([id]) => scope.has(id));
  const figures = entries.filter(([, node]) => node.step === "figure");
  // A sql source whose query was never recorded cannot run.
  const noSql = (node) =>
    node.step === "source" && node.kind === "sql" && node.sql === undefined;
  const notCovered = entries.flatMap(([id, node]) => {
    if (noSql(node)) return [`-- ${id} has no sql`];
    if (node.kind === "external") {
      const ref = oneLine(node.ref ?? "");
      return [ref ? `-- ${id} external: ${ref}` : `-- ${id} external`];
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
  // Sources anywhere below a node that pass `test`, in graph order.
  const sourcesBelow = (id, test) => {
    const below = new Set();
    const walk = (parent) => {
      if (test(graph.nodes[parent])) below.add(parent);
      (graph.nodes[parent].from ?? []).forEach(walk);
    };
    walk(id);
    return entries.map(([other]) => other).filter((other) => below.has(other));
  };
  const externalsBelow = (id) =>
    sourcesBelow(id, (node) => node.kind === "external");
  const states = traceGraph(graph);
  const runs = (id) =>
    states.get(id) === "full" && sourcesBelow(id, noSql).length === 0;
  const target = graph.nodes[options.id];
  // A source or view with SQL to run ends in a select of itself.
  const selectsTarget =
    (target?.step === "source" || target?.step === "view") && runs(options.id);
  if (figures.length === 0 && !selectsTarget) {
    const { id } = options;
    const externals = id === undefined ? [] : externalsBelow(id);
    const ungrounded = entries
      .filter(([, node]) => node.ungrounded)
      .map(([other]) => other);
    const missing = id === undefined ? [] : sourcesBelow(id, noSql);
    const ref = oneLine(target?.ref ?? "");
    let why = `${id} rests on no figures`;
    if (id === undefined) why = "no figures";
    else if (target.kind === "external") {
      why = ref ? `${id} is external (${ref})` : `${id} is external`;
    } else if (target.ungrounded) why = `${id} is ungrounded`;
    else if (noSql(target)) why = `${id} has no sql`;
    else if (externals.length > 0) {
      why = `${id} rests on external ${externals.join(", ")}`;
    } else if (missing.length > 0) {
      why = `${id} rests on ${missing.join(", ")}, which ${missing.length > 1 ? "have" : "has"} no sql`;
    } else if (ungrounded.length > 0) {
      why = `${id} rests on ungrounded ${ungrounded.join(", ")}`;
    }
    return `-- ${header}\n-- ${why}${NOTHING}${tail}`;
  }
  const compile = compiler(graph.nodes);
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
    .filter(([id]) => runs(id))
    .forEach(visit);
  const sqlSources = ofStep("source").filter(([id]) => runs(id));
  const ctes = [...sqlSources, ...views].map(
    ([id, node]) => `${id} as (\n${indent(node.sql)}\n)`,
  );
  // A sql figure with no CTE cannot be read: its value is null.
  const unread = new Set();
  for (const [id, node] of figures.filter(([, node]) => node.sql)) {
    const externals = externalsBelow(id);
    if (runs(id)) {
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
  const final = selectsTarget
    ? `select * from ${options.id}`
    : rows.join("\nunion all\n");
  const withClause = ctes.length > 0 ? `with\n${ctes.join(",\n")}\n` : "";
  return `-- ${header}\n${withClause}${final}${tail}`;
}
