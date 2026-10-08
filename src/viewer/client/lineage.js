/**
 * The viewer's logic with no page in it: chain layout, trace state, titles,
 * wording, SQL highlighting, the summary and what the copy buttons copy. An
 * ES module with no imports, so the page and the tests load the same file.
 */

/** The trace state of a node, or "ungrounded" for an id not in the graph. */
export function nodeState(data, id) {
  if (!data.graph.nodes[id]) return "ungrounded";
  return data.trace[id] || "partial";
}

/** A short plain-text name for a node. */
export function title(graph, id) {
  const node = graph.nodes[id];
  if (!node) return "Not in the graph";
  if (node.step === "figure") return node.label;
  if (node.step === "view") {
    return leadingComment(node.sql) || node.encoding?.visual || "view";
  }
  if (node.step === "insight") return node.text;
  return node.kind === "sql" ? node.mart : node.ref;
}

/** The text of a SQL script's first line when it is a `--` comment. */
function leadingComment(sql) {
  const match = /^\s*--\s*(.+)/.exec(sql || "");
  return match ? match[1].trim() : "";
}

/** A node's parents; a `from` that is not a list (check's S4) has none. */
const parentsOf = (graph, x) => {
  const from = graph.nodes[x]?.from;
  return Array.isArray(from) ? from : [];
};

/**
 * The chain under `id` in beats, the clicked node's beat first.
 * @returns {{ n: number, ids: string[] }[]}
 */
export function beats(graph, id) {
  const chain = new Set();
  const walk = (x) => {
    if (chain.has(x)) return;
    chain.add(x);
    for (const parent of parentsOf(graph, x)) walk(parent);
  };
  walk(id);
  // A node is one above its tallest parent. Placing 0 before reading the
  // parents makes a cycle end instead of looping.
  const heights = {};
  const height = (x) => {
    if (heights[x] !== undefined) return heights[x];
    heights[x] = 0;
    const parents = parentsOf(graph, x);
    return (heights[x] = parents.length
      ? 1 + Math.max(...parents.map(height))
      : 0);
  };
  const order = Object.keys(graph.nodes);
  // Ids the graph does not know sort after the ones it does.
  const rank = (x) => (order.includes(x) ? order.indexOf(x) : order.length);
  const found = [];
  for (let k = height(id); k >= 0; k--) {
    const ids = [...chain].filter((x) => height(x) === k);
    ids.sort((a, b) => rank(a) - rank(b));
    if (ids.length) found.push(ids);
  }
  return found.map((ids, k) => ({ n: found.length - k, ids }));
}

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** Escaped text with `backticked` parts shown as code. */
const codeify = (text) =>
  escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");

/** What one `; `-separated part of a C7 message means. */
function c7Part(part) {
  if (part.startsWith("sql source is missing"))
    return "No columns are recorded.";
  if (part.startsWith("SQL does not contain")) {
    return "The SQL doesn't use the recorded period as fixed dates.";
  }
  const used = /uses date functions: (.*)/.exec(part);
  if (!used) return codeify(part);
  const [, functions] = used;
  return `It uses <code>${escapeHtml(functions)}</code>, so re-running it gives different numbers.`;
}

/**
 * One check issue in the reviewer's words.
 * @returns {{ tone: "stop" | "warn" | "note", html: string }}
 */
export function reviewerWording(issue) {
  if (issue.severity === "error") {
    return { tone: "stop", html: codeify(issue.message) };
  }
  if (issue.code === "C3") {
    const read = /page shows "(.*)" but display is "(.*)"/.exec(issue.message);
    if (!read) return { tone: "stop", html: codeify(issue.message) };
    const [, page, display] = read;
    return {
      tone: "stop",
      html: `The page shows <b>${escapeHtml(page)}</b>, but the lineage records <b>${escapeHtml(display)}</b>.`,
    };
  }
  if (issue.code === "C2") {
    const read = /bare number "(.*)"/.exec(issue.message);
    if (!read) return { tone: "warn", html: codeify(issue.message) };
    const [, number] = read;
    return {
      tone: "warn",
      html: `<b>${escapeHtml(number)}</b> in this sentence isn't bound to any figure, so it has no lineage.`,
    };
  }
  if (issue.code === "C7") {
    const parts = issue.message.split("; ").map(c7Part);
    return { tone: "warn", html: `Dates aren't pinned. ${parts.join(" ")}` };
  }
  return { tone: "note", html: `For the builder: ${codeify(issue.message)}` };
}

const KEYWORDS =
  /^(select|from|where|and|or|not|group|by|order|join|left|inner|on|as|sum|count|avg|min|max|rank|over|partition|desc|asc|limit|between|in|with|union|all|case|when|then|else|end|null|is|distinct|having|dateadd|current_date)$/i;

/** SQL as HTML, with keywords, strings, comments and numbers in spans. */
export function highlightSql(sql) {
  return sql
    .split(/('(?:[^']|'')*'|--[^\n]*|\b\w+\b)/)
    .map((token, k) => {
      if (k % 2 === 0) return escapeHtml(token);
      if (token.startsWith("'")) {
        return `<span class="str">${escapeHtml(token)}</span>`;
      }
      if (token.startsWith("--")) {
        return `<span class="cm">${escapeHtml(token)}</span>`;
      }
      if (/^\d+$/.test(token)) return `<span class="num">${token}</span>`;
      return KEYWORDS.test(token) ? `<span class="kw">${token}</span>` : token;
    })
    .join("");
}

// The warnings a reviewer can act on, and the name each goes by.
const REVIEWER_TAGS = {
  C2: "Number not bound",
  C3: "Page differs from lineage",
  C7: "Dates not pinned",
};

/**
 * What the summary asks the reviewer to look at, and the builder's own notes.
 * @returns {{ items: { node: string, swatch: string, tone: string, tag: string, html: string }[], notes: object[] }}
 */
export function needsAttention(summary) {
  const errors = summary.issues
    .filter((found) => found.severity === "error")
    .map((found) => ({
      node: found.node,
      swatch: "stopw",
      tone: "stop",
      tag: `${found.code} · Error`,
      html: reviewerWording(found).html,
    }));
  const items = summary.ungrounded.map(({ node, text }) => ({
    node,
    swatch: "ungrounded",
    tone: "stop",
    tag: "Nothing behind it",
    html: escapeHtml(text),
  }));
  const notes = [];
  for (const found of summary.issues) {
    if (found.severity === "error") continue;
    if (!(found.code in REVIEWER_TAGS)) {
      notes.push(found);
      continue;
    }
    const { tone, html } = reviewerWording(found);
    items.push({
      node: found.node,
      swatch: tone === "stop" ? "stopw" : "warn",
      tone,
      tag: `${found.code} · ${REVIEWER_TAGS[found.code]}`,
      html: html.replace("Dates aren't pinned. ", ""),
    });
  }
  items.push(
    ...summary.external.map(({ node, ref }) => ({
      node,
      swatch: "partial",
      tone: "ext",
      tag: "External source",
      html: `${escapeHtml(ref)}. Trailline can't see inside it.`,
    })),
  );
  const rank = { stop: 0, warn: 1, ext: 2 };
  items.sort((a, b) => rank[a.tone] - rank[b.tone]);
  return { items: [...errors, ...items], notes };
}

/**
 * The summary's headline and the line under it, as plain text.
 * @returns {{ lede: string, sub: string }}
 */
export function overview(data) {
  if (data.refused !== null) {
    const errors = data.summary.issues.filter((i) => i.severity === "error");
    return {
      lede: `This report does not pass check: ${errors.length} ${errors.length === 1 ? "error" : "errors"}.`,
      sub: "The lineage shows as far as it goes. Copying SQL is off until the errors are fixed.",
    };
  }
  const states = Object.entries(data.graph.nodes)
    .filter(([, node]) => node.step === "figure" || node.step === "insight")
    .map(([id]) => nodeState(data, id));
  const count = (state) => states.filter((s) => s === state).length;
  const traced = count("full");
  if (traced === states.length) {
    return {
      lede: `All ${states.length} numbers and claims trace back to SQL.`,
      sub: "Click any of them in the report to see how it was computed.",
    };
  }
  const external = count("partial");
  const bare = count("ungrounded");
  const sub = [];
  if (external) {
    sub.push(
      `${external === 1 ? "1 rests" : `${external} rest`} on an external source.`,
    );
  }
  if (bare) {
    sub.push(
      `${bare === 1 ? "1 has" : `${bare} have`} nothing recorded behind ${bare === 1 ? "it" : "them"}.`,
    );
  }
  return {
    lede: `${traced} of ${states.length} numbers and claims trace back to SQL.`,
    sub: sub.join(" "),
  };
}

/**
 * What a copy button copies. Exactly one of `sql` and `reason` is null: a
 * report that fails check copies nothing, and says why.
 * @returns {{ sql: string | null, reason: string | null }}
 */
function copyable(data, sql) {
  if (data.refused !== null) return { sql: null, reason: data.refused };
  if (!sql) return { sql: null, reason: "Nothing here to run" };
  return { sql, reason: null };
}

/** The whole report composed into one script. */
export function reportSql(data) {
  return copyable(data, data.composedReport);
}

/** The script behind one node and everything it rests on. */
export function chainSql(data, id) {
  return copyable(data, data.composed[id]);
}

/** One step's own SQL. */
export function stepSql(data, id) {
  return copyable(data, data.graph.nodes[id].sql);
}
