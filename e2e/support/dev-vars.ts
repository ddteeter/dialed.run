import { readFileSync } from "node:fs";

/**
 * One value of the dev server's `.dev.vars` (CI's e2e job writes it;
 * `.dev.vars.example` locally), for a stand-in that has to answer as the
 * server would: Find's stand-in stamps its place with `BETTER_AUTH_SECRET`.
 * Throws when the file or the line is missing, since a stand-in built on
 * a guess fails later and less clearly.
 */
export function devVar(name: string): string {
  const prefix = `${name}=`;
  const line = readFileSync(".dev.vars", "utf8")
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (line === undefined) throw new Error(`.dev.vars has no ${name}`);
  return line.slice(prefix.length).replace(/^"(.*)"$/u, "$1");
}
