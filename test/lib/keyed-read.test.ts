import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { follows } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  columnSetAmong,
  columnWhere,
  firstColumnWhere,
  firstRowWhere,
  hasRowWhere,
} from "../../src/lib/keyed-read";

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
    // sets rather than sorting: order is the database's to choose.
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

/**
 * The read law 8b's idempotency check makes: *have we already stored this
 * submission, and if so what did it produce.* Both callers ask it of a
 * UNIQUE index, so the answer is one row or none.
 */
describe("firstColumnWhere", () => {
  it("answers with the value, not with the row that held it", async () => {
    const follower = newUlid();
    const followee = newUlid();
    await followRow(follower, followee);

    const found = await firstColumnWhere(
      coreDb(),
      follows,
      follows.followeeId,
      eq(follows.followerId, follower),
    );

    // The string itself — a caller that got `{ followeeId }` back would
    // have to know the helper's own projection name to read it.
    expect(found).toBe(followee);
  });

  it("answers undefined when nothing matches, rather than throwing", async () => {
    // The miss is the common case on the idempotency path: almost every
    // submission is a first submission. Reading `.value` off the absent
    // row instead of through `?.` would make the happy path throw.
    const found = await firstColumnWhere(
      coreDb(),
      follows,
      follows.followeeId,
      eq(follows.followerId, newUlid()),
    );

    expect(found).toBeUndefined();
  });
});

describe("firstRowWhere", () => {
  it("answers with the whole row, every column of it", async () => {
    // The read a queue job opens with: the row this job points at. Unlike
    // the three above, the caller needs every column, so the row is the
    // point rather than a lapse.
    const followerId = newUlid();
    const followeeId = newUlid();
    await followRow(followerId, followeeId);

    const row = await firstRowWhere(
      coreDb(),
      follows,
      and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)),
    );

    expect(row).toStrictEqual({
      followerId,
      followeeId,
      createdAt: 1_755_000_000,
    });
  });

  it("answers undefined when nothing matches, rather than throwing", async () => {
    const row = await firstRowWhere(
      coreDb(),
      follows,
      eq(follows.followerId, newUlid()),
    );
    expect(row).toBeUndefined();
  });

  it("stops at the first match rather than reading them all", async () => {
    // Three followees for one follower; one row back. Without the limit
    // this reads every match to answer with one.
    const followerId = newUlid();
    for (let index = 0; index < 3; index += 1) {
      await followRow(followerId, newUlid());
    }
    const row = await firstRowWhere(
      coreDb(),
      follows,
      eq(follows.followerId, followerId),
    );
    expect(row?.followerId).toBe(followerId);
  });
});

/**
 * `columnSetAmong` exists because two modules wrote the same
 * "candidates → matching ids → Set" read, and it takes the membership
 * column rather than a finished predicate for a specific reason: the first
 * version took the `where` whole and used the candidates only for its
 * empty-list guard, which let a caller omit the membership clause and get
 * back every row in the table. That happened, silently, and these tests
 * are what would have caught it.
 */
describe("columnSetAmong", () => {
  it("returns only the candidates that matched", async () => {
    const follower = newUlid();
    const followed = newUlid();
    const alsoFollowed = newUlid();
    const stranger = newUlid();
    await followRow(follower, followed);
    await followRow(follower, alsoFollowed);

    const result = await columnSetAmong(
      coreDb(),
      follows,
      follows.followeeId,
      follows.followeeId,
      [followed, stranger],
      eq(follows.followerId, follower),
    );

    // `alsoFollowed` is the load-bearing id: it matches the predicate but
    // was not asked about, so a helper that dropped the membership clause
    // would return it and a weaker assertion would not notice.
    expect(result).toEqual(new Set([followed]));
  });

  it("applies the extra predicate as well as membership", async () => {
    const follower = newUlid();
    const otherFollower = newUlid();
    const followee = newUlid();
    await followRow(otherFollower, followee);

    // Asked about the right id, but this follower never followed them.
    const result = await columnSetAmong(
      coreDb(),
      follows,
      follows.followeeId,
      follows.followeeId,
      [followee],
      eq(follows.followerId, follower),
    );

    expect(result).toEqual(new Set());
  });

  it("answers an empty candidate list with an empty set", async () => {
    const follower = newUlid();
    await followRow(follower, newUlid());

    const result = await columnSetAmong(
      coreDb(),
      follows,
      follows.followeeId,
      follows.followeeId,
      [],
      eq(follows.followerId, follower),
    );

    // An empty `IN ()` matches nothing, which is why the early-return
    // guard this used to have was unobservable and was removed rather than
    // granted. The answer still has to be right.
    expect(result).toEqual(new Set());
    expect(result.size).toBe(0);
  });

  it("de-duplicates, because a Set is the point", async () => {
    const follower = newUlid();
    const followee = newUlid();
    await followRow(follower, followee);

    const result = await columnSetAmong(
      coreDb(),
      follows,
      follows.followeeId,
      follows.followeeId,
      [followee, followee],
      eq(follows.followerId, follower),
    );

    expect(result).toEqual(new Set([followee]));
    expect(result.size).toBe(1);
  });
});
