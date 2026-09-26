import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { follow } from "../../src/modules/feed/follows";
import { searchRunners } from "../../src/modules/feed/search";
import { makeUser, resetTables } from "./helpers";

/**
 * Runner search (round 22, item 15): a prefix on the display name, never
 * the viewer, and each row knowing whether the viewer already follows —
 * because the Follow pill sits inline on it.
 */
beforeEach(resetTables);

describe("searchRunners", () => {
  it("answers with nothing for a blank query", async () => {
    // Including one that is only spaces: an untrimmed blank becomes
    // `LIKE ' %'`, which is a full scan for nothing.
    const viewer = await makeUser();
    await makeUser({ displayName: "Somebody" });
    expect(await searchRunners(viewer, "")).toStrictEqual([]);
    expect(await searchRunners(viewer, " ".repeat(3))).toStrictEqual([]);
  });

  it("matches on a trimmed prefix", async () => {
    const viewer = await makeUser();
    const userId = await makeUser({ displayName: "Tracksmith Runner" });

    expect(await searchRunners(viewer, "  Tracksmith ")).toStrictEqual([
      { userId, displayName: "Tracksmith Runner", following: false },
    ]);
  });

  it("matches a prefix, not a substring", async () => {
    const viewer = await makeUser();
    await makeUser({ displayName: "Fast Runner" });
    expect(await searchRunners(viewer, "Runner")).toStrictEqual([]);
  });

  it("never offers the viewer themself", async () => {
    const viewer = await makeUser({ displayName: "Dana Kim" });
    const other = await makeUser({ displayName: "Dana Lee" });

    const results = await searchRunners(viewer, "Dana");

    expect(results.map((result) => result.userId)).toStrictEqual([other]);
  });

  it("says which results the viewer already follows, and only the viewer's follows", async () => {
    const viewer = await makeUser();
    const someoneElse = await makeUser();
    const followed = await makeUser({ displayName: "Ana Followed" });
    const notYet = await makeUser({ displayName: "Ana Stranger" });
    await follow(viewer, followed);
    await follow(someoneElse, notYet);

    const results = await searchRunners(viewer, "Ana");
    const byId = new Map(results.map((row) => [row.userId, row.following]));

    expect(byId.get(followed)).toBe(true);
    expect(byId.get(notYet)).toBe(false);
  });

  it("leaves out a profile that has no display name", async () => {
    // The result type promises a name. A row with none is not a person you
    // can offer to follow.
    const viewer = await makeUser();
    await drizzle(env.DIALED_CORE)
      .insert(userProfiles)
      .values({ userId: newUlid(), shareDefault: true });

    expect(await searchRunners(viewer, "runner")).toStrictEqual([]);
  });
});
