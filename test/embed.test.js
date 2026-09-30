import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { TraillineError } from "../src/errors.js";
import { embedFile, embedGraph } from "../src/html/embed.js";
import {
  findEmbeddedGraph,
  readGraph,
  serializeForEmbed,
} from "../src/graph/parse.js";
import { readPage } from "../src/html/page.js";
import { loadFixture, tempDir } from "./helpers.js";

const META = '<meta name="trailline" content="1.0">';
const OPEN = '<script type="application/trailline+json" id="trailline-graph">';
const G0 = { nodes: {} };
const G0_JSON = '{\n  "nodes": {}\n}'; // serializeForEmbed(G0)
const BLOCK0 = `${OPEN}${G0_JSON}</script>`;
const NO_BODY =
  "the report has no </body> tag, so the lineage graph was not embedded";
const NO_HEAD =
  "the report has no </head> tag, so the lineage graph was not embedded";

const A = "<html><head><title>t</title></head><body><p>x</p></body></html>";
const B = `<html><head>${META}</head><body>\n${OPEN}{"old":true}</script>\n</body></html>`;
const C = `<html><head>${META}</head><body><script id=x type='application/trailline+json'>{}</script></body></html>`;
const D =
  '<html><head><script type="application/trailline+json">{}</script></head><body></body></html>';
const E =
  '<html><head>\n  <meta content="0.9" name="trailline">\n</head><body></body></html>';
const F =
  '<html><head><meta name="description" content="trailline"></head><body></body></html>';
const H = "<HTML><HEAD></HEAD><BODY><!-- </body> --><p>x</p></BODY></HTML>";
const G1 = {
  nodes: { q1: { step: "source", sql: "select '</script>' as s" } },
};
const TWO =
  '<html><head></head><body>\n<script type="application/trailline+json">{}</script>\n<script type="application/trailline+json">{}</script>\n</body></html>';
const UNCLOSED =
  '<html><head></head><body>\n<script type="application/trailline+json">{}\n</body></html>';

const failsWith = (message) => (error) =>
  error instanceof TraillineError && error.message === message;

describe("embedGraph", () => {
  it("adds the meta tag and the graph block to a page with neither", () => {
    assert.equal(
      embedGraph(A, G0),
      "<html><head><title>t</title>" +
        META +
        "\n</head><body><p>x</p>" +
        BLOCK0 +
        "\n</body></html>",
    );
  });

  it("replaces an existing block and keeps a current meta tag", () => {
    assert.equal(
      embedGraph(B, G0),
      "<html><head>" + META + "</head><body>\n" + BLOCK0 + "\n</body></html>",
    );
  });

  it("rewrites an existing block's tag to the standard one", () => {
    assert.equal(
      embedGraph(C, G0),
      "<html><head>" + META + "</head><body>" + BLOCK0 + "</body></html>",
    );
  });

  it("replaces a block where it stands, even outside the body", () => {
    assert.equal(
      embedGraph(D, G0),
      "<html><head>" + BLOCK0 + META + "\n</head><body></body></html>",
    );
  });

  it("replaces an out-of-date trailline meta tag in place", () => {
    assert.equal(
      embedGraph(E, G0),
      "<html><head>\n  " +
        META +
        "\n</head><body>" +
        BLOCK0 +
        "\n</body></html>",
    );
  });

  it("leaves other meta tags alone", () => {
    assert.equal(
      embedGraph(F, G0),
      '<html><head><meta name="description" content="trailline">' +
        META +
        "\n</head><body>" +
        BLOCK0 +
        "\n</body></html>",
    );
  });

  it("matches tags in any case and inserts before the last </body>", () => {
    assert.equal(
      embedGraph(H, G0),
      "<HTML><HEAD>" +
        META +
        "\n</HEAD><BODY><!-- </body> --><p>x</p>" +
        BLOCK0 +
        "\n</BODY></HTML>",
    );
  });

  it("escapes SQL that would close the script early", () => {
    const expected =
      "<html><head><title>t</title>" +
      META +
      "\n</head><body><p>x</p>" +
      OPEN +
      serializeForEmbed(G1) +
      "</script>" +
      "\n</body></html>";
    const out = embedGraph(A, G1);
    assert.equal(out, expected);
    assert.equal(out.split("</script>").length, 2);
    assert.deepEqual(JSON.parse(findEmbeddedGraph(out).content), G1);
  });

  it("refuses a page with no </body>", () => {
    assert.throws(
      () => embedGraph("<html><head></head><body><p>x</p></html>", G0),
      failsWith(NO_BODY),
    );
  });

  it("refuses a page with no </body> even when it already holds a block", () => {
    assert.throws(
      () => embedGraph("<html><head></head><body>" + BLOCK0 + "</html>", G0),
      failsWith(NO_BODY),
    );
  });

  it("refuses a page with no </head>", () => {
    assert.throws(
      () => embedGraph("<html><body><p>x</p></body></html>", G0),
      failsWith(NO_HEAD),
    );
  });

  it("refuses a page with two graph blocks", () => {
    assert.throws(
      () => embedGraph(TWO, G0),
      failsWith(
        "the report holds 2 embedded lineage graphs (at line 2, column 1, line 3, column 1); expected one",
      ),
    );
  });

  it("refuses a page whose graph block is never closed", () => {
    assert.throws(
      () => embedGraph(UNCLOSED, G0),
      failsWith(
        "the embedded lineage graph at line 2, column 1 is never closed with </script>",
      ),
    );
  });

  // An existing block's unescaped JSON can hold text that looks like
  // </head>, </body> or a trailline <meta>. Those lookalikes must not be
  // mistaken for the real tag.
  it("ignores a </head> lookalike inside an existing block's JSON", () => {
    const html =
      '<html><head><script type="application/trailline+json">' +
      '{"x":"</head>"}</script></head><body></body></html>';
    assert.equal(
      embedGraph(html, G0),
      "<html><head>" + BLOCK0 + META + "\n</head><body></body></html>",
    );
  });

  it("refuses a page whose only </body> lookalike is inside an existing block's JSON", () => {
    const html =
      '<html><head></head><body><script type="application/trailline+json">' +
      '{"x":"</body>"}</script></html>';
    assert.throws(() => embedGraph(html, G0), failsWith(NO_BODY));
  });

  it("ignores a trailline meta lookalike inside an existing block's JSON", () => {
    const html =
      '<html><head><script type="application/trailline+json">' +
      '{"x":"<meta name=trailline>"}</script></head><body></body></html>';
    assert.equal(
      embedGraph(html, G0),
      "<html><head>" + BLOCK0 + META + "\n</head><body></body></html>",
    );
  });
});

describe("embedGraph: fixtures", () => {
  it("leaves clean byte-identical", () => {
    const { reportPath } = loadFixture("clean");
    const html = readFileSync(reportPath, "utf8");
    const { graph } = readGraph({ reportPath });
    assert.equal(embedGraph(html, graph), html);
  });

  it("embeds messy's sidecar graph", () => {
    const { reportPath } = loadFixture("messy");
    const html = readFileSync(reportPath, "utf8");
    const { graph } = readGraph({ reportPath });
    const out = embedGraph(html, graph);
    const h = html.indexOf("</head>");
    const b = html.lastIndexOf("</body>");
    const expected =
      html.slice(0, h) +
      META +
      "\n" +
      html.slice(h, b) +
      OPEN +
      serializeForEmbed(graph) +
      "</script>\n" +
      html.slice(b);
    assert.equal(out, expected);
    assert.deepEqual(JSON.parse(findEmbeddedGraph(out).content), graph);
  });

  it("changes nothing when messy is embedded twice", () => {
    const { reportPath } = loadFixture("messy");
    const html = readFileSync(reportPath, "utf8");
    const { graph } = readGraph({ reportPath });
    const out = embedGraph(html, graph);
    assert.equal(embedGraph(out, graph), out);
  });

  it("leaves messy's bindings and prose as check reads them", () => {
    const { reportPath } = loadFixture("messy");
    const html = readFileSync(reportPath, "utf8");
    const { graph } = readGraph({ reportPath });
    const out = embedGraph(html, graph);
    const before = readPage(html);
    const after = readPage(out);
    assert.deepEqual(
      after.bindings.map((b) => [b.id, b.text]),
      before.bindings.map((b) => [b.id, b.text]),
    );
    assert.deepEqual(
      after.prose.map((p) => [p.text, p.node]),
      before.prose.map((p) => [p.text, p.node]),
    );
  });

  it("embeds broken's sidecar graph", () => {
    const { reportPath } = loadFixture("broken");
    const html = readFileSync(reportPath, "utf8");
    const { graph } = readGraph({ reportPath });
    const out = embedGraph(html, graph);
    const h = html.indexOf("</head>");
    const b = html.lastIndexOf("</body>");
    const expected =
      html.slice(0, h) +
      META +
      "\n" +
      html.slice(h, b) +
      OPEN +
      serializeForEmbed(graph) +
      "</script>\n" +
      html.slice(b);
    assert.equal(out, expected);
    assert.deepEqual(JSON.parse(findEmbeddedGraph(out).content), graph);
  });
});

describe("embedFile", () => {
  it("writes the embedded report and leaves no temp file", (t) => {
    const dir = tempDir(t);
    const { reportPath: fixtureReportPath } = loadFixture("messy");
    const html = readFileSync(fixtureReportPath, "utf8");
    const { graph } = readGraph({ reportPath: fixtureReportPath });
    const reportPath = join(dir, "paid-search-costs.html");
    writeFileSync(reportPath, html, "utf8");

    const result = embedFile(reportPath, html, graph);
    assert.equal(result, true);
    assert.equal(readFileSync(reportPath, "utf8"), embedGraph(html, graph));
    assert.deepEqual(readdirSync(dir), ["paid-search-costs.html"]);
  });

  it("does not touch the file when nothing changes", (t) => {
    const dir = tempDir(t);
    const { reportPath: fixtureReportPath } = loadFixture("clean");
    const html = readFileSync(fixtureReportPath, "utf8");
    const reportPath = join(dir, "august-retention.html");
    writeFileSync(reportPath, html, "utf8");
    utimesSync(reportPath, 1e9, 1e9);
    const { graph } = readGraph({ reportPath: fixtureReportPath });

    const result = embedFile(reportPath, html, graph);
    assert.equal(result, false);
    assert.equal(readFileSync(reportPath, "utf8"), html);
    assert.equal(statSync(reportPath).mtimeMs, 1e12);
  });

  it("leaves the file untouched when it refuses", (t) => {
    const dir = tempDir(t);
    const reportPath = join(dir, "r.html");
    const html = "<html><head></head><body><p>x</p></html>";
    writeFileSync(reportPath, html, "utf8");

    assert.throws(() => embedFile(reportPath, html, G0), failsWith(NO_BODY));
    assert.equal(readFileSync(reportPath, "utf8"), html);
    assert.deepEqual(readdirSync(dir), ["r.html"]);
  });

  it("keeps the report's permissions", (t) => {
    const dir = tempDir(t);
    const reportPath = join(dir, "r.html");
    writeFileSync(reportPath, A, "utf8");
    chmodSync(reportPath, 0o600);

    assert.equal(embedFile(reportPath, A, G0), true);
    assert.equal(statSync(reportPath).mode & 0o7777, 0o600);
  });

  it("updates the file a symlinked report points to", (t) => {
    const dir = tempDir(t);
    const target = join(dir, "real.html");
    const link = join(dir, "link.html");
    writeFileSync(target, A, "utf8");
    symlinkSync(target, link);

    assert.equal(embedFile(link, A, G0), true);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(readFileSync(target, "utf8"), embedGraph(A, G0));
    assert.deepEqual(readdirSync(dir).sort(), ["link.html", "real.html"]);
  });

  it("reports a write it could not make", (t) => {
    const dir = tempDir(t);
    const path = join(dir, "missing", "r.html");

    assert.throws(
      () => embedFile(path, A, G0),
      (error) =>
        error instanceof TraillineError &&
        error.message.startsWith(`could not write ${path}: `),
    );
    assert.deepEqual(readdirSync(dir), []);
  });
});
