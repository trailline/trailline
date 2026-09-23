import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bareNumbers, findNumbers } from "../src/graph/numbers.js";

const counted = (text) => bareNumbers(text).map((token) => token.text);
const exemptions = (text) =>
  findNumbers(text)
    .filter((token) => token.exempt)
    .map((token) => `${token.text}:${token.exempt}`);

describe("findNumbers: counted", () => {
  const cases = {
    "a percentage": ["rose to 46.6% in August", ["46.6%"]],
    "a signed change": ["up +11.8% on July", ["+11.8%"]],
    "a negative": ["fell -3.2% on July", ["-3.2%"]],
    "a unicode minus": ["fell −3.2% on July", ["−3.2%"]],
    "currency with cents": ["cost $61.20 per customer", ["$61.20"]],
    "other currencies": ["€40 and £35", ["€40", "£35"]],
    "thousands separators": ["on 1,240 new customers", ["1,240"]],
    "a rank": ["ranked #1 of four", ["#1"]],
    ordinals: ["came 3rd, then 22nd", ["3rd", "22nd"]],
    multipliers: ["grew 2.5x", ["2.5x"]],
    "scale suffixes": ["$2bn, 40k, 3m", ["$2bn", "40k", "3m"]],
    "percentage points": ["up 12 pp and 40bps", ["12 pp", "40bps"]],
    "a plain count": ["the 4 channels", ["4"]],
    "both ends of a range": ["between 10–20%", ["10", "20%"]],
    "a claim hyphenated to a non-time word": ["a 12-point gain", ["12"]],
    "a number followed by a spaced time unit": ["over 30 days", ["30"]],
    "a year-sized value only when decorated": [
      "2026 customers or $2026",
      ["$2026"],
    ],
  };
  for (const [what, [text, expected]] of Object.entries(cases)) {
    it(what, () => {
      assert.deepEqual(counted(text), expected);
    });
  }
});

describe("findNumbers: exempt or ignored", () => {
  it("exempts a bare year", () => {
    assert.deepEqual(counted("Growth review · August 2026"), []);
    assert.deepEqual(exemptions("August 2026"), ["2026:year"]);
  });

  it("exempts an ISO date as one token", () => {
    assert.deepEqual(exemptions("cohort_month = 2026-08-01"), [
      "2026-08-01:date",
    ]);
    assert.deepEqual(counted("cohort_month = 2026-08-01"), []);
  });

  it("exempts a number hyphenated to a time unit", () => {
    for (const text of [
      "30-day retention",
      "12-month churn",
      "a 7-days window",
      "3-year LTV",
      "the 24‑hour peak",
    ]) {
      assert.deepEqual(counted(text), [], text);
    }
    assert.deepEqual(exemptions("30-day retention"), ["30:qualifier"]);
  });

  it("does not exempt a decorated number before a time unit", () => {
    assert.deepEqual(counted("$30-day passes"), ["$30"]);
  });

  it("ignores digits inside words", () => {
    assert.deepEqual(findNumbers("Q3 targets, H1, FY26, B2B, covid19"), []);
  });

  it("finds nothing in words for numbers", () => {
    assert.deepEqual(findNumbers("ranked first of the four channels"), []);
  });
});

describe("the clean fixture's unbound text", () => {
  // Everything outside figure spans, charts and tables in august-retention.html.
  it("has no counted numbers", () => {
    for (const text of [
      "Growth review · August 2026",
      "30-day retention by acquisition channel, cohorts from January to August 2026",
      "Paid social 30-day retention rose to  in August, up  on July's , and ranked  of the four channels.",
      "Retention is the 30-day active rate of each signup cohort: customers still active a month after signup, over customers in the cohort.",
    ]) {
      assert.deepEqual(counted(text), [], text);
    }
  });
});
