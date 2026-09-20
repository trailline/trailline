import { NotImplementedError } from "../errors.js";

export const name = "view";
export const summary = "Serve the report beside its lineage";

export const usage = `trailline view <report.html> [options]

Serves a two-pane page on localhost: the report on the left, the lineage of
whatever you click on the right. Reads the file and nothing else. No
database, no credentials, no network.

Options
  --port <number>  Port to serve on (default: the first free port from 7171)
  --no-open        Print the URL instead of opening a browser
  --graph <path>   Graph JSON to read (default: the block embedded in the
                   report, else .trailline/graph.json)
  -h, --help       Show this help`;

export const options = {
  port: { type: "string" },
  "no-open": { type: "boolean", default: false },
  graph: { type: "string" },
};

export async function run(_parsed) {
  throw new NotImplementedError(name, "M5");
}
