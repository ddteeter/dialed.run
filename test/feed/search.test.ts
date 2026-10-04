import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { follow } from "../../src/modules/feed/follows";
import { searchRunners } from "../../src/modules/feed/search";
import { makeUser, profileAudienceColumns, resetTables } from "./helpers";

/**
 * Runner search (round 22, item 15): a prefix on the handle, never
 * the viewer, and each row knowing whether the viewer already follows —
 * because the Follow pill sits inline on it.
 */
beforeEach(resetTables);

describe("searchRunners", () => {
  it("answers with nothing for a blank query", async () => {
    // Including one that is only spaces: an untrimmed blank becomes
    // `LIKE ' %'`, which is a full scan for nothing.
    const viewer = await makeUser();
    await makeUser({ username: "somebody" });
    expect(await searchRunners(viewer, "")).toStrictEqual([]);
    expect(await searchRunners(viewer, " ".repeat(3))).toStrictEqual([]);
  });

  it("matches on a trimmed prefix", async () => {
    const viewer = await makeUser();
    const userId = await makeUser({ username: "tracksmith_runner" });

    expect(await searchRunners(viewer, "  Tracksmith ")).toStrictEqual([
      { userId, username: "tracksmith_runner", following: false },
    ]);
  });

  it("matches a prefix, not a substring", async () => {
    const viewer = await makeUser();
    await makeUser({ username: "fast_runner" });
    expect(await searchRunners(viewer, "runner")).toStrictEqual([]);
  });

  it("never offers the viewer themself", async () => {
    const viewer = await makeUser({ username: "dana_kim" });
    const other = await makeUser({ username: "dana_lee" });

    const results = await searchRunners(viewer, "dana");

    expect(results.map((result) => result.userId)).toStrictEqual([other]);
  });

  it("says which results the viewer already follows, and only the viewer's follows", async () => {
    const viewer = await makeUser();
    const someoneElse = await makeUser();
    const followed = await makeUser({ username: "ana_followed" });
    const notYet = await makeUser({ username: "ana_stranger" });
    await follow(viewer, followed);
    await follow(someoneElse, notYet);

    const results = await searchRunners(viewer, "ana");
    const byId = new Map(results.map((row) => [row.userId, row.following]));

    expect(byId.get(followed)).toBe(true);
    expect(byId.get(notYet)).toBe(false);
  });

  it("leaves out a profile that has no handle", async () => {
    // The result type promises a name. A row with none is not a person you
    // can offer to follow.
    const viewer = await makeUser();
    await drizzle(env.DIALED_CORE)
      .insert(userProfiles)
      .values({ userId: newUlid(), ...profileAudienceColumns("runners") });

    expect(await searchRunners(viewer, "runner")).toStrictEqual([]);
  });

  it("reads `_`, `%` and `\\` as themselves, never as LIKE wildcards", async () => {
    const viewer = await makeUser();
    const maya = await makeUser({ username: "maya_" });
    await makeUser({ username: "mayax" });
    await makeUser({ username: "maya_x" });
    const found = await searchRunners(viewer, "maya_");
    expect(
      found.map((row) => row.username).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(["maya_", "maya_x"]);
    expect(found.map((row) => row.userId)).toContain(maya);
    // None of these is a handle character, so each finds nothing rather than
    // everything.
    expect(await searchRunners(viewer, "%")).toStrictEqual([]);
    expect(await searchRunners(viewer, "m%")).toStrictEqual([]);
    expect(await searchRunners(viewer, "\\")).toStrictEqual([]);
  });

  it("finds a handle typed with the @ the field shows in front of it", async () => {
    const viewer = await makeUser();
    const maya = await makeUser({ username: "maya" });
    expect(await searchRunners(viewer, " @Maya")).toStrictEqual([
      { userId: maya, username: "maya", following: false },
    ]);
  });

  it("is still served by the NOCASE index with the ESCAPE clause", async () => {
    // Rows scanned are what D1 bills: an ESCAPE that cost the LIKE
    // optimisation would scan the table on every keystroke.
    // The pattern bound as a parameter, the way the query sends it.
    const plan = await env.DIALED_CORE.prepare(
      String.raw`EXPLAIN QUERY PLAN SELECT user_id FROM user_profiles WHERE username LIKE ? ESCAPE '\'`,
    )
      .bind(String.raw`maya\_%`)
      .all();
    expect(JSON.stringify(plan.results)).toContain(
      "USING INDEX user_profiles_username_nocase",
    );
  });
});
