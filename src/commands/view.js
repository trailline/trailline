import { basename } from "node:path";

import { UsageError } from "../errors.js";
import { buildPayload } from "../viewer/payload.js";
import { browserCommand, openBrowser, startServer } from "../viewer/server.js";

const DEFAULT_PORT = 7171;

export const name = "view";
export const summary = "Serve the report beside its lineage";

export const usage = `trailline view <report.html> [options]

Serves a two-pane page on localhost: the report on the left, the lineage of
whatever you click on the right. Reads the file and nothing else. No
database, no credentials, no network.

Options
  --port <number>  Port to serve on (default: the first free port from 7171)
  --no-open        Print the URL instead of opening a browser
  --graph <path>   Graph JSON to read (default: .trailline/<report>.json
                   beside the report, or else the block already embedded
                   in it)
  -h, --help       Show this help`;

export const options = {
  port: { type: "string" },
  "no-open": { type: "boolean", default: false },
  graph: { type: "string" },
};

export async function run(parsed, io) {
  const { positionals } = parsed;
  if (positionals.length === 0) {
    throw new UsageError("missing the report to view", { command: name });
  }
  if (positionals.length > 1) {
    throw new UsageError(`expected one report, got ${positionals.length}`, {
      command: name,
    });
  }
  const { port } = parsed.values;
  if (port !== undefined && !(/^\d+$/.test(port) && Number(port) <= 65535)) {
    throw new UsageError(
      `--port must be a whole number from 0 to 65535, got \`${port}\``,
      { command: name },
    );
  }
  const reportPath = positionals[0];
  const graphPath = parsed.values.graph;
  // Read everything once before listening: an unreadable graph exits 1
  // without ever printing a URL.
  buildPayload({ reportPath, graphPath });
  const server = await startServer({
    reportPath,
    graphPath,
    port: port === undefined ? DEFAULT_PORT : Number(port),
    exact: port !== undefined,
  });
  io.out(`Serving ${basename(reportPath)} at ${server.url}`);
  io.out("Press Ctrl-C to stop.");
  if (!parsed.values["no-open"]) {
    const open =
      io.open ?? ((url) => openBrowser(browserCommand(process.platform, url)));
    // A browser that will not open is not an error: the URL is printed.
    open(server.url);
  }
  await stopped(io.signal);
  await server.close();
  return 0;
}

/** Resolves when `signal` aborts; without one, on the first Ctrl-C. */
function stopped(signal) {
  return new Promise((resolve) => {
    if (signal === undefined) return process.once("SIGINT", resolve);
    signal.addEventListener("abort", resolve, { once: true });
  });
}
