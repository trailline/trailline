import { basename } from "node:path";

import { checkRules } from "../check/rules.js";
import { formatSummary, summarize } from "../check/summary.js";
import { UsageError } from "../errors.js";
import { readGraph, readText } from "../graph/parse.js";
import { validateGraph } from "../graph/schema.js";
import { embedFile } from "../html/embed.js";
import { proseSkip, readPage } from "../html/page.js";

export const name = "check";
export const summary = "Validate a report's lineage and embed the graph";

export const usage = `trailline check <report.html> [options]

Reads the lineage graph beside the report, checks it against the report's
data-trailline bindings, embeds it into the HTML, and prints a summary.

Exit code is 0 when the report passes (warnings still pass) and 1 when it
does not.

Options
  --graph <path>   Graph JSON to read (default: .trailline/<report>.json
                   beside the report, or else the block already embedded
                   in it)
  --no-embed       Check only; leave the report file untouched
  --json           Print the summary as JSON instead of prose
  --quiet          Print nothing; rely on the exit code
  -h, --help       Show this help`;

export const options = {
  graph: { type: "string" },
  "no-embed": { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  quiet: { type: "boolean", default: false },
};

export async function run(parsed, io) {
  const { positionals } = parsed;
  if (positionals.length === 0) {
    throw new UsageError("missing the report to check", { command: name });
  }
  if (positionals.length > 1) {
    throw new UsageError(`expected one report, got ${positionals.length}`, {
      command: name,
    });
  }
  const reportPath = positionals[0];
  const { graph } = readGraph({
    reportPath,
    graphPath: parsed.values.graph,
  });
  const html = readText(reportPath, "report");
  const page = readPage(html, { skip: proseSkip(graph) });
  const issues = [...validateGraph(graph), ...checkRules(graph, page)];
  const summary = summarize(graph, page, issues, {
    report: basename(reportPath),
  });
  if (!parsed.values.quiet) {
    io.out(
      parsed.values.json
        ? JSON.stringify(summary, null, 2)
        : formatSummary(summary, { color: io.color === true }),
    );
  }
  const failed = issues.some((issue) => issue.severity === "error");
  if (!failed && !parsed.values["no-embed"]) embedFile(reportPath, html, graph);
  return failed ? 1 : 0;
}
