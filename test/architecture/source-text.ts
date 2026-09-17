/**
 * Reading TypeScript source as text, for the architecture tests that cannot
 * import what they check.
 *
 * Route files and `modules/*\/functions.ts` pull TanStack Start's virtual
 * entries, so a test that imports one fails outright. The rules about them
 * are therefore checked against their source, inlined by Vite via `?raw`
 * because the workers pool sandboxes the real filesystem.
 *
 * Shared by `server-functions-are-glue` and `routes-stamp-hydration`, which
 * ask different questions of the same text. Extracted when the second one
 * arrived rather than copied — a second scanner that strips comments
 * slightly differently is two rival answers to "what counts as code".
 */

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
export function withoutComments(source: string): string {
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
export function codeOnly(source: string): string {
  return withoutComments(source).replaceAll(
    /(["'`])(?:\\.|(?!\1).)*\1/gs,
    '""',
  );
}

/**
The repo-relative path behind one of `import.meta.glob`'s keys.
*/
export function repoPath(globPath: string): string {
  return globPath.replace("../../", "");
}

/**
 * Is this the source a human wrote, or stryker's rewrite of it?
 *
 * Stryker instruments in a sandbox copy, and its instrumentation turns
 * every block statement into `if (stryMutAct_…) {} else {…}`. Vite's `?raw`
 * then inlines *that*, so a scan would find stryker's `if` rather than ours
 * and fail on a file that is perfectly good glue — which is exactly what
 * the mutation analyzer running over a changed `functions.ts` produced, as
 * a dry-run crash with no hint of the cause.
 *
 * These rules are statements about what a human wrote, so they are checked
 * against human-written source only: a mutation run skips whichever files
 * it is currently instrumenting, and every ordinary `npm test` and CI run
 * — which never instrument — scans all of them.
 *
 * `stryMutAct_` is a generated identifier no human writes, so this cannot
 * quietly disable a check on real source. `grep -r stryMutAct_ src` is the
 * one-line way to confirm that.
 */
export function isInstrumented(source: string): boolean {
  return source.includes("stryMutAct_");
}
