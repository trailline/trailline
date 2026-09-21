import { parseArgs } from "node:util";

import { byName, commands } from "./commands/index.js";
import { EXIT_OK, EXIT_USAGE, UsageError } from "./errors.js";
import { topLevelHelp, versionLine } from "./help.js";

const defaultIo = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};

const HELP_FLAGS = new Set(["-h", "--help"]);
const VERSION_FLAGS = new Set(["-v", "--version"]);

/**
 * Parse one command's arguments. parseArgs throws a handful of ERR_PARSE_ARGS_*
 * codes with readable messages; they are all invocation mistakes, so they all
 * become a UsageError and exit 2.
 */
function parseCommand(command, argv) {
  try {
    return parseArgs({
      args: argv,
      options: { ...command.options, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new UsageError(error.message, { command: command.name });
  }
}

async function dispatch(argv, io) {
  if (argv.length === 0) {
    io.out(topLevelHelp());
    return EXIT_OK;
  }

  const [first, ...rest] = argv;

  if (HELP_FLAGS.has(first)) {
    // `trailline --help check` is the same as `trailline check --help`.
    const named = byName.get(rest[0]);
    io.out(named ? named.usage : topLevelHelp());
    return EXIT_OK;
  }

  if (VERSION_FLAGS.has(first)) {
    io.out(versionLine());
    return EXIT_OK;
  }

  if (first.startsWith("-")) {
    throw new UsageError(`unknown option \`${first}\``);
  }

  const command = byName.get(first);
  if (!command) {
    const known = commands.map((c) => c.name).join(", ");
    throw new UsageError(
      `unknown command \`${first}\`. Expected one of: ${known}`,
    );
  }

  const parsed = parseCommand(command, rest);
  if (parsed.values.help) {
    io.out(command.usage);
    return EXIT_OK;
  }

  const code = await command.run(parsed, io);
  return code ?? EXIT_OK;
}

/**
 * The whole CLI as one function, so tests can drive it in-process and assert
 * on both the exit code and the output without spawning Node.
 */
export async function main(argv = process.argv.slice(2), io = defaultIo) {
  try {
    return await dispatch(argv, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`trailline: ${error.message}`);
      io.err(
        error.command
          ? `Try \`trailline ${error.command} --help\`.`
          : "Try `trailline --help`.",
      );
      return EXIT_USAGE;
    }
    if (typeof error?.exitCode === "number") {
      io.err(`trailline: ${error.message}`);
      return error.exitCode;
    }
    throw error;
  }
}
