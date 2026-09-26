/**
 * Read the parts of a report that `check` looks at.
 *
 * A report is read into two flat lists, in document order:
 *
 *   bindings  every element carrying `data-trailline`, however deep or
 *             hidden, for C1 (unknown/invalid ids) and C3 (missing bindings).
 *   prose     every visible text run, tagged with the id of its nearest
 *             bound ancestor (or `null` when unbound), for C2 (bare
 *             numbers).
 *
 * The HTML is only ever read here, never written back: `check` edits a
 * report with string surgery over the raw bytes, using the offsets this
 * module returns, so parsing it into a tree and reserializing would risk
 * changing bytes the report's author never touched.
 */

import { parse } from "node-html-parser";

const HIDDEN_TAGS = new Set([
  "head",
  "script",
  "style",
  "noscript",
  "template",
]);

const clean = (s) => s.replace(/\s+/g, " ").trim();

/**
 * Read a report's bindings and prose.
 *
 * @param {string} html  the report, as read from disk
 * @param {{ skip?: (id: string) => boolean }} [options]
 *   skip(id) true: leave that bound element's text, and everything inside
 *   it, out of `prose`. Default: skip nothing.
 * @returns {{
 *   bindings: { id: string, text: string, offset: number }[],
 *   prose: { text: string, node: string | null, offset: number }[],
 * }}
 */
export function readPage(html, { skip = () => false } = {}) {
  const root = parse(html, {
    comment: false,
    blockTextElements: { script: true, style: true, noscript: true },
  });

  const bindings = [];
  const prose = [];

  const walk = (el, node, hidden) => {
    for (const child of el.childNodes) {
      if (child.nodeType === 1) {
        let childNode = node;
        let childHidden = hidden;
        if (child.hasAttribute("data-trailline")) {
          const id = child.getAttribute("data-trailline") ?? "";
          bindings.push({
            id,
            text: clean(child.textContent),
            offset: child.range[0],
          });
          childNode = id;
          if (skip(id)) childHidden = true;
        }
        if (HIDDEN_TAGS.has(child.rawTagName.toLowerCase())) {
          childHidden = true;
        }
        walk(child, childNode, childHidden);
      } else if (child.nodeType === 3) {
        if (hidden) continue;
        if (child.rawText.startsWith("<!")) continue;
        const text = clean(child.text);
        if (text === "") continue;
        prose.push({ text, node, offset: child.range[0] });
      }
    }
  };

  walk(root, null, false);

  return { bindings, prose };
}

/**
 * The skip predicate C2 uses: text counts only when it is unbound or its
 * nearest binding is a grounded insight.
 *
 * @param {unknown} graph  as returned by readGraph; may be malformed
 * @returns {(id: string) => boolean}
 */
export function proseSkip(graph) {
  const nodes = graph?.nodes;
  if (nodes === null || typeof nodes !== "object" || Array.isArray(nodes)) {
    return () => true;
  }
  return (id) => {
    const n = Object.hasOwn(nodes, id) ? nodes[id] : null;
    return !(n?.step === "insight" && n.ungrounded !== true);
  };
}
