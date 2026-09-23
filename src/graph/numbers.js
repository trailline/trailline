/**
 * What counts as a number in prose, for rule C2.
 *
 * C2 says every number a report states must sit inside a figure's span. That
 * only works if "number" means "a claim someone could check", not "any
 * digit". This module is that definition, on plain text; `check` decides
 * which text to feed it (prose outside figure spans, outside bound charts
 * and tables, outside ungrounded insights).
 *
 * Counts:  46.6%   $61.20   4,120   +11.8%   #1   3rd   2.5x   $2bn   12 pp
 * Exempt:  2026 (a bare year)   2026-08-01 (an ISO date)
 *          30-day, 12-month (a number hyphenated to a time unit: a metric's
 *          definition, not a claim about it)
 * Ignored: Q3, H1, FY26, B2B (digits inside a word are part of a name)
 *
 * Deliberately not exempt: "12-point gain" is a claim. "Over 30 days" is
 * ambiguous and counts; the skill tells the model to write "30-day".
 */

const ISO_DATE = /(?<![\w-])\d{4}-\d{2}-\d{2}(?![\w-])/g;

const NUMBER =
  /(?<![\w.,])[+\-−]?[$€£¥]?#?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|pp|bps)|bn|st|nd|rd|th|[xkmb])?(?![\w%])/gi;

const YEAR = /^(?:19|20)\d{2}$/;
const TIME_QUALIFIER =
  /^[-‑](?:second|minute|hour|day|week|month|quarter|year)s?\b/i;

/**
 * Every number-like token in `text`, in order, as
 * `{ text, index, exempt }` where `exempt` is null for a token C2 counts,
 * or the reason it does not: "date", "year" or "qualifier".
 */
export function findNumbers(text) {
  const tokens = [];
  const dates = [];
  for (const match of text.matchAll(ISO_DATE)) {
    dates.push([match.index, match.index + match[0].length]);
    tokens.push({ text: match[0], index: match.index, exempt: "date" });
  }
  const inDate = (index) =>
    dates.some(([start, end]) => index >= start && index < end);

  for (const match of text.matchAll(NUMBER)) {
    if (inDate(match.index)) continue;
    const token = match[0];
    const after = text.slice(match.index + token.length);
    let exempt = null;
    if (YEAR.test(token)) exempt = "year";
    else if (/^\d+$/.test(token) && TIME_QUALIFIER.test(after)) {
      exempt = "qualifier";
    }
    tokens.push({ text: token, index: match.index, exempt });
  }
  return tokens.sort((a, b) => a.index - b.index);
}

/** Only the tokens C2 counts. */
export function bareNumbers(text) {
  return findNumbers(text).filter((token) => token.exempt === null);
}
