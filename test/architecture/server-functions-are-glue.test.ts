import { describe, expect, it } from "vitest";

/**
 * A server-function module cannot be mutation tested, so it must not
 * be worth testing.
 *
 * A test that imports one fails outright — `createServerFn` pulls in
 * TanStack Start's virtual entries, which only the dev/build pipeline
 * provides — so those files sit outside `stryker.conf.json`'s `mutate`
 * globs (D-41). An exclusion like that is only honest while the excluded
 * file holds nothing worth an assertion: the moment a decision moves into
 * one, it is a decision no gate can see.
 *
 * So this is the other half of the exclusion. A server-function module may
 * import, wire and delegate. It may not branch, loop, throw, or declare a
 * schema — a zod schema is a trust boundary, and trust boundaries belong in
 * `inputs.ts` next door, where a test can reach them.
 *
 * Inlined by Vite at build time via `?raw`: the workers pool sandboxes the
 * real filesystem, so `readFileSync` cannot reach these files.
 */

const sources: Record<string, string> = import.meta.glob(
  "../../src/modules/*/functions.ts",
  { query: "?raw", import: "default", eager: true },
);

/**
 * Modules whose `functions.ts` still holds more than glue. Every entry is
 * open D-41 work, and the list only ever shrinks — a stale entry fails
 * below, so it cannot be left behind once the file is cleaned.
 */
const NOT_YET_GLUE = new Set([
  // Route-file input schemas still declared inline, and (in runs) the
  // Strava OAuth CSRF state check, which is the one branch here that most
  // deserves a test.
  "auth",
  "closet",
  "feed",
  "runs",
]);

const QUOTES = new Set(['"', "'", "`"]);

function skipLineComment(source: string, start: number): number {
  let index = start;
  while (index < source.length && source.charAt(index) !== "\n") index += 1;
  return index;
}

function skipBlockComment(source: string, start: number): number {
  let index = start + 2;
  while (index < source.length) {
    if (source.charAt(index) === "*" && source.charAt(index + 1) === "/") {
      return index + 2;
    }
    index += 1;
  }
  return index;
}

function skipStringLiteral(source: string, start: number): number {
  const quote = source.charAt(start);
  let index = start + 1;
  while (index < source.length) {
    const char = source.charAt(index);
    if (char === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (char === quote) return index;
  }
  return index;
}

/**
 * Strips comments and string bodies so the scan below reads code only. A
 * regex over raw source either eats the `//` inside a URL literal or trips
 * on the word "if" in a sentence; the same reasoning as the JSONC scanner
 * in `bindings-conformance`.
 *
 * `charAt` rather than indexing: it returns "" past the end, so no step
 * needs undefined handling.
 */
function codeOnly(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const pair = source.slice(index, index + 2);
    if (pair === "//") {
      index = skipLineComment(source, index);
    } else if (pair === "/*") {
      index = skipBlockComment(source, index);
    } else if (QUOTES.has(source.charAt(index))) {
      index = skipStringLiteral(source, index);
      // A placeholder, so `case "x":` still reads as code.
      out += '""';
    } else {
      out += source.charAt(index);
      index += 1;
    }
  }
  return out;
}

const FORBIDDEN = [
  { name: "an `if`", pattern: /\bif\s*\(/ },
  { name: "a `switch`", pattern: /\bswitch\s*\(/ },
  { name: "a loop", pattern: /\b(?:for|while)\s*\(/ },
  { name: "a `try`", pattern: /\btry\s*\{/ },
  { name: "a `throw`", pattern: /\bthrow\b/ },
  { name: "a zod schema", pattern: /\bz\./ },
];

function moduleNameOf(path: string): string {
  return path.split("/").at(-2) ?? path;
}

describe("server-function modules are glue", () => {
  it("finds a functions.ts to check", () => {
    // A glob that matches nothing passes every assertion below it.
    expect(Object.keys(sources).length).toBeGreaterThan(0);
  });

  for (const [path, source] of Object.entries(sources)) {
    const moduleName = moduleNameOf(path);
    if (NOT_YET_GLUE.has(moduleName)) continue;

    it(`${moduleName}: imports, wires and delegates, nothing else`, () => {
      const code = codeOnly(source);
      for (const { name, pattern } of FORBIDDEN) {
        expect(pattern.test(code), `${path} contains ${name}`).toBe(false);
      }
    });
  }

  it("has no stale exceptions", () => {
    // The exception list is a record of work still to do. A module that is
    // already glue and still listed makes the list a lie, and the next
    // reader trusts it.
    const stillDirty = [...NOT_YET_GLUE].filter((moduleName) => {
      const entry = Object.entries(sources).find(
        ([path]) => moduleNameOf(path) === moduleName,
      );
      if (entry === undefined) return false;
      const code = codeOnly(entry[1]);
      return FORBIDDEN.some(({ pattern }) => pattern.test(code));
    });
    expect(new Set(stillDirty)).toStrictEqual(NOT_YET_GLUE);
  });
});
