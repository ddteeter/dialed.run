import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { outfitEntries, usernameHistory } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryDetailForViewer } from "../../src/modules/feed/entries";
import { followingFeed } from "../../src/modules/feed/feed";
import { follow } from "../../src/modules/feed/follows";
import {
  otherProfile,
  profileAtHandle,
  recentPublicEntriesStatement,
  visibleRunnerHandle,
  visibleRunnerStatement,
} from "../../src/modules/feed/profiles";
import { searchRunners, searchStatement } from "../../src/modules/feed/search";
import { banUser, blockRunner, fileReport } from "../../src/modules/safety";
import {
  entryAudienceColumns,
  makeEntry,
  makeRun,
  makeUser,
  resetTables,
  NOW,
} from "./helpers";
import { confirmedReporter } from "../safety/helpers";

/**
 * FEED-7 (R-107, R-108): a banned runner, and anyone in a block pair with
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

async function reportProfile(reporter: string, runner: string) {
  await fileReport(
    {
      reporterId: reporter,
      subjectType: "profile",
      subjectId: runner,
      reason: "spam",
    },
    confirmedReporter,
  );
}

async function planOf(statement: {
  toSQL: () => { sql: string; params: unknown[] };
}): Promise<string> {
  const { sql, params } = statement.toSQL();
  const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>();
  return plan.results.map((row) => row.detail).join("\n");
}

async function followingIds(viewer: string) {
  const page = await followingFeed(viewer);
  return page.items.map((item) => [item.entryId, item.underReview]);
}

async function postedBy(author: string): Promise<string> {
  return makeEntry({
    userId: author,
    runId: await makeRun({ userId: author }),
  });
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
    await fileReport(
      {
        reporterId: reporter,
        subjectType: "entry",
        subjectId: reported,
        reason: "spam",
      },
      confirmedReporter,
    );

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

describe("a runner whose profile the viewer reported (D-68)", () => {
  it("leaves the reporter's search, and nobody else's", async () => {
    const reporter = await makeUser();
    const bystander = await makeUser();
    const reported = await makeUser({ username: "vic_reported" });
    const kept = await makeUser({ username: "vic_kept" });
    await reportProfile(reporter, reported);

    expect(await foundIds(reporter, "vic")).toStrictEqual([kept]);
    const seenByBystander = await foundIds(bystander, "vic");
    expect(seenByBystander).toHaveLength(2);
    expect(seenByBystander).toContain(reported);
  });

  it("is not moved by a report against one of their entries", async () => {
    // A profile report and an entry report are different subjects, and
    // the entry's id is not the runner's.
    const reporter = await makeUser();
    const runner = await makeUser({ username: "wen_runs" });
    await fileReport(
      {
        reporterId: reporter,
        subjectType: "entry",
        subjectId: await postedBy(runner),
        reason: "spam",
      },
      confirmedReporter,
    );

    expect(await foundIds(reporter, "wen")).toStrictEqual([runner]);
    const profile = await otherProfile(runner, reporter);
    expect(profile?.userId).toBe(runner);
  });

  it("reads as not found on the reporter's H, by id and by handle, and nobody else's", async () => {
    const reporter = await makeUser();
    const bystander = await makeUser();
    const reported = await makeUser({ username: "xan_reported" });
    await reportProfile(reporter, reported);

    expect(await otherProfile(reported, reporter)).toBeUndefined();
    expect(await profileAtHandle(reporter, "xan_reported")).toBeUndefined();
    expect(await visibleRunnerHandle(reported, reporter)).toBeUndefined();
    const seenByBystander = await otherProfile(reported, bystander);
    expect(seenByBystander?.userId).toBe(reported);
    expect(await visibleRunnerHandle(reported, bystander)).toMatchObject({
      username: "xan_reported",
    });
  });

  it("probes the report on its unique index, and H reads the runner by primary key", async () => {
    const details = await planOf(
      visibleRunnerStatement(db(), "01RUNNER", "01VIEWER"),
    );

    expect(details).toMatch(
      /SEARCH user_profiles USING INDEX sqlite_autoindex_user_profiles_1 \(user_id=\?\)/u,
    );
    expect(details).toMatch(
      /SEARCH reports USING COVERING INDEX reports_one_per_reporter \(reporter_id=\? AND subject_type=\? AND subject_id=\?\)/u,
    );
    expect(details).not.toMatch(/SCAN/u);
  });

  it("keeps search's probe on the same index", async () => {
    const details = await planOf(searchStatement(db(), "01VIEWER", "maya"));

    expect(details).toMatch(
      /SEARCH reports USING COVERING INDEX reports_one_per_reporter \(reporter_id=\? AND subject_type=\? AND subject_id=\?\)/u,
    );
  });
});

describe("H's entries", () => {
  it("seek the runner's shared, settled entries newest first, the viewer's rule as probes", async () => {
    const details = await planOf(
      recentPublicEntriesStatement(db(), "01RUNNER", "01VIEWER"),
    );

    expect(details).toMatch(
      /SEARCH outfit_entries USING INDEX entries_user_public_created \(user_id=\? AND is_public=\? AND moderation_status=\?\)/u,
    );
    expect(
      details.match(
        /SEARCH blocks USING COVERING INDEX blocks_pk \(blocker_id=\? AND blocked_id=\?\)/gu,
      ),
    ).toHaveLength(2);
    expect(details).toMatch(
      /SEARCH reports USING COVERING INDEX reports_one_per_reporter \(reporter_id=\? AND subject_type=\? AND subject_id=\?\)/u,
    );
    expect(details).not.toMatch(/SCAN|TEMP B-TREE/u);
  });
});

describe("the author's own under-review entry on Following (D-67)", () => {
  it("stays in the author's feed, marked", async () => {
    const { author, entryId } = await entryIn("hidden_pending_review");
    const shown = await postedBy(author);

    // Both at the same instant, so their order is the ids' — not this
    // test's business.
    const ids = await followingIds(author);
    expect(ids).toHaveLength(2);
    expect(ids).toContainEqual([shown, false]);
    expect(ids).toContainEqual([entryId, true]);
  });

  it("is gone from a follower's feed, whose own entries are unmarked", async () => {
    const { author, entryId } = await entryIn("hidden_pending_review");
    const shown = await postedBy(author);
    const follower = await makeUser();
    await follow(follower, author);
    const theirs = await postedBy(follower);

    const ids = await followingIds(follower);

    expect(ids).toContainEqual([shown, false]);
    expect(ids).toContainEqual([theirs, false]);
    expect(ids.map(([id]) => id)).not.toContain(entryId);
  });

  it("does not bring back an entry a person removed, or one the author keeps private", async () => {
    const { author } = await entryIn("removed");
    await db()
      .update(outfitEntries)
      .set({
        ...entryAudienceColumns("private"),
        moderationStatus: "hidden_pending_review",
      })
      .where(eq(outfitEntries.id, await postedBy(author)));

    expect(await followingIds(author)).toStrictEqual([]);
  });

  it("still leaves out a followee blocked or reported by the viewer, and a banned one", async () => {
    const viewer = await makeUser();
    const blocked = await makeUser();
    const reported = await makeUser();
    const banned = await makeUser();
    for (const runner of [blocked, reported, banned]) {
      await follow(viewer, runner);
    }
    await postedBy(blocked);
    const reportedEntry = await postedBy(reported);
    await postedBy(banned);
    await blockRunner(viewer, blocked);
    await fileReport(
      {
        reporterId: viewer,
        subjectType: "entry",
        subjectId: reportedEntry,
        reason: "spam",
      },
      confirmedReporter,
    );
    await banUser({ userId: banned, reason: "spam", bannedBy: viewer });

    expect(await followingIds(viewer)).toStrictEqual([]);
  });
});
