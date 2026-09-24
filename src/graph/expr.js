/**
 * The figure expression language: arithmetic over other figures.
 *
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/") unary)*
 *   unary   := "-" unary | primary
 *   primary := number | id | call | "(" expr ")"
 *   call    := ("abs" | "round") "(" expr ("," expr)* ")"
 *
 * Deliberately nothing else. Ranks and shares are window-function columns in
 * a view, picked by a SQL figure, so the vocabulary never needs to know what
 * a view is. `round` takes an optional second argument, the number of
 * decimal places, which must be a whole-number literal.
 */

import { ID_PATTERN } from "./ids.js";

const FUNCTIONS = {
  abs: { min: 1, max: 1 },
  round: { min: 1, max: 2 },
};

export class ExprError extends Error {
  constructor(message, position) {
    super(message);
    this.name = "ExprError";
    this.position = position;
  }
}

function tokenize(source) {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(.))/y;
  let match;
  while (pattern.lastIndex < source.length) {
    const start = pattern.lastIndex;
    match = pattern.exec(source);
    if (!match) break;
    const [whole, number, word, symbol] = match;
    const position = start + whole.length - whole.trimStart().length;
    if (number !== undefined) {
      tokens.push({ type: "number", value: Number(number), position });
    } else if (word !== undefined) {
      tokens.push({ type: "word", value: word, position });
    } else if (symbol !== undefined) {
      if (!"+-*/(),".includes(symbol)) {
        throw new ExprError(`unexpected \`${symbol}\``, position);
      }
      tokens.push({ type: symbol, position });
    }
  }
  tokens.push({ type: "end", position: source.length });
  return tokens;
}

/**
 * Parse an expression into a small tree:
 *   { type: "number", value }
 *   { type: "ref", id }
 *   { type: "neg", arg }
 *   { type: "binary", op, left, right }
 *   { type: "call", name, args }
 * Throws ExprError with a character position on anything outside the grammar.
 */
export function parseExpr(source) {
  if (typeof source !== "string" || source.trim() === "") {
    throw new ExprError("expression is empty", 0);
  }
  const tokens = tokenize(source);
  let index = 0;

  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const expect = (type, what) => {
    const token = take();
    if (token.type !== type) {
      throw new ExprError(`expected ${what}`, token.position);
    }
    return token;
  };

  function expr() {
    let left = term();
    while (peek().type === "+" || peek().type === "-") {
      const op = take().type;
      left = { type: "binary", op, left, right: term() };
    }
    return left;
  }

  function term() {
    let left = unary();
    while (peek().type === "*" || peek().type === "/") {
      const op = take().type;
      left = { type: "binary", op, left, right: unary() };
    }
    return left;
  }

  function unary() {
    if (peek().type === "-") {
      take();
      return { type: "neg", arg: unary() };
    }
    return primary();
  }

  function primary() {
    const token = take();
    if (token.type === "number") {
      return { type: "number", value: token.value };
    }
    if (token.type === "(") {
      const inner = expr();
      expect(")", "`)`");
      return inner;
    }
    if (token.type === "word") {
      if (peek().type === "(") return call(token);
      if (!ID_PATTERN.test(token.value)) {
        throw new ExprError(
          `\`${token.value}\` is not a node id (ids are lowercase)`,
          token.position,
        );
      }
      return { type: "ref", id: token.value };
    }
    if (token.type === "end") {
      throw new ExprError("expression ends too early", token.position);
    }
    throw new ExprError(`unexpected \`${token.type}\``, token.position);
  }

  function call(nameToken) {
    const name = nameToken.value;
    const arity = FUNCTIONS[name];
    if (!arity) {
      const known = Object.keys(FUNCTIONS).join(", ");
      throw new ExprError(
        `unknown function \`${name}\` (allowed: ${known})`,
        nameToken.position,
      );
    }
    take(); // "("
    const args = [expr()];
    while (peek().type === ",") {
      take();
      args.push(expr());
    }
    expect(")", "`)` or `,`");
    if (args.length < arity.min || args.length > arity.max) {
      const wanted =
        arity.min === arity.max
          ? `${arity.min}`
          : `${arity.min} or ${arity.max}`;
      throw new ExprError(
        `\`${name}\` takes ${wanted} argument${arity.max === 1 ? "" : "s"}, got ${args.length}`,
        nameToken.position,
      );
    }
    if (
      name === "round" &&
      args[1] &&
      !(args[1].type === "number" && Number.isInteger(args[1].value))
    ) {
      throw new ExprError(
        "`round` places must be a whole-number literal",
        nameToken.position,
      );
    }
    return { type: "call", name, args };
  }

  const tree = expr();
  const rest = peek();
  if (rest.type !== "end") {
    throw new ExprError(
      `unexpected \`${rest.value ?? rest.type}\``,
      rest.position,
    );
  }
  return tree;
}

/** The distinct node ids an expression refers to, in first-seen order. */
export function exprRefs(source) {
  const seen = new Set();
  const walk = (node) => {
    if (node.type === "ref") seen.add(node.id);
    else if (node.type === "neg") walk(node.arg);
    else if (node.type === "binary") {
      walk(node.left);
      walk(node.right);
    } else if (node.type === "call") node.args.forEach(walk);
  };
  walk(parseExpr(source));
  return [...seen];
}
