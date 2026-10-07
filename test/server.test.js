import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPayload } from "../src/viewer/payload.js";
import { TraillineError } from "../src/errors.js";
import {
  browserCommand,
  openBrowser,
  startServer,
} from "../src/viewer/server.js";
import { tempDir } from "./helpers.js";

const CLIENT = fileURLToPath(new URL("../src/viewer/client/", import.meta.url));
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2,
]);

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

/** `secret.txt` in the parent of the report's folder; no request may get it. */
function secret(t, dir) {
  const file = join(dirname(dir), "secret.txt");
  writeFileSync(file, "secret");
  t.after(() => rmSync(file, { force: true }));
  return file;
}

/** A bare server holding some port on 127.0.0.1; resolves the port. */
const busy = (t) =>
  new Promise((resolve) => {
    const holder = http.createServer();
    t.after(() => holder.close());
    holder.listen(0, "127.0.0.1", () => resolve(holder.address().port));
  });

// Start on a free port; closed when the test ends.
const serve = async (t, options) => {
  const s = await startServer({ port: 0, exact: true, ...options });
  t.after(() => s.close());
  return s;
};

// GET `path` exactly as written. node:http, not fetch: fetch normalises `..`
// away, and these tests need it sent raw.
const get = (server, path, headers = {}, agent) =>
  new Promise((resolve, reject) => {
    http
      .get(
        { host: "127.0.0.1", port: server.port, path, headers, agent },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      )
      .on("error", reject);
  });

describe("startServer", () => {
  it("listens on 127.0.0.1 and gives its url", async (t) => {
    const { path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    assert.ok(Number.isInteger(s.port) && s.port > 0);
    assert.equal(s.url, `http://127.0.0.1:${s.port}/`);
  });

  it("serves the payload at /data.json", async (t) => {
    const { path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    const res = await get(s, "/data.json");
    assert.equal(res.status, 200);
    assert.equal(
      res.headers["content-type"],
      "application/json; charset=utf-8",
    );
    assert.deepEqual(JSON.parse(res.body), buildPayload({ reportPath: path }));
  });

  it("reads the graph from graphPath when given", async (t) => {
    const { dir, path } = report(t, R_F1);
    const graphPath = join(dir, "other.json");
    writeFileSync(graphPath, JSON.stringify(G1));
    const s = await serve(t, { reportPath: path, graphPath });
    const res = await get(s, "/data.json");
    assert.deepEqual(JSON.parse(res.body).graph, G1);
  });

  it("rebuilds the payload on every request", async (t) => {
    const { path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    await get(s, "/data.json");
    const changed = R_F1.replace("Sales were", "Sales came to");
    writeFileSync(path, changed);
    const res = await get(s, "/data.json");
    assert.equal(JSON.parse(res.body).html, changed);
  });

  it("serves the panel page at /", async (t) => {
    const { path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    const res = await get(s, "/");
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
    assert.deepEqual(res.body, readFileSync(join(CLIENT, "index.html")));
  });

  it("serves the report at /report/<name>, as read", async (t) => {
    const { path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    const res = await get(s, "/report/r.html");
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(res.body.toString(), R_F1);
  });

  it("marks the page, data and report no-store", async (t) => {
    const { path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    for (const url of ["/", "/data.json", "/report/r.html"]) {
      const res = await get(s, url);
      assert.equal(res.headers["cache-control"], "no-store", url);
    }
  });

  it("serves a file in a folder beside the report, byte for byte", async (t) => {
    const { dir, path } = report(t, R_F1, G1);
    mkdirSync(join(dir, "img"));
    writeFileSync(join(dir, "img", "chart.png"), PNG);
    const s = await serve(t, { reportPath: path });
    const res = await get(s, "/report/img/chart.png");
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/png");
    assert.deepEqual(res.body, PNG);
  });

  it("gives each known file type its content type", async (t) => {
    const { dir, path } = report(t, R_F1, G1);
    const types = {
      "a.css": "text/css; charset=utf-8",
      "a.js": "text/javascript; charset=utf-8",
      "a.mjs": "text/javascript; charset=utf-8",
      "a.json": "application/json; charset=utf-8",
      "a.svg": "image/svg+xml",
      "a.jpg": "image/jpeg",
      "a.jpeg": "image/jpeg",
      "a.gif": "image/gif",
      "a.webp": "image/webp",
      "a.csv": "text/csv; charset=utf-8",
      "a.txt": "text/plain; charset=utf-8",
      "a.woff2": "font/woff2",
      "a.xyz": "application/octet-stream",
    };
    for (const name of Object.keys(types)) writeFileSync(join(dir, name), "x");
    const s = await serve(t, { reportPath: path });
    for (const [name, type] of Object.entries(types)) {
      const res = await get(s, `/report/${name}`);
      assert.equal(res.headers["content-type"], type, name);
    }
  });

  it("decodes percent-encoded names", async (t) => {
    const { dir } = report(t, R_F1, G1);
    const path = join(dir, "my report.html");
    writeFileSync(path, R_F1);
    writeFileSync(
      join(dir, ".trailline", "my report.json"),
      JSON.stringify(G1),
    );
    const s = await serve(t, { reportPath: path });
    const res = await get(s, "/report/my%20report.html");
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), R_F1);
  });

  it("serves the bundled font under /assets/", async (t) => {
    const { path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    const res = await get(s, "/assets/fonts/JetBrainsMono-Regular.woff2");
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "font/woff2");
    assert.deepEqual(
      res.body,
      readFileSync(join(CLIENT, "fonts", "JetBrainsMono-Regular.woff2")),
    );
  });

  it("answers 404 for anything else", async (t) => {
    const { dir, path } = report(t, R_F1, G1);
    mkdirSync(join(dir, "img"));
    writeFileSync(join(dir, "img", "chart.png"), PNG);
    const s = await serve(t, { reportPath: path });
    for (const url of [
      "/nope",
      "/data.json/x",
      "/report",
      "/report/",
      "/report/img",
      "/report/img/",
      "/report/missing.png",
      "/assets/missing.css",
      "/assets/fonts",
    ]) {
      const res = await get(s, url);
      assert.equal(res.status, 404, url);
      assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");
      assert.equal(res.body.toString(), "not found", url);
    }
  });

  it("refuses paths that climb out with ..", async (t) => {
    const { dir, path } = report(t, R_F1, G1);
    secret(t, dir);
    const s = await serve(t, { reportPath: path });
    for (const url of [
      "/report/../secret.txt",
      "/report/%2e%2e/secret.txt",
      "/report/%2E%2E%2Fsecret.txt",
      "/report/img/..%2f..%2f..%2fsecret.txt",
      "/report/..%5csecret.txt",
      "/assets/../payload.js",
      "/assets/%2e%2e/payload.js",
    ]) {
      const res = await get(s, url);
      assert.equal(res.status, 404, url);
      assert.equal(res.body.toString(), "not found", url);
    }
  });

  it("refuses absolute paths", async (t) => {
    const { dir, path } = report(t, R_F1, G1);
    const abs = secret(t, dir);
    const s = await serve(t, { reportPath: path });
    for (const url of [
      `/report/${abs}`,
      `/report/${encodeURIComponent(abs)}`,
    ]) {
      const res = await get(s, url);
      assert.equal(res.status, 404, url);
      assert.equal(res.body.toString(), "not found", url);
    }
  });

  it(
    "refuses a symlink that points out of the report's folder",
    { skip: process.platform === "win32" },
    async (t) => {
      const { dir, path } = report(t, R_F1, G1);
      symlinkSync(secret(t, dir), join(dir, "link.txt"));
      const s = await serve(t, { reportPath: path });
      const res = await get(s, "/report/link.txt");
      assert.equal(res.status, 404);
      assert.equal(res.body.toString(), "not found");
    },
  );

  it(
    "serves a symlink that stays inside the report's folder",
    { skip: process.platform === "win32" },
    async (t) => {
      const { dir, path } = report(t, R_F1, G1);
      mkdirSync(join(dir, "img"));
      writeFileSync(join(dir, "img", "chart.png"), PNG);
      symlinkSync(join(dir, "img", "chart.png"), join(dir, "same.png"));
      const s = await serve(t, { reportPath: path });
      const res = await get(s, "/report/same.png");
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, PNG);
    },
  );

  it(
    "serves a report whose folder is reached through a symlink",
    { skip: process.platform === "win32" },
    async (t) => {
      const { dir } = report(t, R_F1, G1);
      const via = join(tempDir(t), "via");
      symlinkSync(dir, via);
      const s = await serve(t, { reportPath: join(via, "r.html") });
      const res = await get(s, "/report/r.html");
      assert.equal(res.status, 200);
      assert.equal(res.body.toString(), R_F1);
    },
  );

  it("refuses dot files and dot folders", async (t) => {
    const { dir, path } = report(t, R_F1, G1);
    writeFileSync(join(dir, ".env"), "KEY=1");
    mkdirSync(join(dir, ".hidden"));
    writeFileSync(join(dir, ".hidden", "a.txt"), "x");
    const s = await serve(t, { reportPath: path });
    for (const url of [
      "/report/.trailline/r.json",
      "/report/.env",
      "/report/.hidden/a.txt",
    ]) {
      const res = await get(s, url);
      assert.equal(res.status, 404, url);
      assert.equal(res.body.toString(), "not found", url);
    }
  });

  it("refuses a request for another host name", async (t) => {
    const { path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    const res = await get(s, "/data.json", { host: `evil.example:${s.port}` });
    assert.equal(res.status, 403);
    assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(res.body.toString(), "forbidden");
  });

  it("accepts localhost as the host name", async (t) => {
    const { path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    const res = await get(s, "/data.json", { host: `localhost:${s.port}` });
    assert.equal(res.status, 200);
  });

  it("answers 500 with check's error when the graph can no longer be read", async (t) => {
    const { dir, path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    rmSync(join(dir, ".trailline", "r.json"));
    let expected;
    try {
      buildPayload({ reportPath: path });
    } catch (error) {
      assert.ok(error instanceof TraillineError);
      expected = error.message;
    }
    const res = await get(s, "/data.json");
    assert.equal(res.status, 500);
    assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(res.body.toString(), expected);
  });

  it("still serves the report when the graph is broken", async (t) => {
    const { dir, path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    rmSync(join(dir, ".trailline", "r.json"));
    const res = await get(s, "/report/r.html");
    assert.equal(res.status, 200);
  });

  it("close resolves while a browser holds a keep-alive connection", async (t) => {
    const { path } = report(t, R_F1, G1);
    const s = await serve(t, { reportPath: path });
    const agent = new http.Agent({ keepAlive: true });
    t.after(() => agent.destroy());
    await get(s, "/data.json", {}, agent);
    await s.close();
    await assert.rejects(get(s, "/data.json"), { code: "ECONNREFUSED" });
  });

  it("moves to the next free port when the first is busy", async (t) => {
    const { path } = report(t, R_F1, G1);
    const P = await busy(t);
    const s = await serve(t, { reportPath: path, port: P, exact: false });
    assert.ok(s.port > P && s.port < P + 20);
    assert.equal(s.url, `http://127.0.0.1:${s.port}/`);
  });

  it("fails when an exact port is busy", async (t) => {
    const { path } = report(t, R_F1, G1);
    const P = await busy(t);
    await assert.rejects(
      startServer({ reportPath: path, port: P, exact: true }),
      (error) =>
        error instanceof TraillineError &&
        error.message === `port ${P} is in use`,
    );
  });

  it("fails when every port up to 65535 is busy", async (t) => {
    const { path } = report(t, R_F1, G1);
    const start = 65530;
    for (let port = start; port <= 65535; port++) {
      const holder = http.createServer();
      t.after(() => holder.close());
      await new Promise((resolve, reject) => {
        holder.once("error", reject);
        holder.listen(port, "127.0.0.1", resolve);
      });
    }
    await assert.rejects(
      startServer({ reportPath: path, port: start, exact: false }),
      (error) =>
        error instanceof TraillineError &&
        error.message === `no free port from ${start}; pass --port`,
    );
  });
});

describe("browserCommand", () => {
  const url = "http://127.0.0.1:7171/";

  it("uses open on macOS", () => {
    assert.deepEqual(browserCommand("darwin", url), {
      command: "open",
      args: [url],
    });
  });

  it("uses start on Windows", () => {
    assert.deepEqual(browserCommand("win32", url), {
      command: "cmd",
      args: ["/c", "start", "", url],
    });
  });

  it("uses xdg-open everywhere else", () => {
    for (const platform of ["linux", "freebsd"]) {
      assert.deepEqual(browserCommand(platform, url), {
        command: "xdg-open",
        args: [url],
      });
    }
  });
});

describe("openBrowser", () => {
  it("resolves true once the command starts", async () => {
    assert.equal(
      await openBrowser({ command: process.execPath, args: ["-e", ""] }),
      true,
    );
  });

  it("resolves false, without throwing, when the command cannot start", async () => {
    assert.equal(
      await openBrowser({ command: "trailline-no-such-command", args: [] }),
      false,
    );
  });
});
