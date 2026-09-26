/**
 * The mechanical half of the SQL style rules: checks that scan a query's
 * words and parentheses, never its meaning. `check` runs these over sources,
 * views and figure queries (rule C8) and over a source's own SQL for date
 * functions (rule C7). A SQL parser is deliberately out of scope; that is
 * rule C10, deferred.
 */

const KEYWORDS = new Set(
  (
    "select from where group by having order limit offset qualify join inner " +
    "left right full outer cross natural on using and or not as in is null " +
    "between like ilike case when then else end distinct union all with over " +
    "partition asc desc exists true false lateral window pivot unpivot"
  ).split(" "),
);

const JOIN_MODIFIERS =
  /(?:\b(?:left|right|inner|full|outer|cross|natural)\s+)+$/gi;

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

/** The line-start offset of the line containing `index`. */
function lineStart(code, index) {
  const nl = code.lastIndexOf("\n", index - 1);
  return nl === -1 ? 0 : nl + 1;
}

const collapse = (text) => text.replace(/\s+/g, " ").trim();

/** Escape a string for use inside a regex, so an arbitrary id cannot break it. */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The §6 mechanical style rules for one query.
 * @param {string} sql
 * @param {{ parents?: string[] }} [options]  node ids the query must name
 * @returns {{ rule: string, message: string }[]}  at most one finding per
 *   rule, in this order: select-star, lowercase, clause-per-line,
 *   column-per-line, unnamed-column, short-alias, date-function, parent-ref
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
          text: sql.slice(itemStart, i),
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

  // lowercase
  const lowercaseBad = [];
  const lowercaseSeen = new Set();
  for (const match of code.matchAll(/\b[a-z_]\w*\b/gi)) {
    if (code[match.index - 1] === ".") continue;
    const word = match[0];
    const lower = word.toLowerCase();
    if (!KEYWORDS.has(lower) || word === lower) continue;
    if (lowercaseSeen.has(word)) continue;
    lowercaseSeen.add(word);
    lowercaseBad.push(word);
  }
  if (lowercaseBad.length > 0) {
    findings.push({
      rule: "lowercase",
      message: `keywords must be lowercase: ${lowercaseBad.join(", ")}`,
    });
  }

  // clause-per-line
  const clauseBad = [];
  for (const match of clauses) {
    const start = lineStart(code, match.index);
    const before = code.slice(start, match.index).replace(JOIN_MODIFIERS, "");
    if (before.trim() === "") continue;
    clauseBad.push(collapse(match[0]));
  }
  if (clauseBad.length > 0) {
    findings.push({
      rule: "clause-per-line",
      message: `each clause starts its own line: ${clauseBad.join(", ")}`,
    });
  }

  // column-per-line
  let columnBad = false;
  for (const list of selectLists) {
    const listItems = items.filter(
      (item) => item.start >= list.start && item.end <= list.end,
    );
    if (listItems.length === 0) continue;
    for (const item of listItems) {
      const leading = item.code.match(/^\s*/)[0];
      const newLine = leading.includes("\n");
      if (listItems.length >= 2 && !newLine) columnBad = true;
      if (newLine) {
        const indent = leading.slice(leading.lastIndexOf("\n") + 1);
        if (indent.length === 0) columnBad = true;
      }
    }
  }
  if (columnBad) {
    findings.push({
      rule: "column-per-line",
      message: "put each selected column on its own line, indented",
    });
  }

  // unnamed-column
  const unnamedBad = [];
  for (const item of items) {
    const trimmed = item.code.trim();
    if (trimmed === "" || /(^|\.)\*$/.test(trimmed)) continue;
    if (/^(?:[a-z_]\w*\.)?[a-z_]\w*$/i.test(trimmed)) continue;
    if (/\sas\s+[a-z_]\w*$/i.test(trimmed)) continue;
    unnamedBad.push(collapse(item.text));
  }
  if (unnamedBad.length > 0) {
    findings.push({
      rule: "unnamed-column",
      message: `name each computed column with \`as\`: ${unnamedBad.join(", ")}`,
    });
  }

  // short-alias
  const aliasBad = new Set();
  for (const match of code.matchAll(/\bas\s+([a-z_]\w*)/gi)) {
    if (match[1].length < 3) aliasBad.add(match[1]);
  }
  for (const match of code.matchAll(
    /\b(?:from|join)[ \t]+[a-z_][\w.$]*[ \t]+([a-z_]\w*)/gi,
  )) {
    if (KEYWORDS.has(match[1].toLowerCase())) continue;
    if (match[1].length < 3) aliasBad.add(match[1]);
  }
  if (aliasBad.size > 0) {
    findings.push({
      rule: "short-alias",
      message: `aliases need at least 3 characters: ${[...aliasBad].join(", ")}`,
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
