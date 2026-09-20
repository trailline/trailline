import * as check from "./check.js";
import * as source from "./source.js";
import * as sql from "./sql.js";
import * as view from "./view.js";

/**
 * The four commands of the MVP, in the order they appear in help. Adding a
 * fifth is a product decision, not a refactor: see the MVP technical spec.
 */
export const commands = [source, check, view, sql];

export const byName = new Map(commands.map((c) => [c.name, c]));
