import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * Every `createServerFn` names its method (review of PR #140).
 *
 * TanStack's default is `GET` (`start-client-core`'s `createServerFn`),
 * and a gate once read the method as "is this a write", believing the
 * default was `POST`. The gate no longer reads it (`auth/terms-gate.ts`),
 * but a method left to the default is still a decision nobody made: what
 * the browser caches, what a link prefetch may call, what a replayed
 * request does. So every server function says which it is.
 *
 * Read as text, because a `functions.ts` cannot be imported by a test
 * (`server-functions-are-glue` says why). Comments are stripped first, so
 * a sentence about `createServerFn()` is not a call.
 */
const sources: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "!../../src/routeTree.gen.ts"],
  { query: "?raw", import: "default", eager: true },
);

const CALL = "createServerFn(";

/**
 * The argument text of each `createServerFn(` call in `code`: everything
 * up to its matching close parenthesis.
 */
function callArguments(code: string): string[] {
  const found: string[] = [];
  let at = code.indexOf(CALL);
  while (at !== -1) {
    const start = at + CALL.length;
    let depth = 1;
    let end = start;
    while (end < code.length && depth > 0) {
      const char = code.charAt(end);
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      end += 1;
    }
    found.push(code.slice(start, end - 1));
    at = code.indexOf(CALL, end);
  }
  return found;
}

const METHOD = /^\s*\{\s*method:\s*"(?:GET|POST)",?\s*\}\s*$/u;

describe("server functions declare their method", () => {
  const calls = Object.entries(sources)
    .filter(([, source]) => !isInstrumented(source))
    .flatMap(([path, source]) =>
      callArguments(withoutComments(source)).map((args) => ({
        file: repoPath(path),
        args,
      })),
    );

  it("finds the server functions it checks", () => {
    // A scan that matched nothing would pass everything below.
    expect(calls.length).toBeGreaterThan(100);
  });

  it("names GET or POST on every one, rather than leaving TanStack's default", () => {
    const undeclared = calls
      .filter(({ args }) => !METHOD.test(args))
      .map(({ file, args }) => `${file}: createServerFn(${args})`);
    expect(undeclared).toStrictEqual([]);
  });
});
