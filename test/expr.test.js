import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ExprError, exprRefs, parseExpr } from "../src/graph/expr.js";

const ref = (id) => ({ type: "ref", id });
const num = (value) => ({ type: "number", value });

describe("parseExpr", () => {
  it("reads the percentage-change shape", () => {
    assert.deepEqual(parseExpr("(f1 - f2) / f2"), {
      type: "binary",
      op: "/",
      left: { type: "binary", op: "-", left: ref("f1"), right: ref("f2") },
      right: ref("f2"),
    });
  });

  it("binds * and / tighter than + and -", () => {
    assert.deepEqual(parseExpr("f1 + f2 * 100"), {
      type: "binary",
      op: "+",
      left: ref("f1"),
      right: { type: "binary", op: "*", left: ref("f2"), right: num(100) },
    });
  });

  it("is left-associative", () => {
    assert.deepEqual(parseExpr("f1 - f2 - f3"), {
      type: "binary",
      op: "-",
      left: { type: "binary", op: "-", left: ref("f1"), right: ref("f2") },
      right: ref("f3"),
    });
  });

  it("reads unary minus, decimals and whitespace-free input", () => {
    assert.deepEqual(parseExpr("-f1*.5"), {
      type: "binary",
      op: "*",
      left: { type: "neg", arg: ref("f1") },
      right: num(0.5),
    });
  });

  it("reads abs and round with optional places", () => {
    assert.deepEqual(parseExpr("round(abs(f1 - f2), 3)"), {
      type: "call",
      name: "round",
      args: [
        {
          type: "call",
          name: "abs",
          args: [
            { type: "binary", op: "-", left: ref("f1"), right: ref("f2") },
          ],
        },
        num(3),
      ],
    });
    assert.equal(parseExpr("round(f1)").args.length, 1);
  });

  const rejects = {
    "an operator outside the language": ["f1 ^ 2", /unexpected `\^`/],
    "the dropped rank_of": ["rank_of(f1)", /unknown function `rank_of`/],
    "an uppercase id": ["F1 + f2", /not a node id/],
    "an empty string": ["   ", /empty/],
    "a dangling operator": ["f1 +", /ends too early/],
    "an unclosed paren": ["(f1 + f2", /expected `\)`/],
    "two operands in a row": ["f1 f2", /unexpected `f2`/],
    "abs with two arguments": ["abs(f1, f2)", /takes 1 argument, got 2/],
    "round with three arguments": ["round(f1, 1, 2)", /takes 1 or 2 arguments/],
    "round places that are not a literal": ["round(f1, f2)", /whole-number/],
    "fractional round places": ["round(f1, 1.5)", /whole-number/],
  };
  for (const [what, [source, message]] of Object.entries(rejects)) {
    it(`rejects ${what}`, () => {
      assert.throws(
        () => parseExpr(source),
        (error) => error instanceof ExprError && message.test(error.message),
      );
    });
  }

  it("points at the offending character", () => {
    assert.throws(
      () => parseExpr("f1 ^ 2"),
      (error) => error.position === 3,
    );
  });
});

describe("exprRefs", () => {
  it("lists each referenced id once, in order", () => {
    assert.deepEqual(exprRefs("(f3 - f1) / f1 + round(f2, 1)"), [
      "f3",
      "f1",
      "f2",
    ]);
  });

  it("returns nothing for a constant", () => {
    assert.deepEqual(exprRefs("100 * 2"), []);
  });
});
