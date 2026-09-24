import { NotImplementedError } from "../errors.js";

export const name = "source";
export const summary = "Register one source in the lineage graph";

export const usage = `trailline source --report <report.html> --id <id> [options]

Writes one source node into the graph file. This is the registration path
for surfaces without a capture hook. In Claude Code the hook captures
warehouse calls automatically and this command is rarely needed.

SQL source
  --id <id>            Node id, conventionally q1, q2, ...
  --mart <name>        Fully qualified mart the query reads
  --period <from:to>   Pinned reporting range, ISO dates, e.g.
                       2026-01-01:2026-08-31
  --sql-file <path>    File holding the query as it was run

External source
  --external           Register a source Trailline cannot see inside
  --type <type>        What kind of thing, e.g. csv, website, report
  --ref <ref>          How to find it
  --given <text>       What the model was handed, in words

Common
  --report <path>      The report this source belongs to. The source is
                       written to .trailline/<report>.json beside it; the
                       report itself need not exist yet
  --graph <path>       Graph JSON to write instead of the report's default
  --force              Overwrite an existing node with this id
  -h, --help           Show this help`;

export const options = {
  id: { type: "string" },
  mart: { type: "string" },
  period: { type: "string" },
  "sql-file": { type: "string" },
  external: { type: "boolean", default: false },
  type: { type: "string" },
  ref: { type: "string" },
  given: { type: "string" },
  report: { type: "string" },
  graph: { type: "string" },
  force: { type: "boolean", default: false },
};

export async function run(_parsed) {
  throw new NotImplementedError(name);
}
