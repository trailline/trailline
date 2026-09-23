import { NotImplementedError } from "../errors.js";

export const name = "sql";
export const summary = "Compose the report into one runnable SQL script";

export const usage = `trailline sql <report.html> [options]

Joins every source, view and figure in the report's lineage graph into a
single script a reviewer can paste into the warehouse. External and
ungrounded nodes are listed as trailing comments.

Options
  --graph <path>   Graph JSON to read (default: .trailline/<report>.json
                   beside the report, or else the block already embedded
                   in it)
  --out <path>     Write to a file instead of standard output
  -h, --help       Show this help`;

export const options = {
  graph: { type: "string" },
  out: { type: "string" },
};

export async function run(_parsed) {
  throw new NotImplementedError(name);
}
