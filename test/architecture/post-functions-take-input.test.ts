import { describe, expect, it } from "vitest";

import { serverFunctionsIn } from "./source-text";

/**
 * **Every POST server function has a validator** (SA-M25, design 230).
 *
 * A POST server function writes, and a write is made only by a call that
 * carries the input saying it is one. A function that takes none says so
 * with `lib/no-input`'s `noInput`, and its callers send `{ data: {} }`: a
 * call that carries nothing at all is refused before the handler runs.
 *
 * Read as text, because a `functions.ts` cannot be imported by a test
 * (`server-functions-are-glue` says why). It cannot see whether a
 * validator refuses `undefined`; every one today parses a `z.object`, a
 * union of them, or a `FormData`, and a new one is a review point.
 */
const sources: Record<string, string> = import.meta.glob(
  "../../src/modules/*/functions.ts",
  { query: "?raw", import: "default", eager: true },
);

const POST = /createServerFn\(\s*\{\s*method:\s*"POST",?\s*\}\s*\)/u;

describe("POST server functions take input", () => {
  const posts = serverFunctionsIn(sources).filter(({ body }) =>
    POST.test(body),
  );

  it("finds the POST functions it checks", () => {
    // A scan that matched nothing would pass everything below.
    expect(posts.length).toBeGreaterThan(80);
  });

  it("gives every one a validator, ahead of its handler", () => {
    const bare = posts
      .filter(({ body }) => {
        const validator = body.indexOf(".validator(");
        return validator === -1 || validator > body.indexOf(".handler(");
      })
      .map(({ name }) => name);
    expect(bare).toStrictEqual([]);
  });
});
