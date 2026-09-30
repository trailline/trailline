import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { traceGraph } from "../src/graph/trace.js";

const G = (nodes) => ({ trailline: "1.0", nodes });
const src = { step: "source", kind: "sql" };
const ext = { step: "source", kind: "external", ref: "targets.csv" };
const view = { step: "view", from: ["q1"] };
const fig = { step: "figure", from: ["v1"] };
const ins = { step: "insight", from: ["f1"] };
const loose = (step, extra) => ({ step, from: [], ungrounded: true, ...extra });
const states = (graph) => Object.fromEntries(traceGraph(graph));

describe("traceGraph", () => {
  it("returns nothing for an empty graph", () => {
    assert.deepEqual(states(G({})), {});
  });

  it("marks a sql source full and an external source partial", () => {
    assert.deepEqual(states(G({ q1: src, x1: ext })), {
      q1: "full",
      x1: "partial",
    });
  });

  it("marks a chain that ends at a sql source full", () => {
    assert.deepEqual(states(G({ q1: src, v1: view, f1: fig, i1: ins })), {
      q1: "full",
      v1: "full",
      f1: "full",
      i1: "full",
    });
  });

  it("does not depend on the order nodes are listed in", () => {
    assert.deepEqual(states(G({ i1: ins, f1: fig, v1: view, q1: src })), {
      i1: "full",
      f1: "full",
      v1: "full",
      q1: "full",
    });
  });

  it("marks a node partial when its path reaches an external source", () => {
    assert.deepEqual(
      states(G({ x1: ext, f1: { step: "figure", from: ["x1"] }, i1: ins })),
      { x1: "partial", f1: "partial", i1: "partial" },
    );
  });

  it("needs every path to end at a sql source to be full", () => {
    const graph = G({
      q1: src,
      v1: view,
      f1: fig,
      x1: ext,
      f2: { step: "figure", from: ["x1"] },
      f3: { step: "figure", from: ["f1", "f2"] },
    });
    assert.deepEqual(states(graph), {
      q1: "full",
      v1: "full",
      f1: "full",
      x1: "partial",
      f2: "partial",
      f3: "partial",
    });
  });

  it("marks a node that says ungrounded as ungrounded, whatever its parents", () => {
    const graph = G({
      q1: src,
      v1: view,
      f1: loose("figure"),
      i1: { step: "insight", from: ["v1"], ungrounded: true },
    });
    const result = states(graph);
    assert.equal(result.f1, "ungrounded");
    assert.equal(result.i1, "ungrounded");
  });

  it("marks a node partial when its path reaches an ungrounded node", () => {
    const graph = G({
      f1: loose("figure"),
      f2: { step: "figure", from: ["f1"] },
      i1: loose("insight", { text: "a" }),
      i2: { step: "insight", from: ["i1"] },
    });
    assert.deepEqual(states(graph), {
      f1: "ungrounded",
      f2: "partial",
      i1: "ungrounded",
      i2: "partial",
    });
  });

  it("follows insights that rest on insights", () => {
    const graph = G({
      q1: src,
      v1: view,
      f1: fig,
      i1: ins,
      i2: { step: "insight", from: ["i1"] },
      i3: { step: "insight", from: ["i2", "f1"] },
    });
    const result = states(graph);
    assert.deepEqual(
      [result.i1, result.i2, result.i3],
      ["full", "full", "full"],
    );
  });

  it("marks nodes in or above a cycle partial, and stops", () => {
    const nodes = {
      q1: src,
      v1: view,
      f1: fig,
      f3: { step: "figure", from: ["f4", "f1"] },
      f4: { step: "figure", from: ["f3"] },
      f5: { step: "figure", from: ["f3"] },
      f6: { step: "figure", from: ["f6"] },
    };
    const expected = {
      f1: "full",
      f3: "partial",
      f4: "partial",
      f5: "partial",
      f6: "partial",
    };
    // same nodes, `f4` listed before `f3`
    const reordered = {
      q1: src,
      v1: view,
      f1: fig,
      f4: nodes.f4,
      f3: nodes.f3,
      f5: nodes.f5,
      f6: nodes.f6,
    };
    for (const graph of [G(nodes), G(reordered)]) {
      const result = states(graph);
      for (const [id, state] of Object.entries(expected)) {
        assert.equal(result[id], state, id);
      }
    }
  });

  it("marks a path that ends nowhere partial", () => {
    const graph = G({
      f1: { step: "figure", from: ["nope"] },
      m1: { step: "metric" },
      f2: { step: "figure", from: ["m1"] },
      i1: { step: "insight", from: [] },
      i2: { step: "insight", from: "f1" },
      x9: { step: "source" },
    });
    assert.deepEqual(states(graph), {
      f1: "partial",
      f2: "partial",
      i1: "partial",
      i2: "partial",
      x9: "partial",
    });
  });

  it("leaves out nodes with an unknown step and nodes that are not objects", () => {
    const graph = G({ m1: { step: "metric" }, n1: null, n2: [1], q1: src });
    assert.deepEqual(states(graph), { q1: "full" });
    assert.deepEqual(traceGraph(null), new Map());
    assert.deepEqual(traceGraph(G("x")), new Map());
  });
});
