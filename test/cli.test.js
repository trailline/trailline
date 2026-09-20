import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commands } from "../src/commands/index.js";
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from "../src/errors.js";
import { packageMeta } from "../src/meta.js";
import { runCli } from "./helpers.js";

describe("command registry", () => {
  it("exposes the four MVP commands", () => {
    assert.deepEqual(
      commands.map((c) => c.name),
      ["source", "check", "view", "sql"],
    );
  });

  for (const command of commands) {
    it(`${command.name} declares a complete surface`, () => {
      assert.equal(typeof command.summary, "string");
      assert.ok(command.summary.length > 0);
      assert.ok(command.usage.startsWith(`trailline ${command.name}`));
      assert.equal(typeof command.options, "object");
      assert.equal(typeof command.run, "function");
    });

    it(`${command.name} does not redefine the help flag`, () => {
      assert.ok(!("help" in command.options));
    });
  }
});

describe("top level", () => {
  it("prints help and succeeds when called bare", async () => {
    const { code, out } = await runCli([]);
    assert.equal(code, EXIT_OK);
    for (const command of commands) {
      assert.match(out, new RegExp(`\\b${command.name}\\b`));
    }
  });

  it("prints the version", async () => {
    const { code, out } = await runCli(["--version"]);
    const { name, version } = packageMeta();
    assert.equal(code, EXIT_OK);
    assert.equal(out, `${name} ${version}`);
  });

  it("routes --help <command> to that command's usage", async () => {
    const { code, out } = await runCli(["--help", "sql"]);
    assert.equal(code, EXIT_OK);
    assert.ok(out.startsWith("trailline sql"));
  });

  it("rejects an unknown command with exit 2", async () => {
    const { code, err } = await runCli(["nope"]);
    assert.equal(code, EXIT_USAGE);
    assert.match(err, /unknown command `nope`/);
  });

  it("rejects an unknown top level option with exit 2", async () => {
    const { code, err } = await runCli(["--nope"]);
    assert.equal(code, EXIT_USAGE);
    assert.match(err, /unknown option `--nope`/);
  });
});

describe("per command parsing", () => {
  for (const command of commands) {
    it(`${command.name} --help prints its usage`, async () => {
      const { code, out } = await runCli([command.name, "--help"]);
      assert.equal(code, EXIT_OK);
      assert.ok(out.startsWith(`trailline ${command.name}`));
    });

    it(`${command.name} -h prints its usage`, async () => {
      const { code, out } = await runCli([command.name, "-h"]);
      assert.equal(code, EXIT_OK);
      assert.ok(out.startsWith(`trailline ${command.name}`));
    });

    it(`${command.name} rejects an unknown option with exit 2`, async () => {
      const { code, err } = await runCli([command.name, "--definitely-not"]);
      assert.equal(code, EXIT_USAGE);
      assert.match(err, new RegExp(`trailline ${command.name} --help`));
    });

    it(`${command.name} reports that it is not built yet`, async () => {
      const { code, err } = await runCli([command.name]);
      assert.equal(code, EXIT_FAILED);
      assert.match(err, /not implemented yet/);
    });
  }
});
