/**
 * The check rules that need more than one node or the page.
 * `validateGraph()` (`../graph/schema.js`) owns the per-node ones (S1–S8, C4,
 * C9). Pure: no file I/O.
 */

import { bareNumbers } from "../graph/numbers.js";
import { ExprError, exprRefs } from "../graph/expr.js";
import { STEPS } from "../graph/schema.js";
import { checkSqlStyle, dateFunctions, maskSql } from "../sql/style.js";

/** Every rule this module can raise, with its fixed severity. */
export const RULES = {
  C1: { severity: "error", title: "binding and node do not match up" },
  C2: {
    severity: "warning",
    title: "number in prose is outside a figure's span",
  },
  C3: {
    severity: "warning",
    title: "figure text does not match its display or value",
  },
  C5: {
    severity: "error",
    title: "`from` breaks the source → view → figure → insight chain",
  },
  C6: { severity: "error", title: "nodes depend on each other in a cycle" },
  C7: {
    severity: "warning",
    title: "sql source is incomplete or not pinned to its period",
  },
  C8: { severity: "warning", title: "SQL breaks the style rules" },
};

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isStringArray = (value) =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

const NUMBER_PATTERN =
  /^([+\-−])?[$€£¥]?#?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?( ?%)?$/;

/**
 * Read a figure's page text as a number, for C3's fallback.
 * @param {string} text
 * @returns {{ number: number, decimals: number, percent: boolean } | null}
 */
export function parseDisplayNumber(text) {
  const match = NUMBER_PATTERN.exec(text);
  if (!match) return null;
  const [, sign, digits, decimals, percent] = match;
  const magnitude = Number(`${digits.replace(/,/g, "")}.${decimals ?? "0"}`);
  const number = sign === "-" || sign === "−" ? -magnitude : magnitude;
  return {
    number,
    decimals: decimals ? decimals.length : 0,
    percent: Boolean(percent),
  };
}

/**
 * Run the check rules over a graph and its page.
 * @param {unknown} graph  as returned by readGraph; may be malformed
 * @param {{ bindings: {id,text,offset}[], prose: {text,node,offset}[] }} page
 * @returns {{ code, severity, node: string|null, field: string|null, message: string }[]}
 */
export function checkRules(graph, page) {
  const nodes = graph?.nodes;
  if (!isObject(nodes)) return [];

  const has = (id) => Object.hasOwn(nodes, id);
  const node = (id) => (has(id) && isObject(nodes[id]) ? nodes[id] : null);

  const issues = [];
  const report = (code, n, field, message) =>
    issues.push({
      code,
      severity: RULES[code].severity,
      node: n,
      field: field ?? null,
      message,
    });

  checkC1(nodes, has, node, page, report);
  checkC2(node, page, report);
  checkC3(nodes, node, page, report);
  checkC5(nodes, has, node, report);
  checkC6(nodes, has, report);
  checkC7(nodes, report);
  checkC8(nodes, report);

  return issues;
}

function checkC1(nodes, has, node, page, report) {
  const seen = new Set();
  for (const binding of page.bindings) {
    const id = binding.id;
    if (seen.has(id)) continue;
    if (!has(id)) {
      seen.add(id);
      report("C1", id, null, `data-trailline="${id}" resolves to no node`);
      continue;
    }
    const n = node(id);
    if (n?.step === "source") {
      seen.add(id);
      report(
        "C1",
        id,
        null,
        `\`${id}\` is a source; bind a figure over it instead`,
      );
    }
  }

  for (const [id, n] of Object.entries(nodes)) {
    if (!isObject(n)) continue;
    if (n.step !== "view" && n.step !== "figure" && n.step !== "insight")
      continue;
    const bound = page.bindings.some((b) => b.id === id);
    if (!bound) {
      report(
        "C1",
        id,
        null,
        `${n.step} is not bound to any element on the page`,
      );
    }
  }
}

function checkC2(node, page, report) {
  for (const entry of page.prose) {
    for (const token of bareNumbers(entry.text)) {
      report(
        "C2",
        entry.node,
        null,
        `bare number "${token.text}" is not inside a figure's span`,
      );
    }
  }
}

function checkC3(nodes, node, page, report) {
  const byId = new Map();
  for (const binding of page.bindings) {
    if (!byId.has(binding.id)) byId.set(binding.id, []);
    byId.get(binding.id).push(binding.text);
  }

  for (const [id, texts] of byId) {
    const n = node(id);
    if (n?.step !== "figure") continue;
    const display = typeof n.display === "string" ? n.display : null;
    const value =
      typeof n.value === "number" && Number.isFinite(n.value) ? n.value : null;
    if (display === null && value === null) continue;

    const bad = [];
    const seen = new Set();
    for (const text of texts) {
      if (text === display) continue;
      let ok = false;
      if (value !== null) {
        const parsed = parseDisplayNumber(text);
        if (parsed) {
          const s = parsed.percent ? 100 : 1;
          const slack = ((0.5 * 10 ** -parsed.decimals) / s) * (1 + 1e-9);
          if (Math.abs(parsed.number / s - value) <= slack) ok = true;
        }
      }
      if (!ok && !seen.has(text)) {
        seen.add(text);
        bad.push(text);
      }
    }
    if (bad.length > 0) {
      const quoted = bad.map((t) => `"${t}"`).join(", ");
      const against =
        display !== null ? `display is "${display}"` : `value is ${value}`;
      report("C3", id, "display", `page shows ${quoted} but ${against}`);
    }
  }
}

/** Read a node's step, or null when it is not a plain object or has an unknown step. */
function stepOf(n) {
  return isObject(n) && STEPS.includes(n.step) ? n.step : null;
}

function checkC5(nodes, has, node, report) {
  for (const [id, n] of Object.entries(nodes)) {
    if (!isObject(n)) continue;
    const step = n.step;
    if (step !== "view" && step !== "figure" && step !== "insight") continue;
    if (!isStringArray(n.from) || n.from.length === 0) continue;

    let exprIds = null;
    if (step === "figure") {
      const hasSql = n.sql !== undefined;
      const hasExpr = n.expr !== undefined;
      if (hasSql === hasExpr) continue;
      if (hasExpr) {
        if (typeof n.expr !== "string") continue;
        try {
          exprIds = exprRefs(n.expr);
        } catch (error) {
          if (!(error instanceof ExprError)) throw error;
          continue;
        }
      }
    }

    const parts = [];

    const unknown = n.from.filter((p) => !has(p));
    if (unknown.length > 0) {
      parts.push(
        `\`from\` names ${unknown.join(", ")}, which ${unknown.length > 1 ? "are not nodes" : "is not a node"}`,
      );
    }

    const knownParents = n.from
      .filter((p) => has(p))
      .map((p) => ({ id: p, step: stepOf(node(p)) }))
      .filter((p) => p.step !== null);

    if (knownParents.length > 0) {
      let ok;
      let message;
      if (step === "view") {
        ok =
          knownParents.every((p) => p.step === "source") ||
          (knownParents.length === 1 && knownParents[0].step === "view");
        message = "a view rests on sources, or on exactly one view";
      } else if (step === "figure" && exprIds === null) {
        ok = knownParents.length === 1 && knownParents[0].step === "view";
        message = "a figure with `sql` rests on exactly one view or source";
        if (knownParents.length === 1 && knownParents[0].step === "source")
          ok = true;
      } else if (step === "figure") {
        ok = knownParents.every((p) => p.step === "figure");
        message = "a figure with `expr` rests on figures only";
      } else {
        ok = knownParents.every(
          (p) => p.step === "figure" || p.step === "insight",
        );
        message = "an insight rests on figures and insights only";
      }
      if (!ok) parts.push(message);
    }

    if (step === "figure" && exprIds !== null) {
      const missing = exprIds.filter((r) => !n.from.includes(r));
      if (missing.length > 0) {
        parts.push(
          `\`expr\` uses ${missing.join(", ")}, which ${missing.length > 1 ? "are not in `from`" : "is not in `from`"}`,
        );
      }
    }

    if (parts.length > 0) {
      report("C5", id, "from", parts.join("; "));
    }
  }
}

function checkC6(nodes, has, report) {
  const edges = (id) => {
    const n = nodes[id];
    if (!isObject(n) || !isStringArray(n.from)) return [];
    return n.from.filter((p) => has(p));
  };

  const keyOrder = Object.keys(nodes);
  const indexOf = new Map(keyOrder.map((id, i) => [id, i]));
  const state = new Map(); // 0 = visiting, 1 = done
  const stack = [];
  const stackSet = new Set();
  const reportedSets = new Set();

  const visit = (id) => {
    state.set(id, 0);
    stack.push(id);
    stackSet.add(id);
    for (const next of edges(id)) {
      if (stackSet.has(next)) {
        const cycleStart = stack.indexOf(next);
        const cycle = stack.slice(cycleStart);
        const memberSet = [...cycle].sort().join(",");
        if (!reportedSets.has(memberSet)) {
          reportedSets.add(memberSet);
          let firstIndex = 0;
          for (let i = 1; i < cycle.length; i++) {
            if (indexOf.get(cycle[i]) < indexOf.get(cycle[firstIndex]))
              firstIndex = i;
          }
          const rotated = [
            ...cycle.slice(firstIndex),
            ...cycle.slice(0, firstIndex),
          ];
          report(
            "C6",
            rotated[0],
            "from",
            `cycle ${[...rotated, rotated[0]].join(" -> ")}`,
          );
        }
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    stackSet.delete(id);
    state.set(id, 1);
  };

  for (const id of keyOrder) {
    if (!state.has(id)) visit(id);
  }
}

function checkC7(nodes, report) {
  for (const [id, n] of Object.entries(nodes)) {
    if (!isObject(n) || n.step !== "source" || n.kind !== "sql") continue;

    const parts = [];
    const missing = ["mart", "period", "sql", "columns"].filter(
      (field) => n[field] === undefined,
    );
    if (missing.length > 0) {
      parts.push(`sql source is missing \`${missing.join("`, `")}\``);
    }

    if (typeof n.sql === "string") {
      if (
        isObject(n.period) &&
        typeof n.period.from === "string" &&
        typeof n.period.to === "string"
      ) {
        const masked = maskSql(n.sql, { keepStrings: true });
        const dates = [...new Set([n.period.from, n.period.to])];
        const missingDates = dates.filter(
          (date) => !masked.includes(`'${date}'`),
        );
        if (missingDates.length > 0) {
          parts.push(
            `SQL does not contain the period as literal dates: ${missingDates.map((d) => `'${d}'`).join(", ")}`,
          );
        }
      }
      const dates = dateFunctions(n.sql);
      if (dates.length > 0) {
        parts.push(`SQL uses date functions: ${dates.join(", ")}`);
      }
    }

    if (parts.length > 0) report("C7", id, null, parts.join("; "));
  }
}

function checkC8(nodes, report) {
  for (const [id, n] of Object.entries(nodes)) {
    if (!isObject(n)) continue;
    const isSource = n.step === "source" && n.kind === "sql";
    const isViewOrFigure = n.step === "view" || n.step === "figure";
    if (!isSource && !isViewOrFigure) continue;
    if (typeof n.sql !== "string" || n.sql.trim() === "") continue;

    const parents = isViewOrFigure && isStringArray(n.from) ? n.from : [];
    let findings = checkSqlStyle(n.sql, { parents });
    if (isSource) findings = findings.filter((f) => f.rule !== "date-function");

    if (findings.length > 0) {
      report(
        "C8",
        id,
        "sql",
        `SQL style: ${findings.map((f) => f.message).join("; ")}`,
      );
    }
  }
}
