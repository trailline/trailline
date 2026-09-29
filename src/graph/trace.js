/**
 * How far each node traces back to a SQL source. Pure: no file I/O.
 */

import { STEPS } from "./schema.js";

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNode = (node) => isObject(node) && STEPS.includes(node.step);

/**
 * @param {unknown} graph as from `readGraph` (may be malformed)
 * @returns {Map<string, "full" | "partial" | "ungrounded">} one entry per
 *   object node with a known step
 */
export function traceGraph(graph) {
  const states = new Map();
  if (!isObject(graph) || !isObject(graph.nodes)) return states;
  const nodes = graph.nodes;
  const walking = new Set();
  const resolve = (id) => {
    if (!Object.hasOwn(nodes, id) || !isNode(nodes[id])) return "partial";
    if (states.has(id)) return states.get(id);
    if (walking.has(id)) return "partial";
    walking.add(id);
    const node = nodes[id];
    let state = "partial";
    if (node.ungrounded === true) state = "ungrounded";
    else if (node.step === "source") {
      if (node.kind === "sql") state = "full";
    } else if (
      Array.isArray(node.from) &&
      node.from.length > 0 &&
      node.from.every((parent) => resolve(parent) === "full")
    ) {
      state = "full";
    }
    walking.delete(id);
    states.set(id, state);
    return state;
  };
  for (const id of Object.keys(nodes)) resolve(id);
  return states;
}
