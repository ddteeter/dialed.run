import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { withoutBoundValues } from "../../src/lib/statement-error";

const QUERY =
  'insert into "runs" ("id", "user_id", "start_lat", "title") values (?, ?, ?, ?)';
const VALUES = ["01J", "user-1", 44.9778, "Lunch run past the office"];

function failedInsert(): DrizzleQueryError {
  return new DrizzleQueryError(
    QUERY,
    VALUES,
    new Error("D1_ERROR: no such table: runs"),
  );
}

/**
An object that has `query` and `params` only through its prototype.
*/
class Inherited extends Error {
  get query(): string {
    return QUERY;
  }

  get params(): readonly unknown[] {
    return VALUES;
  }
}

/**
`inner` as the cause of `times` errors, one inside the next.
*/
function wrapped(inner: unknown, times: number): unknown {
  let error = inner;
  for (let level = 1; level <= times; level += 1) {
    error = new Error(`level ${String(level)}`, { cause: error });
  }
  return error;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

describe("withoutBoundValues (SA-L08)", () => {
  it("names a failed statement by its first words and the database's reason", () => {
    const scrubbed = withoutBoundValues(failedInsert());
    expect(scrubbed).toBeInstanceOf(Error);
    expect(messageOf(scrubbed)).toBe(
      'failed statement insert into "runs": D1_ERROR: no such table: runs',
    );
  });

  it("carries none of the values, and no cause a reporter could follow", () => {
    const scrubbed = withoutBoundValues(failedInsert());
    expect(JSON.stringify(scrubbed, Object.getOwnPropertyNames(scrubbed))).not.toMatch(
      /44\.9778|Lunch run|user-1/u,
    );
    expect(scrubbed).not.toHaveProperty("cause");
    expect(scrubbed).not.toHaveProperty("params");
  });

  it("keeps the outer message when the statement is a cause further down", () => {
    const outer = new Error("Failed to get session", {
      cause: new Error("wrapped", { cause: failedInsert() }),
    });
    expect(messageOf(withoutBoundValues(outer))).toBe(
      'Failed to get session (failed statement insert into "runs": D1_ERROR: no such table: runs)',
    );
  });

  it("looks five causes down, and no further", () => {
    const five = wrapped(failedInsert(), 5);
    expect(messageOf(withoutBoundValues(five))).toContain("failed statement");
    const six = wrapped(failedInsert(), 6);
    expect(withoutBoundValues(six)).toBe(six);
  });

  it("says so when the statement had no reason of its own", () => {
    const bare = new DrizzleQueryError(QUERY, VALUES);
    expect(messageOf(withoutBoundValues(bare))).toBe(
      'failed statement insert into "runs": no reason given',
    );
  });

  it("takes the first three words of a statement however it is spaced", () => {
    const spaced = new DrizzleQueryError(
      '\n  select   "id", "email"\n from "user" where "email" = ?',
      ["a@example.com"],
      new Error("D1_ERROR: timeout"),
    );
    expect(messageOf(withoutBoundValues(spaced))).toBe(
      'failed statement select "id", "email": D1_ERROR: timeout',
    );
  });

  it("leaves every other error as it was thrown", () => {
    const plain = new Error("boom");
    const refusal = z.string().safeParse(1).error;
    const redirect = new Response("", { status: 307 });
    for (const thrown of [plain, refusal, redirect, "text", undefined]) {
      expect(withoutBoundValues(thrown)).toBe(thrown);
    }
  });

  it("does not take a look-alike for a failed statement", () => {
    const inherited = new Inherited();
    const noParams = Object.assign(new Error("x"), { query: QUERY });
    const noQuery = Object.assign(new Error("x"), { params: VALUES });
    const numeric = Object.assign(new Error("x"), { query: 7, params: VALUES });
    for (const thrown of [inherited, noParams, noQuery, numeric]) {
      expect(withoutBoundValues(thrown)).toBe(thrown);
    }
  });
});
