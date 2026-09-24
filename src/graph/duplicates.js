/**
 * Find keys that appear twice in the same JSON object.
 *
 * JSON.parse keeps the last of two equal keys and drops the first without a
 * word. In a graph the model writes by hand, a repeated node id or field is
 * an easy slip, and the silent loss of a node is the worst way to find out.
 * This scans text JSON.parse has already accepted, so it can assume the
 * input is well formed and only needs to track where it is.
 *
 * Returns `[{ path, first, second }]`: `path` like "nodes.f3" or
 * "nodes.f3.sql", and the character offsets of both occurrences.
 */
export function findDuplicateKeys(text) {
  const duplicates = [];
  const stack = [];
  // The key or index a new container will be stored under in its parent.
  const childPath = () => {
    const top = stack[stack.length - 1];
    if (!top) return [];
    return [...top.path, top.object ? top.key : top.index];
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const top = stack[stack.length - 1];

    if (char === "{" || char === "[") {
      stack.push({
        object: char === "{",
        path: childPath(),
        keys: new Map(),
        expectKey: true,
        key: null,
        index: 0,
      });
      i++;
    } else if (char === "}" || char === "]") {
      stack.pop();
      i++;
    } else if (char === ":") {
      top.expectKey = false;
      i++;
    } else if (char === ",") {
      if (top.object) top.expectKey = true;
      else top.index++;
      i++;
    } else if (char === '"') {
      const end = stringEnd(text, i);
      if (top?.object && top.expectKey) {
        const key = JSON.parse(text.slice(i, end));
        if (top.keys.has(key)) {
          duplicates.push({
            path: [...top.path, key].join("."),
            first: top.keys.get(key),
            second: i,
          });
        } else {
          top.keys.set(key, i);
        }
        top.key = key;
      }
      i = end;
    } else {
      i++;
    }
  }
  return duplicates;
}

/** Offset just past the closing quote of the string starting at `start`. */
function stringEnd(text, start) {
  let i = start + 1;
  while (text[i] !== '"') {
    i += text[i] === "\\" ? 2 : 1;
  }
  return i + 1;
}
