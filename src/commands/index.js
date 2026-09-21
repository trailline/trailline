import * as check from "./check.js";
import * as source from "./source.js";
import * as sql from "./sql.js";
import * as view from "./view.js";

export const commands = [source, check, view, sql];

export const byName = new Map(commands.map((c) => [c.name, c]));
