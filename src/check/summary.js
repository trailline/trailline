/**
 * The check summary: counts, what needs attention, and its printed form.
 * Pure: no file I/O, no printing.
 */

import { traceGraph } from "../graph/trace.js";

/** `[id, node]` pairs in graph order; none when the graph has no readable `nodes`. */
const nodeEntries = (graph) =>
  graph !== null &&
  typeof graph === "object" &&
  graph.nodes !== null &&
  typeof graph.nodes === "object" &&
  !Array.isArray(graph.nodes)
    ? Object.entries(graph.nodes)
    : [];

/** The node's `text`, else its `label`; only strings count. */
const describe = (node) =>
  [node.text, node.label].find((value) => typeof value === "string") ?? null;

/**
 * @param {unknown} graph
 * @param {{ bindings: { id: string }[] }} page
 * @param {object[]} issues
 * @param {{ report: string }} options
 */
export function summarize(graph, page, issues, { report }) {
  const counts = {
    sources: { total: 0, external: 0 },
    views: { total: 0, shown: 0 },
    figures: { total: 0, full: 0, partial: 0, ungrounded: 0 },
    insights: { total: 0, full: 0, partial: 0, ungrounded: 0 },
  };
  const ungrounded = [];
  const external = [];
  const states = traceGraph(graph);
  const bound = new Set(page.bindings.map((binding) => binding.id));
  for (const [id, node] of nodeEntries(graph)) {
    if (!states.has(id)) continue;
    if (node.ungrounded === true) {
      ungrounded.push({ node: id, text: describe(node) });
    }
    if (node.step === "view") {
      counts.views.total += 1;
      if (bound.has(id)) counts.views.shown += 1;
    }
    if (node.step === "figure" || node.step === "insight") {
      const tally = counts[`${node.step}s`];
      tally.total += 1;
      tally[states.get(id)] += 1;
    }
    if (node.step === "source") {
      counts.sources.total += 1;
      if (node.kind === "external") {
        counts.sources.external += 1;
        external.push({
          node: id,
          ref: typeof node.ref === "string" ? node.ref : null,
        });
      }
    }
  }
  return { report, counts, ungrounded, external, issues };
}

/** One count line: label padded to 11, count padded to 4, then the detail. */
const countLine = (label, total, detail) =>
  `  ${label.padEnd(11)}${String(total).padEnd(4)}${detail}`.trimEnd();

const tracedDetail = ({ total, full, partial, ungrounded }) => {
  if (total > 0 && full === total) return "all fully traced";
  return [
    [full, "fully traced"],
    [partial, "partially traced"],
    [ungrounded, "ungrounded"],
  ]
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}`)
    .join(", ");
};

const shownDetail = ({ total, shown }) => {
  if (total === 0) return "";
  if (shown === total) return "all shown on the page";
  return `${shown} shown, ${total - shown} not on the page`;
};

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const shorten = (text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 40 ? flat : `${flat.slice(0, 40).trimEnd()}…`;
};

/**
 * @param {object} summary
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
export function formatSummary(summary, { color = false } = {}) {
  const { sources, views, figures, insights } = summary.counts;
  const colour = (text, paint) => (color ? `${paint}${text}${RESET}` : text);
  const lines = [
    summary.report,
    "",
    countLine(
      "sources",
      sources.total,
      sources.external > 0 ? `(${sources.external} external)` : "",
    ),
    countLine("views", views.total, shownDetail(views)),
    countLine("figures", figures.total, tracedDetail(figures)),
    countLine("insights", insights.total, tracedDetail(insights)),
  ];
  const rows = summary.ungrounded.map(({ node, text }) => ({
    node,
    tag: "ungrounded",
    paint: YELLOW,
    detail: text === null ? "" : `"${shorten(text)}"`,
  }));
  for (const { node, ref } of summary.external) {
    const ask = "a reader will be asked to confirm this with you";
    rows.push({
      node,
      tag: "external",
      paint: YELLOW,
      detail: ref === null ? ask : `${ref} — ${ask}`,
    });
  }
  for (const severity of ["warning", "error"]) {
    for (const issue of summary.issues) {
      if (issue.severity !== severity) continue;
      rows.push({
        node: issue.node ?? "graph",
        tag: `${issue.code} ${severity}`,
        paint: severity === "error" ? RED : YELLOW,
        detail: issue.message,
      });
    }
  }
  if (rows.length > 0) {
    const width = Math.max(5, ...rows.map((row) => row.node.length + 3));
    lines.push("", "  needs attention");
    for (const { node, tag, paint, detail } of rows) {
      lines.push(
        `    ${node.padEnd(width)}${colour(tag, paint)}${" ".repeat(13 - tag.length)}${detail}`.trimEnd(),
      );
    }
  }
  return lines.join("\n");
}
