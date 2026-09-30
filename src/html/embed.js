/**
 * Embedding a lineage graph into a report.
 *
 * This is the one place `check` changes a user's file. It edits by string
 * surgery (inserts and in-place replacements), never reserializes the page,
 * and writes via a temp file and a rename.
 */

import {
  chmodSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { TraillineError } from "../errors.js";
import {
  GRAPH_ELEMENT_ID,
  GRAPH_MIME,
  findEmbeddedGraph,
  serializeForEmbed,
} from "../graph/parse.js";

const META_TAG = '<meta name="trailline" content="1.0">';
const OPEN_TAG = `<script type="${GRAPH_MIME}" id="${GRAPH_ELEMENT_ID}">`;

const BODY_CLOSE = /<\/body\s*>/gi;
const HEAD_CLOSE = /<\/head\s*>/gi;
const META_OPEN = /<meta\b[^>]*>/gi;
const TRAILLINE_NAME = /\sname\s*=\s*(["']?)trailline\1(?=[\s/>]|$)/i;

/**
 * Put `graph` into `html`: the trailline meta tag in <head> and the graph
 * block before </body>, each replacing an existing one where it stands.
 * Returns the new HTML; returns `html` unchanged when both are already current.
 * Throws TraillineError when the page has no </body> or no </head>, or when
 * findEmbeddedGraph() rejects it (two blocks, an unclosed block).
 * @param {string} html
 * @param {object} graph  embedded as written; nothing is added to it
 * @returns {string}
 */
export function embedGraph(html, graph) {
  // Found first so that lookalike text inside an existing (unescaped)
  // block's JSON never gets mistaken for a real </body>, </head> or
  // trailline <meta>: those matches are ignored when they fall inside it.
  const block = findEmbeddedGraph(html);
  const insideBlock = (index) =>
    block !== null && index >= block.start && index < block.end;

  let bodyEnd = -1;
  for (const match of html.matchAll(BODY_CLOSE)) {
    if (insideBlock(match.index)) continue;
    bodyEnd = match.index;
  }
  if (bodyEnd === -1) {
    throw new TraillineError(
      "the report has no </body> tag, so the lineage graph was not embedded",
    );
  }

  let headEnd = -1;
  for (const match of html.matchAll(HEAD_CLOSE)) {
    if (insideBlock(match.index)) continue;
    headEnd = match.index;
    break;
  }
  if (headEnd === -1) {
    throw new TraillineError(
      "the report has no </head> tag, so the lineage graph was not embedded",
    );
  }

  const blockText = `${OPEN_TAG}${serializeForEmbed(graph)}</script>`;

  const edits = [];
  if (block) {
    edits.push({ start: block.start, end: block.end, text: blockText });
  } else {
    edits.push({ start: bodyEnd, end: bodyEnd, text: `${blockText}\n` });
  }

  let metaEdit = null;
  for (const match of html.slice(0, headEnd).matchAll(META_OPEN)) {
    if (insideBlock(match.index)) continue;
    if (TRAILLINE_NAME.test(match[0])) {
      metaEdit = { start: match.index, end: match.index + match[0].length };
      break;
    }
  }
  if (metaEdit) {
    edits.push({ start: metaEdit.start, end: metaEdit.end, text: META_TAG });
  } else {
    edits.push({ start: headEnd, end: headEnd, text: `${META_TAG}\n` });
  }

  edits.sort((a, b) => b.start - a.start);

  let out = html;
  for (const edit of edits) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/**
 * Embed `graph` into the report at `reportPath`, whose current text is
 * `html`. Writes only when the text changes, through a temp file and a
 * rename, so a crash cannot leave a half-written report. A symlinked report
 * is resolved first, so the file it points to is the one updated and the
 * link stays a link; the new file keeps the report's permissions.
 * @returns {boolean} true when the file was written
 */
export function embedFile(reportPath, html, graph) {
  const next = embedGraph(html, graph);
  if (next === html) return false;

  let temp = null;
  try {
    const target = realpathSync(reportPath);
    const mode = statSync(target).mode & 0o7777;
    temp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
    writeFileSync(temp, next, { encoding: "utf8", mode });
    // The umask may have narrowed `mode` on create; set it exactly.
    chmodSync(temp, mode);
    renameSync(temp, target);
  } catch (error) {
    if (temp !== null) {
      try {
        unlinkSync(temp);
      } catch {
        // best effort
      }
    }
    throw new TraillineError(`could not write ${reportPath}: ${error.message}`);
  }
  return true;
}
