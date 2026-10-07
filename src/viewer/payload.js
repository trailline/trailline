/**
 * Everything the viewer panel shows for one report, in one object. Reads files
 * and nothing else: no subprocess, no writes.
 */

import { basename } from "node:path";

import { checkRules } from "../check/rules.js";
import { summarize } from "../check/summary.js";
import { readGraph, readText } from "../graph/parse.js";
import { validateGraph } from "../graph/schema.js";
import { traceGraph } from "../graph/trace.js";
import { proseSkip, readPage } from "../html/page.js";
import { composeSql, isEmptyScript, refusal } from "../sql/compose.js";

/**
 * @param {{ reportPath: string, graphPath?: string }} options as `readGraph`
 * @returns {object} the report name and HTML, its graph, trace states, check
 *   summary and composed SQL
 */
export function buildPayload({ reportPath, graphPath }) {
  const { graph } = readGraph({ reportPath, graphPath });
  const html = readText(reportPath, "report");
  const page = readPage(html, { skip: proseSkip(graph) });
  const issues = [...validateGraph(graph), ...checkRules(graph, page)];
  const report = basename(reportPath);
  const refused = issues.some((issue) => issue.severity === "error")
    ? refusal(report)
    : null;
  const ids = refused === null ? Object.keys(graph.nodes) : [];
  return {
    report,
    html,
    graph,
    trace: Object.fromEntries(traceGraph(graph)),
    summary: summarize(graph, page, issues, { report }),
    composedReport: refused === null ? composeSql(graph, { report }) : null,
    composed: Object.fromEntries(
      ids
        .map((id) => [id, composeSql(graph, { report, id })])
        .filter(([, script]) => !isEmptyScript(script)),
    ),
    refused,
  };
}
