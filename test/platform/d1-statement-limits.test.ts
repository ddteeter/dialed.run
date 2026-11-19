import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { IN_LIST_CHUNK } from "../../src/lib/chunked";
import { refusal } from "./refusal";

/**
 * Two of D1's per-statement limits, asked of the local D1 the suite runs
 * on (design 239). The code is written around both, and every test of
 * that code trusts the local database to refuse what production refuses:
 * a chunked `IN (…)` list (`lib/chunked`) is only shown to be needed, and
 * a read that stays under the cap is only shown to stay under it, if the
 * emulator enforces the cap. If a workerd update moved either number,
 * these fail first and say which.
 */
const db = env.DIALED_CORE;

function withBoundValues(count: number): Promise<unknown> {
  const marks = Array.from({ length: count }, () => "?").join(",");
  return db
    .prepare(`SELECT 1 AS one WHERE 1 IN (${marks})`)
    .bind(...Array.from({ length: count }, (_, index) => index))
    .first();
}

function likePatternOf(bytes: number): Promise<unknown> {
  return db
    .prepare(String.raw`SELECT 'x' LIKE ? ESCAPE '\' AS hit`)
    .bind(`${"a".repeat(bytes - 1)}%`)
    .first();
}

describe("local D1's bound-parameter cap", () => {
  it("runs a statement with 100 bound values", async () => {
    expect(await withBoundValues(100)).toStrictEqual({ one: 1 });
  });

  it("refuses the 101st, and the whole statement with it", async () => {
    expect(await refusal(() => withBoundValues(101))).toContain(
      "too many SQL variables",
    );
  });

  it("leaves a chunked list room for the statement's other operands", () => {
    expect(IN_LIST_CHUNK).toBeLessThan(100);
  });
});

describe("local D1's LIKE pattern limit", () => {
  it("evaluates a 50-byte pattern", async () => {
    expect(await likePatternOf(50)).toStrictEqual({ hit: 0 });
  });

  it("refuses a 51-byte pattern once a row is compared with it", async () => {
    expect(await refusal(() => likePatternOf(51))).toContain(
      "LIKE or GLOB pattern too complex",
    );
  });
});
