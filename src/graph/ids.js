/**
 * Node ids double as table names in the composed script (`from v1`), so they
 * must be plain SQL identifiers: lowercase, starting with a letter.
 */
export const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The conventional first letter for each kind of node. A mismatch is only a
 * warning: the id still works, it just reads worse in the viewer and script.
 */
export function expectedPrefix(node) {
  switch (node.step) {
    case "source":
      return node.kind === "external" ? "x" : "q";
    case "view":
      return "v";
    case "figure":
      return "f";
    case "insight":
      return "i";
    default:
      return null;
  }
}
