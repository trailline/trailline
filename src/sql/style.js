/**
 * The mechanical SQL checks: no `select *`, no date functions, and parents
 * named by node id so the composed script runs. They scan a query's words and
 * parentheses, never its meaning. `check` runs them over sources, views and
 * figure queries (rule C8) and over a source's own SQL for date functions
 * (rule C7). A SQL parser is deliberately out of scope; that is rule C10,
 * deferred.
 */

const CLAUSE_PATTERN =
  /\b(select|from|where|group\s+by|having|order\s+by|limit|qualify|union|join)\b/gi;

const DATE_FUNCTION_PATTERN =
  /\b(current_date|current_timestamp|current_time|localtimestamp|localtime|sysdate|systimestamp|getdate|now)\b/gi;

/** A select item that is a star, bare or qualified, with Snowflake's modifiers. */
const STAR_PATTERN = /(^|\.)\*(\s+(exclude|replace|rename|ilike)\b[\s\S]*)?$/i;

/**
 * Blank out comments, and the contents of quoted strings and identifiers, so
 * rules can scan the code with regexes. Same length as `sql`; line breaks
 * kept; quote characters kept.
 * @param {string} sql
 * @param {{ keepStrings?: boolean }} [options]  keep single-quoted string
 *   contents (for finding date literals). Default false.
 * @returns {string}
 */
export function maskSql(sql, { keepStrings = false } = {}) {
  const out = [];
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];

    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }

    if (c === "/" && sql[i + 1] === "*") {
      out.push(" ", " ");
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) {
        out.push(sql[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < n) {
        out.push(" ", " ");
        i += 2;
      }
      continue;
    }

    if (c === "'" || c === '"') {
      const quote = c;
      const keep = keepStrings && quote === "'";
      out.push(quote);
      i++;
      while (i < n) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            out.push(keep ? quote : " ", keep ? quote : " ");
            i += 2;
            continue;
          }
          out.push(quote);
          i++;
          break;
        }
        out.push(keep ? sql[i] : sql[i] === "\n" ? "\n" : " ");
        i++;
      }
      continue;
    }

    out.push(c);
    i++;
  }

  return out.join("");
}

/**
 * Functions that read the clock instead of a literal date: current_date,
 * current_timestamp, current_time, localtimestamp, localtime, sysdate,
 * systimestamp, getdate, now. Date arithmetic over literals (`dateadd`) is
 * pinned and allowed. Whole words, any case, outside strings and comments.
 * @param {string} sql
 * @returns {string[]}  each function once, as first written, in order
 */
export function dateFunctions(sql) {
  const seen = new Set();
  const found = [];
  for (const match of maskSql(sql).matchAll(DATE_FUNCTION_PATTERN)) {
    const name = match[0].toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    found.push(match[0]);
  }
  return found;
}

/** Index of each char in `code`: paren depth before that index. */
function parenDepths(code) {
  const depths = new Array(code.length);
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === ")") depth = Math.max(0, depth - 1);
    depths[i] = depth;
    if (code[i] === "(") depth++;
  }
  return depths;
}

/** Escape a string for use inside a regex, so an arbitrary id cannot break it. */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The mechanical SQL rules for one query.
 * @param {string} sql
 * @param {{ parents?: string[] }} [options]  node ids the query must name
 * @returns {{ rule: string, message: string }[]}  at most one finding per
 *   rule, in this order: select-star, date-function, parent-ref
 */
export function checkSqlStyle(sql, { parents = [] } = {}) {
  const code = maskSql(sql);
  const depths = parenDepths(code);
  const findings = [];

  const clauses = [...code.matchAll(CLAUSE_PATTERN)];

  // select-star: split each select list, at any nesting depth, into items.
  // A list runs from its "select" (after any "distinct") to the next clause
  // at the same depth, the parenthesis that closes it, or the end.
  let star = false;
  for (const match of clauses) {
    if (match[0].toLowerCase() !== "select") continue;
    const depth = depths[match.index];
    let start = match.index + match[0].length;
    const distinct = /^\s*\bdistinct\b/i.exec(code.slice(start));
    if (distinct) start += distinct[0].length;
    const next = clauses.find(
      (m) => m.index > match.index && depths[m.index] === depth,
    );
    let end = next ? next.index : code.length;
    for (let i = start; i < end; i++) {
      if (depths[i] < depth) {
        end = i;
        break;
      }
    }

    let itemStart = start;
    for (let i = start; i <= end; i++) {
      if (i === end || (code[i] === "," && depths[i] === depth)) {
        if (STAR_PATTERN.test(code.slice(itemStart, i).trim())) star = true;
        itemStart = i + 1;
      }
    }
  }
  if (star) {
    findings.push({
      rule: "select-star",
      message: "uses select *; list the columns",
    });
  }

  // date-function
  const dates = dateFunctions(sql);
  if (dates.length > 0) {
    findings.push({
      rule: "date-function",
      message: `use literal ISO dates, not date functions: ${dates.join(", ")}`,
    });
  }

  // parent-ref
  const missingParents = parents.filter(
    (id) => !new RegExp(`\\b${escapeRegExp(id)}\\b`, "i").test(code),
  );
  if (missingParents.length > 0) {
    findings.push({
      rule: "parent-ref",
      message: `refer to parents by node id: ${missingParents.join(", ")}`,
    });
  }

  return findings;
}
