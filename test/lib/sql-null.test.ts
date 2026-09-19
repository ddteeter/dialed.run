import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { orSqlNull } from "../../src/lib/sql-null";

describe("orSqlNull", () => {
  it("passes a present value straight through, unwrapped", () => {
    // The identity half matters as much as the NULL half: a helper that
    // wrapped everything would clear columns that were meant to be set.
    expect(orSqlNull("a value")).toBe("a value");
    expect(orSqlNull(0)).toBe(0);
    expect(orSqlNull(false)).toBe(false);
  });

  it("turns undefined into a raw SQL NULL, not the string 'NULL'", () => {
    const cleared = orSqlNull(undefined);

    // `toEqual(sql\`NULL\`)` rather than a truthiness check: what this
    // returns has to be the fragment drizzle splices into the statement.
    // A plain string "NULL" would be bound as a *value* and store the four
    // characters, which is the bug this helper exists to avoid and which
    // nothing else in the stack would complain about.
    expect(cleared).not.toBe("NULL");
    expect(cleared).toEqual(sql`NULL`);
  });

  it("does not treat an empty string or zero as absent", () => {
    // `??` and `||` differ exactly here, and picking the wrong one would
    // clear a column whenever a runner typed nothing into an optional
    // field rather than storing their empty answer.
    expect(orSqlNull("")).toBe("");
    expect(orSqlNull("")).not.toEqual(sql`NULL`);
    expect(orSqlNull(0)).not.toEqual(sql`NULL`);
  });
});
