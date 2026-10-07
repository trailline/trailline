/**
 * The viewer's local web server: the panel page, its assets, the payload and
 * the report with the files beside it, on 127.0.0.1 only.
 */

import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import http from "node:http";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { TraillineError } from "../errors.js";
import { buildPayload } from "./payload.js";

const CLIENT = fileURLToPath(new URL("./client/", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".png": "image/png",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Everything is `no-store`: the report and payload are re-read on reload. */
function send(res, status, type, body) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

/**
 * The bytes of the file a request names under `root`, or null when there is
 * none: the name has a part starting with a dot (`..`, `.env`, `.git/`), or
 * climbs out of `root` through a symlink, or the file is missing or is a
 * folder. Backslashes count as separators so the answer is the same on
 * Windows.
 */
function readUnder(root, encoded) {
  try {
    const name = decodeURIComponent(encoded);
    if (name.split(/[\\/]/).some((part) => part.startsWith("."))) return null;
    const real = realpathSync(join(root, name));
    const inside = relative(realpathSync(root), real);
    if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      return null;
    return { file: real, body: readFileSync(real) };
  } catch {
    return null;
  }
}

function sendFile(res, root, encoded) {
  const found = readUnder(root, encoded);
  if (found === null) return sendText(res, 404, "not found");
  const type = TYPES[extname(found.file)] ?? "application/octet-stream";
  send(res, 200, type, found.body);
}

function sendText(res, status, text) {
  send(res, status, "text/plain; charset=utf-8", text);
}

/**
 * Listen on `port`, or with `exact` false on the first free port above it.
 * Resolves the port it got.
 */
async function listen(server, port, exact) {
  for (let candidate = port; candidate <= 65535; candidate++) {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(candidate, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      return server.address().port;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      if (exact) throw new TraillineError(`port ${candidate} is in use`);
    }
  }
  throw new TraillineError(`no free port from ${port}; pass --port`);
}

/**
 * @param {{ reportPath: string, graphPath?: string, port: number, exact?: boolean }} options
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function startServer({
  reportPath,
  graphPath,
  port,
  exact = false,
}) {
  let actual;
  const server = http.createServer((req, res) => {
    // Only our own address names us; a rebound DNS name does not.
    const host = req.headers.host;
    if (host !== `127.0.0.1:${actual}` && host !== `localhost:${actual}`) {
      return sendText(res, 403, "forbidden");
    }
    const path = req.url.split("?")[0];
    if (path === "/") {
      sendFile(res, CLIENT, "index.html");
    } else if (path === "/data.json") {
      try {
        const payload = buildPayload({ reportPath, graphPath });
        send(res, 200, TYPES[".json"], JSON.stringify(payload));
      } catch (error) {
        if (!(error instanceof TraillineError)) throw error;
        sendText(res, 500, error.message);
      }
    } else if (path.startsWith("/report/")) {
      sendFile(res, dirname(reportPath), path.slice("/report/".length));
    } else if (path.startsWith("/assets/")) {
      sendFile(res, CLIENT, path.slice("/assets/".length));
    } else {
      sendText(res, 404, "not found");
    }
  });
  actual = await listen(server, port, exact);
  return {
    url: `http://127.0.0.1:${actual}/`,
    port: actual,
    close: () => {
      const closed = new Promise((resolve) => server.close(resolve));
      // Node before 19 keeps idle keep-alive connections open, and a browser
      // always holds one.
      server.closeAllConnections();
      return closed;
    },
  };
}

/** The command that opens `url` in the user's browser on `platform`. */
export function browserCommand(platform, url) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

/**
 * Start `command` without waiting for the browser to exit. Resolves false
 * rather than throwing when it cannot start: the URL is already printed.
 */
export function openBrowser({ command, args }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
