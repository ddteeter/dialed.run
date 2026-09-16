import { beforeEach, describe, expect, it } from "vitest";

import {
  blockRunner,
  blockedAmong,
  blockedRunners,
  hiddenCounterpartIds,
  isBlocked,
  SelfBlockError,
  unblockRunner,
} from "../../src/modules/safety";

import { makeUser, resetSafetyTables } from "./helpers";

describe("blocking", () => {
  beforeEach(resetSafetyTables);

  it("blocks and unblocks", async () => {
    const me = await makeUser();
    const them = await makeUser();

    expect(await isBlocked(me, them)).toBe(false);
    await blockRunner(me, them);
    expect(await isBlocked(me, them)).toBe(true);

    await unblockRunner(me, them);
    expect(await isBlocked(me, them)).toBe(false);
  });

  it("is idempotent, because the UI offers no way to tell", async () => {
    const me = await makeUser();
    const them = await makeUser();

    await blockRunner(me, them);
    await blockRunner(me, them);

    const roster = await blockedRunners(me);
    expect(roster).toHaveLength(1);
  });

  it("refuses a self-block", async () => {
    const me = await makeUser();
    await expect(blockRunner(me, me)).rejects.toThrow(SelfBlockError);
    // The sentence too: this one reaches a log rather than a screen, and
    // "Error" tells whoever reads it nothing about what was attempted.
    await expect(blockRunner(me, me)).rejects.toThrow(
      /cannot block themselves/u,
    );
  });

  it("is one-directional as stored, even though it hides both ways", async () => {
    const me = await makeUser();
    const them = await makeUser();
    await blockRunner(me, them);

    // `isBlocked` asks "did A block B", which is a different question from
    // "can A and B see each other" — that one is hiddenCounterpartIds.
    expect(await isBlocked(me, them)).toBe(true);
    expect(await isBlocked(them, me)).toBe(false);
  });
});

describe("blockedAmong", () => {
  beforeEach(resetSafetyTables);

  it("returns only the blocked ids that were actually asked about", async () => {
    const me = await makeUser();
    const blockedOnThisPage = await makeUser();
    const blockedElsewhere = await makeUser();
    const notBlocked = await makeUser();
    await blockRunner(me, blockedOnThisPage);
    await blockRunner(me, blockedElsewhere);

    const result = await blockedAmong(me, [blockedOnThisPage, notBlocked]);

    // The regression guard for a real bug: a refactor dropped the
    // membership clause, so this returned EVERY runner the blocker had
    // ever blocked. Nothing failed, because a superset still contains the
    // ids a weaker test expects — only asserting the exact set catches it,
    // and `blockedElsewhere` is the id that makes the difference visible.
    expect(result).toEqual(new Set([blockedOnThisPage]));
    expect(result.has(blockedElsewhere)).toBe(false);
  });

  it("does not leak another blocker's list", async () => {
    const me = await makeUser();
    const someoneElse = await makeUser();
    const target = await makeUser();
    await blockRunner(someoneElse, target);

    expect(await blockedAmong(me, [target])).toEqual(new Set());
  });

  it("answers an empty candidate list without asking the database", async () => {
    const me = await makeUser();
    await blockRunner(me, await makeUser());
    expect(await blockedAmong(me, [])).toEqual(new Set());
  });
});

describe("hiddenCounterpartIds", () => {
  beforeEach(resetSafetyTables);

  it("covers both directions from one row", async () => {
    const me = await makeUser();
    const iBlocked = await makeUser();
    const blockedMe = await makeUser();
    const unrelated = await makeUser();

    await blockRunner(me, iBlocked);
    await blockRunner(blockedMe, me);
    await blockRunner(unrelated, await makeUser());

    const hidden = await hiddenCounterpartIds(me);

    // W2 promises both: "They can't see your entries" AND "You won't see
    // them". One row, read from both ends.
    expect(new Set(hidden)).toEqual(new Set([iBlocked, blockedMe]));
  });

  it("never returns the viewer themselves", async () => {
    const me = await makeUser();
    await blockRunner(me, await makeUser());
    expect(await hiddenCounterpartIds(me)).not.toContain(me);
  });

  it("is empty for someone with no blocks either way", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await blockRunner(other, await makeUser());
    expect(await hiddenCounterpartIds(me)).toEqual([]);
  });
});

describe("the W2 roster", () => {
  beforeEach(resetSafetyTables);

  it("lists who I blocked, with their names and when", async () => {
    const me = await makeUser();
    const them = await makeUser({ displayName: "j_holloway" });
    await blockRunner(me, them);

    const roster = await blockedRunners(me);

    expect(roster).toHaveLength(1);
    expect(roster[0]?.userId).toBe(them);
    expect(roster[0]?.displayName).toBe("j_holloway");
    // In seconds, bounded both ways — the roster is ordered by it, and a
    // millisecond value sorts one block above every other forever.
    const now = Math.floor(Date.now() / 1000);
    expect(roster[0]?.blockedAt).toBeGreaterThanOrEqual(now - 5);
    expect(roster[0]?.blockedAt).toBeLessThanOrEqual(now + 5);
  });

  it("does not list people who blocked ME", async () => {
    const me = await makeUser();
    const blockedMe = await makeUser();
    await blockRunner(blockedMe, me);

    // "Nothing here is a list anyone else can see" — and equally, nothing
    // here tells me who has blocked me. Blocking is quiet in both
    // directions.
    expect(await blockedRunners(me)).toEqual([]);
  });

  it("is empty for most people, which is the normal case", async () => {
    expect(await blockedRunners(await makeUser())).toEqual([]);
  });
});
