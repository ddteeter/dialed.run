import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  accountDeletions,
  entryPhotos,
  outfitEntries,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import type { Audience } from "../../src/lib/contracts";
import { entryPhotoKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { recentPublicEntriesStatement } from "../../src/modules/feed/consensus";
import { entryDetailForViewer } from "../../src/modules/feed/entries";
import { followingFeed } from "../../src/modules/feed/feed";
import { follow } from "../../src/modules/feed/follows";
import { isPhotoVisible, photoResponse } from "../../src/modules/feed/photos";
import { visibleRunnerHandle } from "../../src/modules/feed/profiles";
import { setUsefulReaction } from "../../src/modules/feed/reactions";
import { searchRunners } from "../../src/modules/feed/search";
import {
  banUser,
  blockRunner,
  fileReport,
  isUnderReviewForAuthor,
  publiclyVisibleEntry,
  unbanUser,
  unblockRunner,
} from "../../src/modules/safety";

import {
  makeEntry,
  makeRun,
  makeUser,
  makeVerifiedUser,
  NOW,
  resetSafetyTables,
} from "./helpers";

/**
 * The one visibility rule, observed through the reads that use it (task
 * 128: SAF-4's content filter, SAF-12's blocks, SAF-13's reporter hide).
 *
 * Every assertion is a read a runner makes — the feed, entry detail, a
 * photo, a Useful — rather than the predicate's SQL, because the defect
 * this lane exists to fix is a rule nothing called (R-107, R-108).
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
A public entry by a fresh author, with one screened photo.
*/
async function postedEntry(): Promise<{
  author: string;
  entryId: string;
  photoKey: string;
}> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({ userId: author, runId });
  const photoId = newUlid();
  const photoKey = entryPhotoKeyFor(author, entryId, photoId);
  await core().insert(entryPhotos).values({
    id: photoId,
    entryId,
    photoKey,
    position: 0,
    screenStatus: "pass",
  });
  return { author, entryId, photoKey };
}

/**
Whether `viewerId` meets this entry anywhere it can be met.
*/
async function sightings(viewerId: string, entryId: string, photoKey: string) {
  const feed = await followingFeed(viewerId);
  return {
    inFeed: feed.items.some((item) => item.entryId === entryId),
    detail: (await entryDetailForViewer(entryId, viewerId)) !== undefined,
    photo: await isPhotoVisible(photoKey, viewerId),
  };
}

const SEEN = { inFeed: true, detail: true, photo: true };
const UNSEEN = { inFeed: false, detail: false, photo: false };

/**
The entries Your conditions may count, as the anonymous rule reads them.
*/
async function countable(
  database: ReturnType<typeof core>,
  viewerId?: string,
): Promise<string[]> {
  const rows = await recentPublicEntriesStatement(database, NOW - 60, viewerId);
  return rows.map((row) => row.id);
}

describe("a banned author (SAF-4)", () => {
  beforeEach(resetSafetyTables);

  it("leaves the feed, entry detail and the photo route, and comes back on unban", async () => {
    const { author, entryId, photoKey } = await postedEntry();
    const viewer = await makeUser();
    await follow(viewer, author);
    expect(await sightings(viewer, entryId, photoKey)).toEqual(SEEN);

    await banUser({ userId: author, reason: "spam", bannedBy: viewer });
    expect(await sightings(viewer, entryId, photoKey)).toEqual(UNSEEN);
    const refused = await photoResponse(photoKey, viewer);
    expect(refused.status).toBe(404);

    await unbanUser(author, viewer);
    expect(await sightings(viewer, entryId, photoKey)).toEqual(SEEN);
  });

  it("stops counting in Your conditions, where nobody is named", async () => {
    const { author, entryId } = await postedEntry();
    expect(await countable(core())).toContain(entryId);

    await banUser({ userId: author, reason: "spam", bannedBy: author });
    expect(await countable(core())).not.toContain(entryId);
  });

  it("cannot be marked Useful", async () => {
    const { author, entryId } = await postedEntry();
    const viewer = await makeVerifiedUser();
    await banUser({ userId: author, reason: "spam", bannedBy: viewer });
    await expect(setUsefulReaction(entryId, viewer, true)).rejects.toThrow(
      "entry is not visible to this viewer",
    );
  });
});

/**
A runner's deletion requested: the claim row, which is the hide.
*/
async function leave(userId: string) {
  await core()
    .insert(accountDeletions)
    .values({ userId, requestedAt: NOW, purgeAfter: NOW + 1 });
}

describe("a runner deleting their account (task 126, ACC-9)", () => {
  beforeEach(async () => {
    await resetSafetyTables();
    await core().delete(accountDeletions);
  });

  it("leaves the feed, entry detail and the photo route at once, and comes back as it was on Keep", async () => {
    const { author, entryId, photoKey } = await postedEntry();
    const viewer = await makeUser();
    await follow(viewer, author);
    expect(await sightings(viewer, entryId, photoKey)).toEqual(SEEN);

    await leave(author);
    expect(await sightings(viewer, entryId, photoKey)).toEqual(UNSEEN);

    // Keep deletes the claim, and nothing about the entry had changed.
    await core().delete(accountDeletions);
    expect(await sightings(viewer, entryId, photoKey)).toEqual(SEEN);
  });

  it("stops counting toward anyone's Call at once", async () => {
    const { author, entryId } = await postedEntry();
    expect(await countable(core())).toContain(entryId);
    await leave(author);
    expect(await countable(core())).not.toContain(entryId);
  });

  it("leaves runner search and their profile, for everyone else", async () => {
    const leaving = await makeUser({ username: "leaving_runner" });
    const viewer = await makeUser();
    const found = await searchRunners(viewer, "leaving_r");
    expect(found.map((row) => row.username)).toStrictEqual(["leaving_runner"]);
    expect(await visibleRunnerHandle(leaving, viewer)).toMatchObject({
      username: "leaving_runner",
    });

    await leave(leaving);
    expect(await searchRunners(viewer, "leaving_r")).toStrictEqual([]);
    expect(await visibleRunnerHandle(leaving, viewer)).toBeUndefined();
  });

  it("hides nobody else", async () => {
    const { entryId, photoKey } = await postedEntry();
    const bystander = await makeUser();
    const viewer = await makeUser();
    await leave(bystander);
    const seen = await sightings(viewer, entryId, photoKey);
    expect(seen.detail).toBe(true);
    expect(await countable(core())).toContain(entryId);
  });
});

describe("a block (SAF-12)", () => {
  beforeEach(resetSafetyTables);

  it("hides each runner's entries from the other, both ways, until unblocked", async () => {
    const first = await postedEntry();
    const second = await postedEntry();
    await follow(first.author, second.author);
    await follow(second.author, first.author);
    expect(
      await sightings(first.author, second.entryId, second.photoKey),
    ).toEqual(SEEN);

    // One row, blocker -> blocked, and both of them lose the other.
    await blockRunner(first.author, second.author);
    expect(
      await sightings(first.author, second.entryId, second.photoKey),
    ).toEqual(UNSEEN);
    expect(
      await sightings(second.author, first.entryId, first.photoKey),
    ).toEqual(UNSEEN);

    await unblockRunner(first.author, second.author);
    expect(
      await sightings(first.author, second.entryId, second.photoKey),
    ).toEqual(SEEN);
    expect(
      await sightings(second.author, first.entryId, first.photoKey),
    ).toEqual(SEEN);
  });

  it("hides nothing from a third runner", async () => {
    const posted = await postedEntry();
    const blocker = await makeUser();
    const bystander = await makeUser();
    await follow(bystander, posted.author);
    await blockRunner(blocker, posted.author);
    expect(await sightings(bystander, posted.entryId, posted.photoKey)).toEqual(
      SEEN,
    );
  });

  it("leaves the anonymous counts alone (docs/contracts.md)", async () => {
    const posted = await postedEntry();
    const blocker = await makeUser();
    await blockRunner(blocker, posted.author);
    expect(await countable(core(), blocker)).toContain(posted.entryId);
  });

  it("stops a blocked runner marking the entry Useful", async () => {
    const posted = await postedEntry();
    const blocked = await makeVerifiedUser();
    await blockRunner(posted.author, blocked);
    await expect(
      setUsefulReaction(posted.entryId, blocked, true),
    ).rejects.toThrow("entry is not visible to this viewer");
  });
});

describe("a reporter's own hide (SAF-13)", () => {
  beforeEach(resetSafetyTables);

  it("hides the entry from the reporter at once, and from nobody else", async () => {
    const posted = await postedEntry();
    const reporter = await makeUser();
    const bystander = await makeUser();
    await follow(reporter, posted.author);
    await follow(bystander, posted.author);

    const filed = await fileReport({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: posted.entryId,
      reason: "spam",
    });
    // One report is far under the threshold: nothing global happened.
    expect(filed).toMatchObject({
      status: "filed",
      hiddenPendingReview: false,
    });

    expect(await sightings(reporter, posted.entryId, posted.photoKey)).toEqual(
      UNSEEN,
    );
    expect(await sightings(bystander, posted.entryId, posted.photoKey)).toEqual(
      SEEN,
    );
  });

  it("is about entries: reporting a product or a profile id hides no entry", async () => {
    const posted = await postedEntry();
    const reporter = await makeUser();
    await follow(reporter, posted.author);
    // The same id under another subject type must not match the entry's
    // probe — the subject type is part of what was reported.
    await fileReport({
      reporterId: reporter,
      subjectType: "product",
      subjectId: posted.entryId,
      reason: "spam",
    });
    expect(await sightings(reporter, posted.entryId, posted.photoKey)).toEqual(
      SEEN,
    );
  });
});

describe("the owner", () => {
  beforeEach(resetSafetyTables);

  it("still sees their own entry however it is moderated", async () => {
    const posted = await postedEntry();
    await core()
      .update(outfitEntries)
      .set({
        moderationStatus: "hidden_pending_review",
        audience: "private",
      })
      .where(eq(outfitEntries.id, posted.entryId));
    const own = await entryDetailForViewer(posted.entryId, posted.author);
    expect(own?.id).toBe(posted.entryId);
    expect(await isPhotoVisible(posted.photoKey, posted.author)).toBe(true);
  });
});

/**
The audience is the whole sharing rule (D-109, design 131).
*/
async function setAudience(entryId: string, audience: Audience): Promise<void> {
  await core()
    .update(outfitEntries)
    .set({ audience })
    .where(eq(outfitEntries.id, entryId));
}

describe("the audience", () => {
  beforeEach(resetSafetyTables);

  it("hides a groups entry from strangers and from every count, and shows it to its owner", async () => {
    const posted = await postedEntry();
    const viewer = await makeUser();
    await follow(viewer, posted.author);
    await setAudience(posted.entryId, "groups");

    expect(await sightings(viewer, posted.entryId, posted.photoKey)).toEqual(
      UNSEEN,
    );
    expect(await countable(core())).not.toContain(posted.entryId);
    const own = await entryDetailForViewer(posted.entryId, posted.author);
    expect(own).toMatchObject({ id: posted.entryId, audience: "groups" });
    expect(await isPhotoVisible(posted.photoKey, posted.author)).toBe(true);
  });

  it("shows a runners entry and hides a private one, in sightings and counts", async () => {
    const shown = await postedEntry();
    const hidden = await postedEntry();
    const viewer = await makeUser();
    await follow(viewer, shown.author);
    await follow(viewer, hidden.author);
    await setAudience(shown.entryId, "runners");
    await setAudience(hidden.entryId, "private");

    expect(await sightings(viewer, shown.entryId, shown.photoKey)).toEqual(
      SEEN,
    );
    expect(await sightings(viewer, hidden.entryId, hidden.photoKey)).toEqual(
      UNSEEN,
    );
    const counted = await countable(core());
    expect(counted).toContain(shown.entryId);
    expect(counted).not.toContain(hidden.entryId);
  });
});

describe("signed out (SAF-14)", () => {
  beforeEach(resetSafetyTables);

  it("gets no photo, even a public and screened one", async () => {
    const posted = await postedEntry();
    expect(await isPhotoVisible(posted.photoKey, undefined)).toBe(false);
    const response = await photoResponse(posted.photoKey, undefined);
    expect(response.status).toBe(404);
  });
});

describe("the rule's cost", () => {
  it("probes blocks, reports and profiles by index, never a scan", async () => {
    const { sql, params } = core()
      .select({ id: outfitEntries.id })
      .from(outfitEntries)
      .where(publiclyVisibleEntry("01VIEWER"))
      .limit(20)
      .toSQL();
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).not.toMatch(/SCAN\s+outfit_entries/i);
    expect(details).not.toMatch(/SCAN\s+(blocks|reports|user_profiles)/i);
  });
});

describe("R-62's predicate (SAF-9)", () => {
  const author = "01AUTHOR";

  it("is true for the author of an entry hidden pending review", () => {
    expect(
      isUnderReviewForAuthor(
        { userId: author, moderationStatus: "hidden_pending_review" },
        author,
      ),
    ).toBe(true);
  });

  it("is false for anyone else, and for signed out", () => {
    const entry = { userId: author, moderationStatus: "hidden_pending_review" };
    expect(isUnderReviewForAuthor(entry, "01SOMEONE")).toBe(false);
    expect(isUnderReviewForAuthor(entry, undefined)).toBe(false);
  });

  it.each(["ok", "removed"])(
    "is false for the author when the entry is %s",
    (moderationStatus) => {
      expect(
        isUnderReviewForAuthor({ userId: author, moderationStatus }, author),
      ).toBe(false);
    },
  );
});
