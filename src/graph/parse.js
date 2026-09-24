/**
 * Finding and reading a report's lineage graph.
 *
 * A graph lives in one of two places:
 *
 *   sidecar   .trailline/<report-stem>.json beside the report. The model
 *             writes this during the build; it is the working copy.
 *   embedded  <script type="application/trailline+json"> inside the report.
 *             `check` writes this; it is what travels when the file is sent.
 *
 * Both hold the same object. When both exist the sidecar wins, because a
 * build in progress has not been re-embedded yet.
 *
 * The HTML is scanned as text, not parsed: the graph block is the one element
 * Trailline owns, and `check` will replace it in place using the offsets
 * returned here, without reserializing anything else in the page.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";

import { TraillineError } from "../errors.js";
import { findDuplicateKeys } from "./duplicates.js";

export const GRAPH_MIME = "application/trailline+json";
export const GRAPH_ELEMENT_ID = "trailline-graph";
export const SIDECAR_DIR = ".trailline";

/** `reports/aug.html` → `reports/.trailline/aug.json`. The report need not exist. */
export function sidecarPath(reportPath) {
  const stem = basename(reportPath, extname(reportPath));
  return join(dirname(reportPath), SIDECAR_DIR, `${stem}.json`);
}

const OPEN_SCRIPT = /<script\b[^>]*>/gi;
// HTML ends a script element only at `</script` followed by whitespace, `/`,
// `>` or the end of input, so `</scripture>` inside the JSON does not close it.
const CLOSE_SCRIPT = /<\/script(?=[\s/>]|$)/gi;
const TYPE_ATTR =
  /\stype\s*=\s*(["']?)application\/trailline\+json\1(?=[\s/>]|$)/i;

/**
 * Locate the embedded graph block in an HTML string. Returns null when there
 * is none, or `{ start, end, contentStart, contentEnd, content }` where
 * start..end spans the whole element and contentStart..contentEnd its JSON.
 * Throws when the page holds more than one block, since then it is unclear
 * which one is the report's lineage.
 */
export function findEmbeddedGraph(html) {
  const blocks = [];
  for (const match of html.matchAll(OPEN_SCRIPT)) {
    if (!TYPE_ATTR.test(match[0])) continue;
    const contentStart = match.index + match[0].length;
    CLOSE_SCRIPT.lastIndex = contentStart;
    const contentEnd = CLOSE_SCRIPT.exec(html)?.index ?? -1;
    if (contentEnd === -1) {
      throw new TraillineError(
        `the embedded lineage graph at ${lineCol(html, match.index)} is never closed with </script>`,
      );
    }
    const closeEnd = html.indexOf(">", contentEnd);
    blocks.push({
      start: match.index,
      end: closeEnd === -1 ? html.length : closeEnd + 1,
      contentStart,
      contentEnd,
      content: html.slice(contentStart, contentEnd),
    });
  }
  if (blocks.length > 1) {
    const where = blocks.map((b) => lineCol(html, b.start)).join(", ");
    throw new TraillineError(
      `the report holds ${blocks.length} embedded lineage graphs (at ${where}); expected one`,
    );
  }
  return blocks[0] ?? null;
}

/**
 * Turn a graph into the text that goes inside the embedded <script>. Every
 * `<` is escaped so that SQL containing `</script>` or `<!--` cannot end the
 * block early; JSON.parse reads the escape back as the same character.
 */
export function serializeForEmbed(graph) {
  return JSON.stringify(graph, null, 2).replace(/</g, "\\u003c");
}

/**
 * Parse graph JSON, turning a syntax error into one that names the file and
 * the line and column. `offset` is where `text` starts inside `source`, so
 * positions inside an embedded block are reported as positions in the page.
 * A key repeated within one object is also an error: JSON.parse would keep
 * the second and silently drop the first, losing a node or a field.
 */
export function parseGraphText(text, { label, source = text, offset = 0 }) {
  let graph;
  try {
    graph = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const position = /\bposition (\d+)/.exec(error.message);
    const where = position
      ? ` at ${lineCol(source, offset + Number(position[1]))}`
      : "";
    const reason = error.message.replace(
      /\s*(in JSON )?at position \d+.*$/,
      "",
    );
    throw new TraillineError(`${label} is not valid JSON${where}: ${reason}`);
  }

  const duplicates = findDuplicateKeys(text);
  if (duplicates.length > 0) {
    const lines = duplicates.map(
      ({ path, first, second }) =>
        `  \`${path}\` at ${lineOf(source, offset + first)} and ${lineOf(source, offset + second)}`,
    );
    throw new TraillineError(
      `${label} defines the same key twice, so the first would be silently dropped:\n${lines.join("\n")}`,
    );
  }
  return graph;
}

/**
 * Read a report's graph. With `graphPath`, read exactly that file. Otherwise
 * try the sidecar, then the block embedded in the report. Returns
 * `{ graph, origin: "file" | "sidecar" | "embedded", path }`.
 */
export function readGraph({ reportPath, graphPath } = {}) {
  if (graphPath) {
    return { graph: readJsonFile(graphPath), origin: "file", path: graphPath };
  }
  if (!reportPath) {
    throw new TraillineError("no report or graph file given");
  }

  const sidecar = sidecarPath(reportPath);
  if (existsSync(sidecar)) {
    return { graph: readJsonFile(sidecar), origin: "sidecar", path: sidecar };
  }

  const html = readText(reportPath, "report");
  const block = findEmbeddedGraph(html);
  if (!block) {
    throw new TraillineError(
      `no lineage graph found for ${display(reportPath)}. Looked for ` +
        `${display(sidecar)} and a <script type="${GRAPH_MIME}"> block in the report.`,
    );
  }
  const graph = parseGraphText(block.content, {
    label: `the lineage graph embedded in ${display(reportPath)}`,
    source: html,
    offset: block.contentStart,
  });
  return { graph, origin: "embedded", path: reportPath };
}

function readJsonFile(path) {
  return parseGraphText(readText(path, "graph file"), { label: display(path) });
}

function readText(path, what) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new TraillineError(`${what} not found: ${display(path)}`);
    }
    throw new TraillineError(
      `could not read ${display(path)}: ${error.message}`,
    );
  }
}

function display(path) {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
}

function lineOf(text, index) {
  return lineCol(text, index).replace(/, column \d+$/, "");
}

function lineCol(text, index) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return `line ${line}, column ${index - lineStart + 1}`;
}
