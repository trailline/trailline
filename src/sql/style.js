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

const DATE_FUNCTION_PATTERN = /\b(current_date|dateadd|getdate|now)\b/gi;

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
 * Date functions used instead of literal dates: current_date, dateadd,
 * getdate, now. Whole words, any case, outside strings and comments.
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

  const clauses = [...code.matchAll(CLAUSE_PATTERN)].filter(
    (match) => depths[match.index] === 0,
  );

  // select lists: from after each "select" clause (skipping "distinct") to
  // the next clause or end of code.
  const selectLists = [];
  for (const match of clauses) {
    if (match[0].toLowerCase() !== "select") continue;
    let start = match.index + match[0].length;
    const distinct = /\s*\bdistinct\b/i.exec(code.slice(start));
    if (distinct && distinct.index === 0) start += distinct[0].length;
    const next = clauses.find((m) => m.index > match.index);
    const end = next ? next.index : code.length;
    selectLists.push({ start, end, text: sql.slice(start, end) });
  }

  const items = [];
  for (const list of selectLists) {
    let depth0 = 0;
    let itemStart = list.start;
    for (let i = list.start; i <= list.end; i++) {
      if (i < list.end && code[i] === "(") depth0++;
      else if (i < list.end && code[i] === ")") depth0--;
      if (i === list.end || (code[i] === "," && depth0 === 0)) {
        items.push({
          start: itemStart,
          end: i,
          code: code.slice(itemStart, i),
        });
        itemStart = i + 1;
      }
    }
  }

  // select-star
  const stars = items.filter((item) => /(^|\.)\*\s*$/.test(item.code.trim()));
  if (stars.length > 0) {
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
