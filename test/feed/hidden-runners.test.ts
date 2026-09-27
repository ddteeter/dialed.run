import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { outfitEntries, usernameHistory } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryDetailForViewer } from "../../src/modules/feed/entries";
import { follow } from "../../src/modules/feed/follows";
import {
  otherProfile,
  profileAtHandle,
} from "../../src/modules/feed/profiles";
import {
  searchRunners,
  searchStatement,
} from "../../src/modules/feed/search";
import { banUser, blockRunner, fileReport } from "../../src/modules/safety";
import { makeEntry, makeRun, makeUser, resetTables, NOW } from "./helpers";

/**
 * FEED-7 (D-107, D-108): a banned runner, and anyone in a block pair with
 * the viewer, leaves runner search and reads as not found on H — and H's
 * entries go through the viewer-aware visibility rule, so what the viewer
 * reported leaves too. FEED-10: `/@handle`'s answers. FEED-6: the author's
 * own under-review marker on D.
 */
beforeEach(resetTables);

function db() {
  return drizzle(env.DIALED_CORE);
}

async function foundIds(viewer: string, prefix: string): Promise<string[]> {
  const found = await searchRunners(viewer, prefix);
  return found.map((row) => row.userId);
}

async function markerFor(entryId: string, viewer: string) {
  const detail = await entryDetailForViewer(entryId, viewer);
  return detail?.underReview;
}

async function entryIn(status: "ok" | "hidden_pending_review" | "removed") {
  const author = await makeUser();
  const entryId = await postedBy(author);
  await db()
    .update(outfitEntries)
    .set({ moderationStatus: status })
    .where(eq(outfitEntries.id, entryId));
  return { author, entryId };
}

async function postedBy(author: string): Promise<string> {
  return makeEntry({ userId: author, runId: await makeRun({ userId: author }) });
}

describe("runner search leaves out hidden runners", () => {
  it("drops a banned runner and keeps the one beside them", async () => {
    const viewer = await makeUser();
    const banned = await makeUser({ username: "kai_banned" });
    const kept = await makeUser({ username: "kai_kept" });
    await banUser({ userId: banned, reason: "spam", bannedBy: viewer });

    const found = await searchRunners(viewer, "kai");

    expect(found.map((row) => row.userId)).toStrictEqual([kept]);
  });

  it("drops a runner the viewer blocked, and one who blocked the viewer", async () => {
    const viewer = await makeUser();
    const blockedByViewer = await makeUser({ username: "lee_one" });
    const blockedViewer = await makeUser({ username: "lee_two" });
    const kept = await makeUser({ username: "lee_three" });
    await blockRunner(viewer, blockedByViewer);
    await blockRunner(blockedViewer, viewer);

    const found = await searchRunners(viewer, "lee");

    expect(found.map((row) => row.userId)).toStrictEqual([kept]);
  });

  it("is not moved by a block between two other runners", async () => {
    // The pair is the viewer and the result, never any block that happens
    // to name the result.
    const viewer = await makeUser();
    const bystander = await makeUser();
    const found = await makeUser({ username: "moe_found" });
    await blockRunner(bystander, found);
    await blockRunner(found, bystander);

    expect(await foundIds(viewer, "moe")).toStrictEqual([found]);
  });

  it("filters before the LIMIT, so twenty hidden matches cannot empty the page", async () => {
    const viewer = await makeUser();
    for (let index = 0; index < 20; index += 1) {
      const hidden = await makeUser({ username: `nia_${String(index)}` });
      await blockRunner(viewer, hidden);
    }
    const kept = await makeUser({ username: "nia_kept" });

    expect(await foundIds(viewer, "nia")).toStrictEqual([kept]);
  });

  it("serves the prefix from the NOCASE index and each block probe from the primary key", async () => {
    // The statement searchRunners sends. The handle prefix is a range on
    // `user_profiles_username_nocase`; the block pair is two probes per
    // candidate, each a full-key seek on `blocks_pk` — both ends of the
    // pair are known, so neither needs `blocks_blocked`. Never a scan.
    const { sql, params } = searchStatement(
      drizzle(env.DIALED_CORE),
      "01VIEWER",
      "maya",
    ).toSQL();
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");

    expect(details).toMatch(
      /SEARCH user_profiles USING INDEX user_profiles_username_nocase \(username>\? AND username<\?\)/u,
    );
    expect(
      details.match(
        /SEARCH blocks USING COVERING INDEX blocks_pk \(blocker_id=\? AND blocked_id=\?\)/gu,
      ),
    ).toHaveLength(2);
    expect(details).not.toMatch(/SCAN/u);
  });
});

describe("H reads as not found for a hidden runner", () => {
  it("answers nothing for a banned runner", async () => {
    const viewer = await makeUser();
    const banned = await makeUser();
    await banUser({ userId: banned, reason: "spam", bannedBy: viewer });

    expect(await otherProfile(banned, viewer)).toBeUndefined();
  });

  it("answers nothing across a block, from either end", async () => {
    const viewer = await makeUser();
    const blockedByViewer = await makeUser();
    const blockedViewer = await makeUser();
    await blockRunner(viewer, blockedByViewer);
    await blockRunner(blockedViewer, viewer);

    expect(await otherProfile(blockedByViewer, viewer)).toBeUndefined();
    expect(await otherProfile(blockedViewer, viewer)).toBeUndefined();
  });

  it("still shows the runner to someone outside the pair", async () => {
    const viewer = await makeUser();
    const bystander = await makeUser();
    const runner = await makeUser();
    await blockRunner(bystander, runner);

    const profile = await otherProfile(runner, viewer);
    expect(profile?.userId).toBe(runner);
  });

  it("leaves out the entry the viewer reported, and only for them", async () => {
    const reporter = await makeUser();
    const bystander = await makeUser();
    const author = await makeUser();
    const reported = await postedBy(author);
    await fileReport({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: reported,
      reason: "spam",
    });

    const seenBy = async (viewer: string) => {
      const profile = await otherProfile(author, viewer);
      return profile?.recentPublicEntries.map((entry) => entry.entryId);
    };
    expect(await seenBy(reporter)).toStrictEqual([]);
    expect(await seenBy(bystander)).toStrictEqual([reported]);
  });
});

describe("profileAtHandle", () => {
  it("finds the runner holding the handle, and whether the viewer follows them", async () => {
    const viewer = await makeUser();
    const runner = await makeUser({ username: "pia_runs" });
    await follow(viewer, runner);

    const found = await profileAtHandle(viewer, "pia_runs");

    expect(found).toMatchObject({
      kind: "runner",
      isFollowing: true,
      profile: { userId: runner, username: "pia_runs" },
    });
  });

  it("says when the viewer does not follow them yet", async () => {
    const viewer = await makeUser();
    await makeUser({ username: "quin_runs" });

    expect(await profileAtHandle(viewer, "quin_runs")).toMatchObject({
      kind: "runner",
      isFollowing: false,
    });
  });

  it("answers `own` for the viewer's own handle", async () => {
    const viewer = await makeUser({ username: "rae_self" });

    expect(await profileAtHandle(viewer, "rae_self")).toStrictEqual({
      kind: "own",
    });
  });

  it("answers `changed` for a handle somebody used to hold, and names nobody", async () => {
    const viewer = await makeUser();
    const runner = await makeUser({ username: "sol_new" });
    await db()
      .insert(usernameHistory)
      .values({ username: "sol_old", userId: runner, retiredAt: NOW });

    expect(await profileAtHandle(viewer, "sol_old")).toStrictEqual({
      kind: "changed",
    });
  });

  it("answers nothing for a handle nobody has held, or one no handle could be", async () => {
    const viewer = await makeUser();

    expect(await profileAtHandle(viewer, "tia_nobody")).toBeUndefined();
    expect(await profileAtHandle(viewer, "_not a handle")).toBeUndefined();
  });

  it("answers nothing for a banned holder or one in a block pair", async () => {
    const viewer = await makeUser();
    const banned = await makeUser({ username: "uma_banned" });
    const blocked = await makeUser({ username: "uma_blocked" });
    await banUser({ userId: banned, reason: "spam", bannedBy: viewer });
    await blockRunner(blocked, viewer);

    expect(await profileAtHandle(viewer, "uma_banned")).toBeUndefined();
    expect(await profileAtHandle(viewer, "uma_blocked")).toBeUndefined();
  });
});

describe("D's under-review marker", () => {
  it("is set for the author of an entry hidden pending review", async () => {
    const { author, entryId } = await entryIn("hidden_pending_review");

    expect(await markerFor(entryId, author)).toBe(true);
  });

  it("is not set on an entry nobody hid, or one a person removed", async () => {
    const shown = await entryIn("ok");
    const removed = await entryIn("removed");

    expect(await markerFor(shown.entryId, shown.author)).toBe(false);
    expect(await markerFor(removed.entryId, removed.author)).toBe(false);
  });
});
