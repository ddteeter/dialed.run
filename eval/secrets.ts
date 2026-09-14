import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Keys for the eval, read from `.dev.vars`.
 *
 * The eval runs on a laptop rather than in a Worker, so there are no
 * bindings to read — and `.dev.vars` is already where this repo keeps local
 * secrets and already gitignored. Read, never written or echoed: the value
 * goes straight into an `authorization` header.
 */

const DEV_VARS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".dev.vars");

export function secret(name: string): string {
  if (!existsSync(DEV_VARS)) {
    throw new Error(`.dev.vars not found; ${name} is needed to run the eval`);
  }
  for (const line of readFileSync(DEV_VARS, "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at === -1 || line.slice(0, at).trim() !== name) continue;
    const value = unquoted(line.slice(at + 1).trim());
    if (value !== "") return value;
  }
  throw new Error(`${name} is not set in .dev.vars`);
}

/**
A value written with surrounding double quotes, without them.
*/
function unquoted(value: string): string {
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1)
    : value;
}
