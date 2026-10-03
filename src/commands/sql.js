import { basename } from "node:path";

import { checkRules } from "../check/rules.js";
import { TraillineError, UsageError } from "../errors.js";
import { readGraph, readText } from "../graph/parse.js";
import { validateGraph } from "../graph/schema.js";
import { proseSkip, readPage } from "../html/page.js";
import { composeSql } from "../sql/compose.js";

export const name = "sql";
export const summary = "Compose the report into one runnable SQL script";

export const usage = `trailline sql <report.html> [options]

Joins every source, view and figure in the report's lineage graph into a
single script a reviewer can paste into the warehouse. External and
ungrounded nodes are listed as trailing comments. A report that fails
\`trailline check\` is refused.

Options
  --graph <path>   Graph JSON to read (default: .trailline/<report>.json
                   beside the report, or else the block already embedded
                   in it)
  -h, --help       Show this help`;

export const options = {
  graph: { type: "string" },
};

export async function run(parsed, io) {
  const { positionals } = parsed;
  if (positionals.length === 0) {
    throw new UsageError("missing the report to compose", { command: name });
  }
  if (positionals.length > 1) {
    throw new UsageError(`expected one report, got ${positionals.length}`, {
      command: name,
    });
  }
  const reportPath = positionals[0];
  const { graph } = readGraph({ reportPath, graphPath: parsed.values.graph });
  const html = readText(reportPath, "report");
  const page = readPage(html, { skip: proseSkip(graph) });
  const issues = [...validateGraph(graph), ...checkRules(graph, page)];
  const report = basename(reportPath);
  if (issues.some((issue) => issue.severity === "error")) {
    throw new TraillineError(
      `${report} does not pass \`trailline check\`, so no script was composed`,
    );
  }
  io.out(composeSql(graph, { report }));
  return 0;
}
