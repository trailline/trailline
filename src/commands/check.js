import { NotImplementedError } from "../errors.js";

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

export async function run(_parsed) {
  throw new NotImplementedError(name);
}
