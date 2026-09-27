import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles, usernameHistory } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  claimUsername,
  isReservedHandle,
  lookUpHandle,
  requiresHandle,
  usernameOf,
} from "../../src/modules/account/username";

/**
 * The handle (task 126, ACC-1; round 26 #7), through the one writer on
 * real D1: the rule the server adds to the schema's (free, not reserved),
 * the suggestion, the history `/@old` reads, and the race the unique index
 * settles.
 */
const db = drizzle(env.DIALED_CORE);

// One database for the whole file: every case starts with no handles.
beforeEach(async () => {
  await db.batch([db.delete(userProfiles), db.delete(usernameHistory)]);
});

async function runner(profile?: {
  username?: string;
  cityLabel?: string;
}): Promise<string> {
  const userId = newUlid();
  await db.insert(userProfiles).values({ userId, ...profile });
  return userId;
}

/**
 * `db`, with `before` run ahead of its `nth` `batch()` — the moment between
 * the claim's reads and its write, which no ordinary interleaving reaches
 * on demand.
 */
function beforeBatch(nth: number, before: () => Promise<void>): typeof db {
  let calls = 0;
  const batch = async (...args: Parameters<typeof db.batch>) => {
    calls += 1;
    if (calls === nth) await before();
    return db.batch(...args);
  };
  return new Proxy(db, {
    get(target, property, receiver): unknown {
      return property === "batch"
        ? batch
        : Reflect.get(target, property, receiver);
    },
  });
}

/**
 * `db`, recording the size of every `batch()` call made through it. The two
 * read batches (`isHeldByAnother`'s own check, `holdersNow`/`holdersBefore`
 * pairs used while building a suggestion) are always two statements; only
 * the write `claimUsername` attempts in its `try` block is five. Asserting
 * on that shape catches a guard whose *result* the unique index and D-56
 * end up reproducing anyway (so the final `HandleClaim` looks right either
 * way) but that still let a doomed write reach the database when it should
 * never have been attempted, and a repeat claim call the database at all
 * when it should short-circuit before ever doing so.
 */
function trackBatches(): { db: typeof db; sizes: () => number[] } {
  const sizes: number[] = [];
  const batch = (...args: Parameters<typeof db.batch>) => {
    sizes.push(args[0].length);
    return db.batch(...args);
  };
  const tracked = new Proxy(db, {
    get(target, property, receiver): unknown {
      return property === "batch"
        ? batch
        : Reflect.get(target, property, receiver);
    },
  });
  return { db: tracked, sizes: () => sizes };
}

async function handleOf(userId: string): Promise<string | null | undefined> {
  const [row] = await db
    .select({ username: userProfiles.username })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  return row?.username;
}

async function historyOf(userId: string) {
  return db
    .select({ username: usernameHistory.username })
    .from(usernameHistory)
    .where(eq(usernameHistory.userId, userId));
}

describe("claimUsername", () => {
  it("claims a free handle, creating the profile row when O0 is the first write", async () => {
    const userId = newUlid();
    expect(await claimUsername(db, userId, "maya_runs")).toStrictEqual({
      kind: "claimed",
      username: "maya_runs",
    });
    expect(await handleOf(userId)).toBe("maya_runs");
    expect(await historyOf(userId)).toStrictEqual([]);
  });

  it("changes a handle, keeping the old one in the history", async () => {
    const userId = await runner({ username: "maya_runs" });
    const before = nowSeconds();
    expect(await claimUsername(db, userId, "maya_trails")).toMatchObject({
      kind: "claimed",
    });
    expect(await handleOf(userId)).toBe("maya_trails");
    const [retired] = await db
      .select()
      .from(usernameHistory)
      .where(eq(usernameHistory.userId, userId));
    expect(retired?.username).toBe("maya_runs");
    expect(retired?.retiredAt).toBeGreaterThanOrEqual(before);
    expect(retired?.retiredAt).toBeLessThanOrEqual(before + 5);
  });

  it("keeps the rest of the profile when the handle changes", async () => {
    const userId = await runner({ username: "dee_k", cityLabel: "Duluth, MN" });
    await claimUsername(db, userId, "dee_runs");
    const [row] = await db
      .select({ cityLabel: userProfiles.cityLabel })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(row?.cityLabel).toBe("Duluth, MN");
  });

  it("claiming the handle you have is a success that writes nothing new", async () => {
    const userId = await runner({ username: "dee_k" });
    const { db: tracked, sizes } = trackBatches();
    expect(await claimUsername(tracked, userId, "dee_k")).toStrictEqual({
      kind: "claimed",
      username: "dee_k",
    });
    expect(await historyOf(userId)).toStrictEqual([]);
    // Not just "nothing changed" — nothing was even asked of the database.
    // Writing the same value back would land unnoticed (SQLite is happy to
    // set a row to the value it already holds), so the early return itself,
    // not its downstream effect, is what a test of this line has to catch.
    expect(sizes()).toStrictEqual([]);
  });

  it("refuses a handle someone holds, in any case, with one free suggestion", async () => {
    await runner({ username: "maya_runs" });
    const userId = await runner({ cityLabel: "Portland, OR" });
    const { db: tracked, sizes } = trackBatches();
    expect(await claimUsername(tracked, userId, "maya_runs")).toStrictEqual({
      kind: "taken",
      username: "maya_runs",
      suggestion: "maya_runs_portland",
    });
    expect(await handleOf(userId)).toBeNull();
    // Every batch this claim made was a read (two statements) — the
    // five-statement write is never reached. A handle already held live is
    // caught by the unique index too if the write is attempted anyway, so
    // the final "taken" answer alone can't tell a skipped write from a
    // doomed one; the shape of what ran can.
    expect(sizes().length).toBeGreaterThan(0);
    expect(sizes().every((size) => size === 2)).toBe(true);
  });

  it("refuses a handle another runner gave up, before any write is tried (D-56)", async () => {
    const previous = await runner({ username: "maya_runs" });
    await claimUsername(db, previous, "maya_trails");
    const userId = await runner();
    const { db: tracked, sizes } = trackBatches();
    expect(await claimUsername(tracked, userId, "maya_runs")).toMatchObject({
      kind: "taken",
      username: "maya_runs",
    });
    expect(await handleOf(userId)).toBeNull();
    // The retired half of the read is what refuses this: D-56's own check
    // inside the write would refuse it too, so only the shape of what ran —
    // reads alone, never the five-statement write — tells the two apart.
    expect(sizes().length).toBeGreaterThan(0);
    expect(sizes().every((size) => size === 2)).toBe(true);
  });

  it("compares as the unique index does, whatever case a row was written in", async () => {
    // A writer that forgot to lowercase: NOCASE still finds it.
    await runner({ username: "Maya" });
    const userId = await runner();
    expect(await claimUsername(db, userId, "maya")).toMatchObject({
      kind: "taken",
    });
  });

  it("suggests a digit when there is no city, skipping the ones taken", async () => {
    await runner({ username: "dee" });
    await runner({ username: "dee2" });
    const userId = await runner();
    expect(await claimUsername(db, userId, "dee")).toStrictEqual({
      kind: "taken",
      username: "dee",
      suggestion: "dee3",
    });
  });

  it("answers taken for a runner who has no profile row yet", async () => {
    await runner({ username: "dee" });
    expect(await claimUsername(db, newUlid(), "dee")).toStrictEqual({
      kind: "taken",
      username: "dee",
      suggestion: "dee2",
    });
  });

  it("slugs the city's first word, whatever follows it", async () => {
    await runner({ username: "dee" });
    const paul = await runner({ cityLabel: "St. Paul, MN" });
    expect(await claimUsername(db, paul, "dee")).toMatchObject({
      suggestion: "dee_st",
    });
    const duluth = await runner({ cityLabel: "Duluth" });
    expect(await claimUsername(db, duluth, "dee")).toMatchObject({
      suggestion: "dee_duluth",
    });
  });

  it("suggests a digit when the city suggestion is itself taken", async () => {
    await runner({ username: "dee" });
    await runner({ username: "dee_duluth" });
    const userId = await runner({ cityLabel: "Duluth" });
    expect(await claimUsername(db, userId, "dee")).toMatchObject({
      suggestion: "dee2",
    });
  });

  it("walks every digit, 2 to 9, before giving up", async () => {
    await runner({ username: "ana" });
    for (const digit of ["2", "3", "4", "5", "6", "7", "8"]) {
      await runner({ username: `ana${digit}` });
    }
    const userId = await runner({ cityLabel: "!!!" });
    expect(await claimUsername(db, userId, "ana")).toMatchObject({
      suggestion: "ana9",
    });
    await runner({ username: "ana9" });
    expect(await claimUsername(db, userId, "ana")).toStrictEqual({
      kind: "taken",
      username: "ana",
      suggestion: undefined,
    });
  });

  it("keeps a suggestion inside 20 characters by cutting the handle short", async () => {
    const long = "abcdefghijklmnopqrst";
    await runner({ username: long });
    const userId = await runner({ cityLabel: "Portland, OR" });
    const result = await claimUsername(db, userId, long);
    expect(result).toMatchObject({ suggestion: "abcdefghijk_portland" });

    const other = await runner();
    expect(await claimUsername(db, other, long)).toMatchObject({
      suggestion: "abcdefghijklmnopqrs2",
    });
  });

  it("refuses every reserved name in any case, and suggests nothing built on one", async () => {
    const userId = await runner();
    for (const reserved of ["admin", "dialed", "strava", "moderator"]) {
      expect(await claimUsername(db, userId, reserved)).toStrictEqual({
        kind: "taken",
        username: reserved,
        suggestion: undefined,
      });
    }
    expect(await handleOf(userId)).toBeNull();
  });

  it("offers no suggestion for a reserved exact name, even when one is free (D-57)", async () => {
    // `support` is reserved as itself, not inside other handles, so
    // `support2` is free — and offering it would say `support` is on the
    // list rather than merely held.
    const userId = await runner({ cityLabel: "Portland, OR" });
    expect(await claimUsername(db, userId, "support2")).toMatchObject({
      kind: "claimed",
    });
    const other = await runner({ cityLabel: "Portland, OR" });
    expect(await claimUsername(db, other, "support")).toStrictEqual({
      kind: "taken",
      username: "support",
      suggestion: undefined,
    });
    const third = await runner();
    expect(await claimUsername(db, third, "team")).toStrictEqual({
      kind: "taken",
      username: "team",
      suggestion: undefined,
    });
    expect(await handleOf(third)).toBeNull();
  });

  it("skips a suggestion candidate that would itself be a reserved name", async () => {
    // "joe_adminville" contains "admin" and must never be offered, even
    // though nobody holds it — the candidate's own reserved check, not just
    // claimUsername's top-level one, has to reject it before the suggester
    // ever asks the database, or falls through to a digit.
    await runner({ username: "joe" });
    const userId = await runner({ cityLabel: "Adminville" });
    expect(await claimUsername(db, userId, "joe")).toStrictEqual({
      kind: "taken",
      username: "joe",
      suggestion: "joe2",
    });
  });

  it("never lets another runner take a handle someone gave up", async () => {
    const maya = await runner({ username: "maya_runs" });
    await claimUsername(db, maya, "maya_trails");
    const other = await runner();
    expect(await claimUsername(db, other, "maya_runs")).toMatchObject({
      kind: "taken",
    });
  });

  it("lets a runner take their own old handle back, and forgets it was retired", async () => {
    const maya = await runner({ username: "maya_runs" });
    await claimUsername(db, maya, "maya_trails");
    expect(await claimUsername(db, maya, "maya_runs")).toMatchObject({
      kind: "claimed",
    });
    expect(await handleOf(maya)).toBe("maya_runs");
    const history = await historyOf(maya);
    expect(history.map((row) => row.username)).toStrictEqual(["maya_trails"]);
  });

  it("does not touch another runner's history when taking a handle back", async () => {
    const maya = await runner({ username: "maya_runs" });
    await claimUsername(db, maya, "maya_trails");
    const dee = await runner({ username: "dee" });
    await claimUsername(db, dee, "dee_k");
    await claimUsername(db, maya, "maya_runs");
    const history = await historyOf(dee);
    expect(history.map((row) => row.username)).toStrictEqual(["dee"]);
  });

  it("reads a race lost at the unique index as taken", async () => {
    const userId = await runner();
    // A rival claims the same handle after our free check and before our
    // write: the write batch is the claim's second batch.
    const racing = beforeBatch(2, async () => {
      await runner({ username: "sam_runs" });
    });
    expect(await claimUsername(racing, userId, "sam_runs")).toStrictEqual({
      kind: "taken",
      username: "sam_runs",
      suggestion: "sam_runs2",
    });
    expect(await handleOf(userId)).toBeNull();
  });

  it("refuses a handle given up between its read and its write (D-56, in SQL)", async () => {
    const userId = await runner({ username: "me_now" });
    // A rival holds sam_runs and gives it up after our free check and
    // before our write: the read said free, the batch must still refuse.
    const racing = beforeBatch(2, async () => {
      const rival = await runner({ username: "sam_runs" });
      await claimUsername(db, rival, "sam_trails");
    });
    expect(await claimUsername(racing, userId, "sam_runs")).toStrictEqual({
      kind: "taken",
      username: "sam_runs",
      suggestion: "sam_runs2",
    });
    // Nothing of the refused claim landed: the handle, and no history row
    // for the handle it would have replaced.
    expect(await handleOf(userId)).toBe("me_now");
    expect(await historyOf(userId)).toStrictEqual([]);
  });

  it("refuses it for a runner with no profile row yet, leaving no handle", async () => {
    const userId = newUlid();
    const racing = beforeBatch(2, async () => {
      const rival = await runner({ username: "sam_runs" });
      await claimUsername(db, rival, "sam_trails");
    });
    expect(await claimUsername(racing, userId, "sam_runs")).toMatchObject({
      kind: "taken",
    });
    expect(await handleOf(userId)).toBeNull();
  });

  it("answers a second submit of a change that already landed as claimed", async () => {
    const userId = await runner({ username: "maya_runs" });
    // The first submit lands between the second's read and its write.
    const doubled = beforeBatch(2, async () => {
      await claimUsername(db, userId, "maya_trails");
    });
    expect(await claimUsername(doubled, userId, "maya_trails")).toStrictEqual({
      kind: "claimed",
      username: "maya_trails",
    });
    expect(await handleOf(userId)).toBe("maya_trails");
    const history = await historyOf(userId);
    expect(history.map((row) => row.username)).toStrictEqual(["maya_runs"]);
  });

  it("retires the handle held when the write runs, not the one the read saw", async () => {
    const userId = await runner({ username: "maya_runs" });
    // Two different changes racing: the first lands between the second's
    // read (which saw maya_runs) and its write.
    const racing = beforeBatch(2, async () => {
      await claimUsername(db, userId, "maya_trails");
    });
    expect(await claimUsername(racing, userId, "maya_roads")).toMatchObject({
      kind: "claimed",
    });
    expect(await handleOf(userId)).toBe("maya_roads");
    const history = await historyOf(userId);
    expect(
      history.map((row) => row.username).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(["maya_runs", "maya_trails"]);
  });

  it("lets any other UNIQUE failure through, rather than calling it taken", async () => {
    const userId = await runner();
    const failing = beforeBatch(2, () => {
      throw new Error(
        "D1_ERROR: UNIQUE constraint failed: username_history.username: SQLITE_CONSTRAINT",
      );
    });
    await expect(claimUsername(failing, userId, "fine_handle")).rejects.toThrow(
      "username_history.username",
    );
  });

  it("lets any other write failure through", async () => {
    const userId = await runner();
    const failing = beforeBatch(2, () => {
      throw new Error("D1_ERROR: the database is unavailable");
    });
    await expect(claimUsername(failing, userId, "fine_handle")).rejects.toThrow(
      "the database is unavailable",
    );
  });
});

describe("isReservedHandle", () => {
  it("refuses the list's names and their obvious disguises", () => {
    for (const handle of [
      "admin",
      "administrator",
      "dialed",
      "dialedrun",
      "support",
      "strava",
      "moderator",
      "mod",
      "staff",
      "official",
      "system",
      "root",
      "help",
      "team",
      "security",
      "abuse",
      "privacy",
      "legal",
      "api",
      "operator",
      "mods",
      "moderators",
      // inside a handle
      "dialed_team",
      "the_admin",
      "strava_help",
      "moderator2",
      // disguised
      "d_i_a_l_e_d",
      "dia1ed",
      "adm1n",
      "5trava",
      "m0derator",
      "4dmin",
      "dial3d",
      "s7rava",
      "adm_in",
      "support_",
      "s_upport",
    ]) {
      expect(isReservedHandle(handle), handle).toBe(true);
    }
  });

  it("lets ordinary handles through, including ones near a reserved word", () => {
    for (const handle of [
      "maya_runs",
      "support2",
      "dee_k",
      "mod_squad",
      "teamwork",
      "rooted",
      "r2d2",
      "l1ly",
    ]) {
      expect(isReservedHandle(handle), handle).toBe(false);
    }
  });
});

describe("lookUpHandle", () => {
  it("finds the runner who holds a handle, whatever case it is asked in", async () => {
    const userId = await runner({ username: "maya_runs" });
    expect(await lookUpHandle(db, "maya_runs")).toStrictEqual({
      kind: "current",
      userId,
    });
    expect(await lookUpHandle(db, "@Maya_Runs")).toStrictEqual({
      kind: "current",
      userId,
    });
  });

  it("says an old handle changed, and never who it became", async () => {
    const userId = await runner({ username: "maya_runs" });
    await claimUsername(db, userId, "maya_trails");
    expect(await lookUpHandle(db, "maya_runs")).toStrictEqual({
      kind: "changed",
    });
  });

  it("knows nothing of a handle nobody held, or one that is not a handle", async () => {
    expect(await lookUpHandle(db, "nobody_here")).toBeUndefined();
    expect(await lookUpHandle(db, "no")).toBeUndefined();
  });
});

describe("usernameOf and requiresHandle", () => {
  it("reads the handle, and nothing before O0", async () => {
    expect(await usernameOf(db, await runner({ username: "dee" }))).toBe("dee");
    expect(await usernameOf(db, await runner())).toBeUndefined();
    expect(await usernameOf(db, newUlid())).toBeUndefined();
  });

  it("sends a signed-in runner with no handle to O0, and nobody else", async () => {
    expect(await requiresHandle(db, await runner())).toBe(true);
    expect(await requiresHandle(db, newUlid())).toBe(true);
    expect(await requiresHandle(db, await runner({ username: "dee" }))).toBe(
      false,
    );
    expect(await requiresHandle(db, undefined)).toBe(false);
  });
});
