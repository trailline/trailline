/**
 * The lineage graph's shape, checked one node at a time.
 *
 * This is the format contract (technical spec §3) written as plain code
 * rather than a JSON Schema file, so it needs no validator dependency and its
 * messages can talk like a person. It only looks at nodes one by one. Rules
 * that need several nodes (chain shape, cycles) or the HTML (bindings, bare
 * numbers) live with `trailline check`.
 *
 * The split in severity follows one idea: an error means the graph cannot be
 * read or composed as written; a warning means it can, but something a
 * reviewer would want is missing.
 */

import { ExprError, parseExpr } from "./expr.js";
import { expectedPrefix, ID_PATTERN } from "./ids.js";

export const FORMAT_MAJOR = 1;

export const STEPS = ["source", "view", "figure", "insight"];

/** Every rule this module can raise, with its fixed severity. */
export const RULES = {
  S1: { severity: "error", title: "graph header is malformed" },
  S2: { severity: "error", title: "node id is not a valid identifier" },
  S3: { severity: "error", title: "node step is missing or unknown" },
  S4: { severity: "error", title: "field is missing or has the wrong type" },
  S5: { severity: "warning", title: "unknown field" },
  S6: { severity: "warning", title: "node id prefix does not match its step" },
  S7: { severity: "warning", title: "descriptive field is missing" },
  S8: { severity: "error", title: "figure expression cannot be read" },
  C4: {
    severity: "error",
    title: "node has no parents and is not marked ungrounded",
  },
  C9: {
    severity: "error",
    title: "figure needs exactly one of `sql` or `expr`",
  },
};

const MAX_ROWS = 10;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const HEADER_FIELDS = new Set([
  "trailline",
  "report_id",
  "built_at",
  "builder_tool",
  "nodes",
  // Reserved for the review gate (technical spec §14). Accepted, unread.
  "signature",
]);

const COMMON_FIELDS = ["step", "transform"];
const DERIVED_FIELDS = [...COMMON_FIELDS, "from", "ungrounded"];

const FIELDS = {
  sql: new Set([
    ...COMMON_FIELDS,
    "kind",
    "how",
    "mart",
    "period",
    "sql",
    "columns",
    "rows",
  ]),
  external: new Set([
    ...COMMON_FIELDS,
    "kind",
    "type",
    "ref",
    "given",
    "columns",
    "rows",
  ]),
  view: new Set([...DERIVED_FIELDS, "sql", "columns", "encoding", "rows"]),
  figure: new Set([
    ...DERIVED_FIELDS,
    "sql",
    "expr",
    "value",
    "display",
    "label",
  ]),
  insight: new Set([...DERIVED_FIELDS, "text"]),
};

const ENCODING_FIELDS = new Set(["x", "y", "series", "visual"]);

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value) => typeof value === "string";
const isNonEmptyString = (value) => isString(value) && value.trim() !== "";
const isStringArray = (value) => Array.isArray(value) && value.every(isString);

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return `a ${typeof value}`;
}

/**
 * Validate a parsed graph. Never throws on bad input; returns a flat list of
 * issues, each `{ code, severity, node, field, message }`. `node` is null for
 * header problems. An empty list means the shape is sound.
 */
export function validateGraph(graph) {
  const issues = [];
  const report = (code, node, field, message) =>
    issues.push({
      code,
      severity: RULES[code].severity,
      node,
      field: field ?? null,
      message,
    });

  if (!isObject(graph)) {
    report("S1", null, null, `graph must be an object, got ${describe(graph)}`);
    return issues;
  }

  checkHeader(graph, report);
  if (!isObject(graph.nodes)) return issues;

  for (const [id, node] of Object.entries(graph.nodes)) {
    checkNode(id, node, report);
  }
  return issues;
}

function checkHeader(graph, report) {
  const version = graph.trailline;
  if (version === undefined) {
    report("S1", null, "trailline", "missing `trailline` format version");
  } else if (!isString(version) || !/^\d+\.\d+$/.test(version)) {
    report(
      "S1",
      null,
      "trailline",
      `\`trailline\` must be a version string like "1.0", got ${JSON.stringify(version)}`,
    );
  } else if (Number(version.split(".")[0]) !== FORMAT_MAJOR) {
    report(
      "S1",
      null,
      "trailline",
      `format version ${version} is not supported; this build reads ${FORMAT_MAJOR}.x`,
    );
  }

  if (!isObject(graph.nodes)) {
    report(
      "S1",
      null,
      "nodes",
      graph.nodes === undefined
        ? "missing `nodes`"
        : `\`nodes\` must be an object keyed by id, got ${describe(graph.nodes)}`,
    );
  }

  for (const field of ["report_id", "builder_tool"]) {
    if (graph[field] !== undefined && !isNonEmptyString(graph[field])) {
      report("S1", null, field, `\`${field}\` must be a non-empty string`);
    }
  }
  if (
    graph.built_at !== undefined &&
    !(isString(graph.built_at) && !Number.isNaN(Date.parse(graph.built_at)))
  ) {
    report("S1", null, "built_at", "`built_at` must be an ISO timestamp");
  }

  for (const field of Object.keys(graph)) {
    if (!HEADER_FIELDS.has(field)) {
      report("S5", null, field, `unknown top-level field \`${field}\``);
    }
  }
}

function checkNode(id, node, report) {
  if (!ID_PATTERN.test(id)) {
    report(
      "S2",
      id,
      null,
      `\`${id}\` is not a valid id: use lowercase letters, digits and _, starting with a letter`,
    );
  }

  if (!isObject(node)) {
    report("S4", id, null, `node must be an object, got ${describe(node)}`);
    return;
  }

  if (!STEPS.includes(node.step)) {
    report(
      "S3",
      id,
      "step",
      node.step === undefined
        ? "missing `step`"
        : `unknown step ${JSON.stringify(node.step)}; expected one of ${STEPS.join(", ")}`,
    );
    return;
  }

  // Everything below knows the step. Missing and mistyped fields get S4;
  // they are what makes a node unreadable or uncomposable.
  const need = (field, test, what) => {
    if (node[field] === undefined) {
      report("S4", id, field, `${node.step} is missing \`${field}\``);
      return false;
    }
    if (!test(node[field])) {
      report("S4", id, field, `\`${field}\` must be ${what}`);
      return false;
    }
    return true;
  };
  const may = (field, test, what) => {
    if (node[field] !== undefined && !test(node[field])) {
      report("S4", id, field, `\`${field}\` must be ${what}`);
    }
  };
  const want = (field, what) => {
    if (node[field] === undefined) {
      report("S7", id, field, `${node.step} has no \`${field}\` (${what})`);
    }
  };

  may("transform", isString, "a string");

  let allowed;
  if (node.step === "source") {
    allowed = checkSource(node, need, may, want);
  } else {
    allowed = FIELDS[node.step];
    checkDerived(id, node, need, may, report);
    if (node.step === "view") checkView(node, need, may, want);
    if (node.step === "figure") checkFigure(id, node, may, want, report);
    if (node.step === "insight")
      need("text", isNonEmptyString, "the claim, as text");
  }

  if (allowed) {
    for (const field of Object.keys(node)) {
      if (!allowed.has(field)) {
        report("S5", id, field, `unknown field \`${field}\` on a ${node.step}`);
      }
    }
  }

  const prefix = expectedPrefix(node);
  if (prefix && ID_PATTERN.test(id) && !id.startsWith(prefix)) {
    report(
      "S6",
      id,
      null,
      `${describeKind(node)} ids conventionally start with \`${prefix}\`, e.g. ${prefix}1`,
    );
  }
}

function describeKind(node) {
  if (node.step === "source") {
    return node.kind === "external" ? "external source" : "sql source";
  }
  return node.step;
}

/** Returns the allowed field set, or null when `kind` is unknown. */
function checkSource(node, need, may, want) {
  if (
    !need("kind", (k) => k === "sql" || k === "external", '"sql" or "external"')
  ) {
    return null;
  }
  may("columns", isStringArray, "a list of column names");
  may(
    "rows",
    isRows,
    `columnar rows: { column: [values] }, at most ${MAX_ROWS} each`,
  );

  if (node.kind === "sql") {
    // mart, period, sql and columns are all expected on a sql source, but
    // their absence is rule C7, which `check` reports. Here only their types.
    may(
      "how",
      (h) => h === "captured" || h === "reported",
      '"captured" or "reported"',
    );
    may("mart", isNonEmptyString, "a mart name");
    may("sql", isNonEmptyString, "the query as text");
    may(
      "period",
      isPeriod,
      'an object like { "from": "2026-01-01", "to": "2026-08-31" }',
    );
    return FIELDS.sql;
  }

  may("type", isString, "a string");
  may("ref", isString, "a string");
  may("given", isString, "a string");
  want("type", "what kind of thing it is, e.g. csv");
  want("ref", "how a reader can find it");
  want("given", "what the model was handed, in words");
  return FIELDS.external;
}

function checkDerived(id, node, need, may, report) {
  may("ungrounded", (u) => typeof u === "boolean", "true or false");
  if (!need("from", isStringArray, "a list of node ids")) return;
  if (node.from.length === 0 && node.ungrounded !== true) {
    report(
      "C4",
      id,
      "from",
      "`from` is empty; list the parents, or set `ungrounded: true` if there are none",
    );
  }
}

function checkView(node, need, may, want) {
  if (node.ungrounded === true)
    may("sql", isNonEmptyString, "the query as text");
  else need("sql", isNonEmptyString, "the query as text");
  may("columns", isStringArray, "a list of column names");
  may(
    "rows",
    isRows,
    `columnar rows: { column: [values] }, at most ${MAX_ROWS} each`,
  );
  may(
    "encoding",
    isEncoding,
    "an object with any of x, y, series, visual as strings",
  );
  want("columns", "the output column names");
}

function checkFigure(id, node, may, want, report) {
  may(
    "value",
    (v) => v === null || typeof v === "number" || isString(v),
    "a number or a string",
  );
  may("display", isString, "the text exactly as shown on the page");
  may("label", isString, "a string");
  may("sql", isNonEmptyString, "a query returning one cell");
  may("expr", isNonEmptyString, "arithmetic over figure ids");

  const hasSql = node.sql !== undefined;
  const hasExpr = node.expr !== undefined;
  if (hasSql && hasExpr) {
    report(
      "C9",
      id,
      null,
      "figure has both `sql` and `expr`; keep exactly one",
    );
  } else if (!hasSql && !hasExpr && node.ungrounded !== true) {
    report(
      "C9",
      id,
      null,
      "figure has neither `sql` nor `expr`; add one, or set `ungrounded: true`",
    );
  }

  if (hasExpr && isNonEmptyString(node.expr)) {
    try {
      parseExpr(node.expr);
    } catch (error) {
      if (!(error instanceof ExprError)) throw error;
      report(
        "S8",
        id,
        "expr",
        `cannot read \`${node.expr}\` at character ${error.position + 1}: ${error.message}`,
      );
    }
  }

  want("value", "the number or name the page shows");
  want("display", "the text exactly as shown on the page");
  want("label", "what the number is, in words");
}

function isPeriod(value) {
  return (
    isObject(value) &&
    Object.keys(value).every((k) => k === "from" || k === "to") &&
    isIsoDate(value.from) &&
    isIsoDate(value.to) &&
    value.from <= value.to
  );
}

function isIsoDate(value) {
  if (!isString(value) || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function isRows(value) {
  if (value === null) return true;
  if (!isObject(value)) return false;
  const lengths = Object.values(value).map((column) =>
    Array.isArray(column) ? column.length : -1,
  );
  return (
    lengths.every((n) => n >= 0 && n <= MAX_ROWS) &&
    lengths.every((n) => n === lengths[0])
  );
}

function isEncoding(value) {
  return (
    isObject(value) &&
    Object.entries(value).every(
      ([key, field]) => ENCODING_FIELDS.has(key) && isString(field),
    )
  );
}
