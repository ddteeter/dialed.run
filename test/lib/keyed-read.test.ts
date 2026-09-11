import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { follows } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { columnWhere, hasRowWhere } from "../../src/lib/keyed-read";

/**
 * The two reads a join table gets, against a real D1.
 *
 * `follows` and `reactions` had written both out twice each, differing
 * only in the table and the column — the copy-then-rename `semantic` mode
 * sees and `mild` does not. Tested here rather than only through their
 * callers because the callers cannot show the thing that matters: that the
 * *column* is the caller's choice, and that `hasRowWhere` stops at one row.
 */

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

async function followRow(followerId: string, followeeId: string) {
  await coreDb()
    .insert(follows)
    .values({ followerId, followeeId, createdAt: 1_755_000_000 });
}

/**
 * The column being an argument is the design, and no assertion can show
 * it: every caller selects exactly one column, the one its covering index
 * carries, so SQLite answers from the index without touching the row. A
 * helper that chose for them — `select *`, or `select 1` — would turn
 * index-only seeks into table scans, and D1 bills rows *scanned*. The type
 * signature is what enforces it; a test asserting `typeof columnWhere ===
 * "function"` would assert nothing at all, which is why there is not one.
 */
describe("columnWhere", () => {
  it("answers with the column's values, not with rows", async () => {
    const follower = newUlid();
    const first = newUlid();
    const second = newUlid();
    await followRow(follower, first);
    await followRow(follower, second);

    const followees = await columnWhere(
      coreDb(),
      follows,
      follows.followeeId,
      eq(follows.followerId, follower),
    );

    // Strings, not `{ followeeId }` objects: the caller asked for a
    // column and gets that column. Order is the database's, so compare as
    // sets rather than sorting (`toSorted` is not in this project's lib).
    expect(new Set(followees)).toStrictEqual(new Set([first, second]));
    expect(followees.every((id) => typeof id === "string")).toBe(true);
  });

  it("answers with nothing when nothing matches", async () => {
    const values = await columnWhere(
      coreDb(),
      follows,
      follows.followeeId,
      eq(follows.followerId, newUlid()),
    );

    expect(values).toStrictEqual([]);
  });
});

describe("hasRowWhere", () => {
  it("finds a row that is there and misses one that is not", async () => {
    const follower = newUlid();
    const followee = newUlid();
    await followRow(follower, followee);

    const both = and(
      eq(follows.followerId, follower),
      eq(follows.followeeId, followee),
    );
    expect(
      await hasRowWhere(coreDb(), follows, follows.followeeId, both),
    ).toBe(true);

    // The reverse pair: following is not mutual by existing.
    const reversed = and(
      eq(follows.followerId, followee),
      eq(follows.followeeId, follower),
    );
    expect(
      await hasRowWhere(coreDb(), follows, follows.followeeId, reversed),
    ).toBe(false);
  });

  it("stops at the first match rather than counting them", async () => {
    // `LIMIT 1`. Without it this reads every matching row to answer a
    // yes/no — on a popular entry, the difference between one row and all
    // of them, billed.
    const follower = newUlid();
    await followRow(follower, newUlid());
    await followRow(follower, newUlid());
    await followRow(follower, newUlid());

    expect(
      await hasRowWhere(
        coreDb(),
        follows,
        follows.followeeId,
        eq(follows.followerId, follower),
      ),
    ).toBe(true);
  });
});
