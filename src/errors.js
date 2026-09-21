/**
 * Exit codes. These are part of the CLI contract: the skill and the Claude
 * Code hook both branch on them, so they do not change without a major bump.
 *
 *   0  the command did what it was asked to do (warnings are still 0)
 *   1  the command ran but the report or graph did not pass
 *   2  the command was invoked wrongly and never ran
 */
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

/** Bad invocation: unknown command, missing argument, unreadable flag. */
export class UsageError extends Error {
  constructor(message, { command } = {}) {
    super(message);
    this.name = "UsageError";
    this.command = command ?? null;
    this.exitCode = EXIT_USAGE;
  }
}

/** The command ran and reported a real failure. */
export class TraillineError extends Error {
  constructor(message) {
    super(message);
    this.name = "TraillineError";
    this.exitCode = EXIT_FAILED;
  }
}

/** A command whose surface is fixed but whose body is not built yet. */
export class NotImplementedError extends TraillineError {
  constructor(command) {
    super(`\`trailline ${command}\` is not implemented yet.`);
    this.name = "NotImplementedError";
    this.command = command;
  }
}
