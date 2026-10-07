import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { main } from "../src/cli.js";
import { buildPayload } from "../src/viewer/payload.js";
import { FIXTURE_NAMES, loadFixture, runCli, tempDir } from "./helpers.js";

const G1 = {
  trailline: "1.0",
  nodes: {
    q1: { step: "source", kind: "sql", sql: "select amount from sales" },
    f1: {
      step: "figure",
      from: ["q1"],
      sql: "select amount from q1",
      label: "Sales",
      value: 12,
      display: "12",
    },
  },
};
const R0 =
  "<html><head><title>r</title></head><body><p>Hello.</p></body></html>";
const R_F1 =
  '<html><head></head><body><p>Sales were <span data-trailline="f1">12</span>.</p></body></html>';

/** Write <dir>/r.html, and <dir>/.trailline/r.json when a graph is given. */
function report(t, html, graph) {
  const dir = tempDir(t);
  const path = join(dir, "r.html");
  writeFileSync(path, html);
  if (graph) {
    mkdirSync(join(dir, ".trailline"));
    writeFileSync(join(dir, ".trailline", "r.json"), JSON.stringify(graph));
  }
  return { dir, path };
}

/** A bare server holding some port on 127.0.0.1; resolves the port. */
const busy = (t) =>
  new Promise((resolve) => {
    const holder = http.createServer();
    t.after(() => holder.close());
    holder.listen(0, "127.0.0.1", () => resolve(holder.address().port));
  });

/** GET a URL, resolving { status, body } or rejecting on a network error. */
const fetchUrl = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks) }),
        );
      })
      .on("error", reject);
  });

/**
 * Run `trailline view` in-process without awaiting it. Resolves once the
 * first line is printed, with the url, what was printed, what was opened and
 * `stop()`, which ends the command and resolves its exit code.
 */
function view(t, argv, { open } = {}) {
  const lines = [];
  const err = [];
  const opened = [];
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const running = main(["view", ...argv], {
      out: (text) => {
        lines.push(text);
        if (lines.length > 1) return;
        const stop = () => {
          controller.abort();
          return running;
        };
        t.after(stop);
        resolve({
          url: text.match(/ at (\S+)$/)?.[1],
          lines,
          err,
          opened,
          stop,
        });
      },
      err: (text) => err.push(text),
      signal: controller.signal,
      open:
        open ??
        (async (url) => {
          opened.push(url);
          return true;
        }),
    });
    running.then((code) => reject(new Error(`exited ${code} early: ${err}`)));
  });
}

const USAGE = (message) =>
  `trailline: ${message}\nTry \`trailline view --help\`.`;

describe("view: invocation", () => {
  it("exits 2 when no report is given", async () => {
    const { code, out, err } = await runCli(["view"]);
    assert.equal(code, 2);
    assert.equal(out, "");
    assert.equal(err, USAGE("missing the report to view"));
  });

  it("exits 2 when more than one report is given", async () => {
    const { code, err } = await runCli(["view", "a.html", "b.html"]);
    assert.equal(code, 2);
    assert.equal(err, USAGE("expected one report, got 2"));
  });

  it("exits 2 on a port that is not a whole number from 0 to 65535", async () => {
    for (const [arg, shown] of [
      [["--port", "abc"], "abc"],
      [["--port", "1.5"], "1.5"],
      [["--port", "65536"], "65536"],
      [["--port=-1"], "-1"],
      [["--port="], ""],
    ]) {
      const { code, out, err } = await runCli(["view", "missing.html", ...arg]);
      assert.equal(code, 2, shown);
      assert.equal(out, "", shown);
      assert.equal(
        err,
        USAGE(
          `--port must be a whole number from 0 to 65535, got \`${shown}\``,
        ),
      );
    }
  });

  it("exits 1 when the report file does not exist", async (t) => {
    const path = join(tempDir(t), "r.html");
    const { code, out, err } = await runCli(["view", path]);
    assert.equal(code, 1);
    assert.equal(out, "");
    assert.equal(err, `trailline: report not found: ${path}`);
    const checked = await runCli(["check", path]);
    assert.equal(err, checked.err);
  });

  it("exits 1 with check's error when the graph cannot be read", async (t) => {
    const { path } = report(t, R0);
    const { code, out, err } = await runCli(["view", path, "--no-open"]);
    assert.equal(code, 1);
    assert.equal(out, "");
    const checked = await runCli(["check", path, "--no-embed"]);
    assert.equal(err, checked.err);
  });

  it("exits 1 when the given port is busy", async (t) => {
    const { path } = report(t, R_F1, G1);
    const P = await busy(t);
    const { code, out, err } = await runCli([
      "view",
      path,
      "--no-open",
      "--port",
      String(P),
    ]);
    assert.equal(code, 1);
    assert.equal(out, "");
    assert.equal(err, `trailline: port ${P} is in use`);
  });
});

describe("view", () => {
  it("prints the url and serves the payload there", async (t) => {
    const { path } = report(t, R_F1, G1);
    const { url, lines } = await view(t, [path, "--no-open", "--port", "0"]);
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.deepEqual(lines, [
      `Serving r.html at ${url}`,
      "Press Ctrl-C to stop.",
    ]);
    const res = await fetchUrl(`${url}data.json`);
    assert.deepEqual(JSON.parse(res.body), buildPayload({ reportPath: path }));
  });

  it("exits 0 and stops listening when stopped", async (t) => {
    const { path } = report(t, R_F1, G1);
    const { url, err, stop } = await view(t, [
      path,
      "--no-open",
      "--port",
      "0",
    ]);
    assert.equal(await stop(), 0);
    assert.equal(err.join("\n"), "");
    await assert.rejects(fetchUrl(url), { code: "ECONNREFUSED" });
  });

  it("opens the browser at the url", async (t) => {
    const { path } = report(t, R_F1, G1);
    const { url, opened } = await view(t, [path, "--port", "0"]);
    assert.deepEqual(opened, [url]);
  });

  it("does not open the browser with --no-open", async (t) => {
    const { path } = report(t, R_F1, G1);
    const { opened } = await view(t, [path, "--no-open", "--port", "0"]);
    assert.deepEqual(opened, []);
  });

  it("keeps serving when the browser cannot be opened", async (t) => {
    const { path } = report(t, R_F1, G1);
    const { url, lines, err, stop } = await view(t, [path, "--port", "0"], {
      open: async () => false,
    });
    const res = await fetchUrl(`${url}data.json`);
    assert.equal(res.status, 200);
    assert.equal(await stop(), 0);
    assert.equal(err.join("\n"), "");
    assert.deepEqual(lines, [
      `Serving r.html at ${url}`,
      "Press Ctrl-C to stop.",
    ]);
  });

  it("reads the graph given with --graph", async (t) => {
    const { dir, path } = report(t, R_F1);
    const other = join(dir, "other.json");
    writeFileSync(other, JSON.stringify(G1));
    const { url } = await view(t, [
      path,
      "--graph",
      other,
      "--no-open",
      "--port",
      "0",
    ]);
    const res = await fetchUrl(`${url}data.json`);
    assert.deepEqual(JSON.parse(res.body).graph, G1);
  });

  it("starts from port 7171 when no port is given", async (t) => {
    const { path } = report(t, R_F1, G1);
    const { url } = await view(t, [path, "--no-open"]);
    assert.ok(Number(new URL(url).port) >= 7171);
  });
});

describe("view: fixtures", () => {
  it("serves each fixture, failing ones included, and leaves it untouched", async (t) => {
    for (const name of FIXTURE_NAMES) {
      const { dir, reportPath, expected } = loadFixture(name);
      const sidecar = join(
        dir,
        ".trailline",
        expected.report.replace(/\.html$/, ".json"),
      );
      const files = [reportPath, sidecar].filter((file) => existsSync(file));
      const before = files.map((file) => readFileSync(file));
      const { url, stop } = await view(t, [
        reportPath,
        "--no-open",
        "--port",
        "0",
      ]);
      const data = await fetchUrl(`${url}data.json`);
      assert.deepEqual(
        JSON.parse(data.body),
        buildPayload({ reportPath }),
        name,
      );
      const served = await fetchUrl(
        `${url}report/${encodeURIComponent(expected.report)}`,
      );
      assert.deepEqual(served.body, readFileSync(reportPath), name);
      assert.equal(await stop(), 0, name);
      assert.deepEqual(
        files.map((file) => readFileSync(file)),
        before,
        name,
      );
    }
  });
});
