import { describe, expect, it } from "vitest";

import strykerConfig from "../../stryker.conf.json?raw";

/**
 * A module file that imports `@tanstack/react-start` cannot be mutation
 * tested, so it must not be worth testing.
 *
 * A test that imports one fails outright — `createServerFn` and
 * `getRequestHeaders` pull in TanStack Start's virtual entries, which only
 * the dev/build pipeline provides — so those files sit outside
 * `stryker.conf.json`'s `mutate` globs, named by a `!` negation (D-41). An
 * exclusion like that is only honest while the excluded file holds nothing
 * worth an assertion: the moment a decision moves into one, it is a
 * decision no gate can see.
 *
 * So this is the other half of the exclusion, and it checks it from both
 * ends. Such a file may import, wire and delegate; it may not branch, loop,
 * throw, or declare a schema — a zod schema is a trust boundary, and trust
 * boundaries belong in `inputs.ts` next door where a test can reach them.
 * And the set of files excluded in the config has to be exactly the set
 * that cannot be tested, so neither list can drift from the other.
 *
 * Inlined by Vite at build time via `?raw`: the workers pool sandboxes the
 * real filesystem, so `readFileSync` cannot reach these files.
 */

const sources: Record<string, string> = import.meta.glob(
  "../../src/modules/**/*.ts",
  { query: "?raw", import: "default", eager: true },
);

/**
 * The same files, lazily. Whether one can be imported is the real question
 * — a regex over import specifiers gets the direct cases and misses the
 * transitive ones, and `auth/index.ts` is exactly that: it holds no
 * TanStack import of its own and re-exports `require-user`, which does.
 */
const loaders: Record<string, () => Promise<unknown>> = import.meta.glob(
  "../../src/modules/**/*.ts",
);

/**
 * Files that import TanStack Start and still hold more than glue. Every
 * entry is open D-41 work, and the list only ever shrinks — a stale entry
 * fails below, so it cannot be left behind once the file is cleaned.
 */
const NOT_YET_GLUE = new Set<string>();

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

function endOfStringLiteral(source: string, start: number): number {
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
 * Source with comments removed and strings kept. A regex over raw source
 * finds "@tanstack/react-start" in the paragraph explaining why a file
 * avoids it — which is how three files that import nothing of the sort
 * ended up looking like they did.
 *
 * `charAt` rather than indexing: it returns "" past the end, so no step
 * needs undefined handling.
 */
function withoutComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const pair = source.slice(index, index + 2);
    if (pair === "//") {
      index = skipLineComment(source, index);
    } else if (pair === "/*") {
      index = skipBlockComment(source, index);
    } else if (QUOTES.has(source.charAt(index))) {
      const end = endOfStringLiteral(source, index);
      out += source.slice(index, end);
      index = end;
    } else {
      out += source.charAt(index);
      index += 1;
    }
  }
  return out;
}

/**
Code with the string bodies blanked too, so `case "x":` still reads as code.
*/
function codeOnly(source: string): string {
  return withoutComments(source).replaceAll(
    /(["'`])(?:\\.|(?!\1).)*\1/gs,
    '""',
  );
}

const FORBIDDEN = [
  { name: "an `if`", pattern: /\bif\s*\(/ },
  { name: "a `switch`", pattern: /\bswitch\s*\(/ },
  { name: "a loop", pattern: /\b(?:for|while)\s*\(/ },
  { name: "a `try`", pattern: /\btry\s*\{/ },
  { name: "a `throw`", pattern: /\bthrow\b/ },
  { name: "a zod schema", pattern: /\bz\./ },
];

function repoPath(globPath: string): string {
  return globPath.replace("../../", "");
}

function rawSource(path: string): string {
  const entry = Object.entries(sources).find(
    ([globPath]) => repoPath(globPath) === path,
  );
  return entry?.[1] ?? "";
}

/**
 * Is this the source a human wrote, or stryker's rewrite of it?
 *
 * Stryker instruments in a sandbox copy, and its instrumentation turns
 * every block statement into `if (stryMutAct_…) {} else {…}`. Vite's `?raw`
 * then inlines *that*, so a scan below would find stryker's `if` rather
 * than ours and fail on a file that is perfectly good glue — which is
 * exactly what the mutation analyzer running over a changed `functions.ts`
 * produced, as a dry-run crash with no hint of the cause.
 *
 * The rule is a statement about what a human wrote, so it is checked
 * against human-written source only: a mutation run skips whichever files
 * it is currently instrumenting, and every ordinary `npm test` and CI run
 * — which never instrument — scans all of them.
 *
 * `stryMutAct_` is a generated identifier no human writes, so this cannot
 * quietly disable the check on real source. `grep -r stryMutAct_ src` is
 * the one-line way to confirm that.
 */
function isInstrumented(source: string): boolean {
  return source.includes("stryMutAct_");
}

/**
Every module file a test cannot import, asked by importing it.
*/
async function findUntestable(): Promise<string[]> {
  const failures: string[] = [];
  for (const [globPath, load] of Object.entries(loaders)) {
    try {
      await load();
    } catch {
      failures.push(repoPath(globPath));
    }
  }
  return failures;
}

const untestable = await findUntestable();

const scannable = untestable.filter((path) => !isInstrumented(rawSource(path)));

function isGlue(path: string): boolean {
  const code = codeOnly(rawSource(path));
  return FORBIDDEN.every(({ pattern }) => !pattern.test(code));
}

describe("files that cannot be mutation tested are glue", () => {
  it("finds some", () => {
    // A detector that matches nothing passes every assertion below it.
    expect(untestable.length).toBeGreaterThan(0);
  });

  for (const path of scannable) {
    if (NOT_YET_GLUE.has(path)) continue;

    it(`${path}: imports, wires and delegates, nothing else`, () => {
      const code = codeOnly(rawSource(path));
      for (const { name, pattern } of FORBIDDEN) {
        expect(pattern.test(code), `${path} contains ${name}`).toBe(false);
      }
    });
  }

  it("has no stale exceptions", () => {
    // The exception list is a record of work still to do. A file that is
    // already glue and still listed makes the list a lie, and the next
    // reader trusts it.
    const stillDirty = new Set(scannable.filter((path) => !isGlue(path)));
    expect(stillDirty).toStrictEqual(
      new Set([...NOT_YET_GLUE].filter((path) => scannable.includes(path))),
    );
  });
});

/**
 * The `!path` entries in `stryker.conf.json`'s `mutate` array, which is
 * where a file is actually excluded.
 */
const negations = Array.from(
  strykerConfig.matchAll(/!(src\/[\w./-]+\.ts)/g),
  (match) => match[1] ?? "",
);

describe("the mutate exclusions and the untestable files are the same set", () => {
  it("excludes nothing that could have been tested", () => {
    // The direction that matters most: an exclusion without a cause is a
    // file quietly opted out of the gate.
    for (const path of negations) {
      expect(untestable, `${path} is excluded but is testable`).toContain(path);
    }
  });

  it("excludes every untestable file inside a ratcheted scope", () => {
    // A scope entry names its module; anything untestable under a module
    // that has been paid down has to be named in that entry, or the shard
    // fails on mutants nothing can kill.
    const ratchetedModules = Array.from(
      strykerConfig.matchAll(/"(src\/modules\/([\w-]+))\/\*\*/g),
      (match) => match[1] ?? "",
    );

    for (const modulePath of ratchetedModules) {
      const inScope = untestable.filter((path) =>
        path.startsWith(`${modulePath}/`),
      );
      for (const path of inScope) {
        expect(negations, `${path} is untestable and not excluded`).toContain(
          path,
        );
      }
    }
  });
});
