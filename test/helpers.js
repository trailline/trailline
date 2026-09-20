import { main } from "../src/cli.js";

/** Run the CLI in-process and collect everything it printed. */
export async function runCli(argv) {
  const out = [];
  const err = [];
  const code = await main(argv, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
