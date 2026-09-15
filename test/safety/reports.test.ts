import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { outfitEntries } from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  autoHideReporterThreshold,
  distinctReporterCount,
  fileReport,
  isBlocked,
  isQueuedForReview,
  reportedSubjectIdsFor,
} from "../../src/modules/safety";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

function core() {
  return drizzle(env.DIALED_CORE);
}

async function moderationStatusOf(entryId: string): Promise<string> {
  const [row] = await core()
    .select({ status: outfitEntries.moderationStatus })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId))
    .limit(1);
  if (!row) throw new Error("entry vanished");
  return row.status;
}

async function reportableEntry(): Promise<string> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  return makeEntry({ userId: author, runId, isPublic: true });
}

describe("the distinct-reporter threshold", () => {
  beforeEach(resetSafetyTables);

  it("hides the entry once three DIFFERENT people report it", async () => {
    const entryId = await reportableEntry();
    expect(await moderationStatusOf(entryId)).toBe("ok");

    const results = [];
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const reporter = await makeUser();
      results.push(
        await fileReport({
          reporterId: reporter,
          subjectType: "entry",
          subjectId: entryId,
          reason: "explicit",
        }),
      );
    }

    // Only the third crosses it: the first two must leave the entry alone,
    // or "three reports" would be decoration on a one-report takedown.
    expect(results.map((r) => r.hiddenPendingReview)).toEqual([
      false,
      false,
      true,
    ]);
    expect(results.map((r) => r.reporterCount)).toEqual([1, 2, 3]);
    expect(await moderationStatusOf(entryId)).toBe("hidden_pending_review");
    expect(await isQueuedForReview("entry", entryId)).toBe(true);
  });

  it("does NOT hide it when one person reports three times", async () => {
    const entryId = await reportableEntry();
    const reporter = await makeUser();

    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const result = await fileReport({
        reporterId: reporter,
        subjectType: "entry",
        subjectId: entryId,
        reason: "spam",
      });
      // Every repeat reports the same truth rather than erroring: a
      // double-click and a retried POST are indistinguishable (law 8b).
      expect(result).toEqual({ reporterCount: 1, hiddenPendingReview: false });
    }

    expect(await distinctReporterCount("entry", entryId)).toBe(1);
    expect(await moderationStatusOf(entryId)).toBe("ok");
    expect(await isQueuedForReview("entry", entryId)).toBe(false);
  });

  it("counts reporters per subject, not across subjects", async () => {
    const first = await reportableEntry();
    const second = await reportableEntry();

    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const reporter = await makeUser();
      await fileReport({
        reporterId: reporter,
        subjectType: "entry",
        subjectId: n === 0 ? second : first,
        reason: "other",
      });
    }

    // Two reporters on `first` and one on `second` — neither reaches three,
    // so a naive global count would wrongly hide both.
    expect(await distinctReporterCount("entry", first)).toBe(2);
    expect(await distinctReporterCount("entry", second)).toBe(1);
    expect(await moderationStatusOf(first)).toBe("ok");
    expect(await moderationStatusOf(second)).toBe("ok");
  });

  it("keeps the same id distinct across subject types", async () => {
    // An entry id and a product id could collide in principle; the UNIQUE
    // index includes subject_type precisely so they do not share a count.
    const sharedId = await reportableEntry();
    const reporter = await makeUser();

    await fileReport({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: sharedId,
      reason: "explicit",
    });
    const asProduct = await fileReport({
      reporterId: reporter,
      subjectType: "product",
      subjectId: sharedId,
      reason: "spam",
    });

    expect(asProduct.reporterCount).toBe(1);
    expect(await distinctReporterCount("entry", sharedId)).toBe(1);
  });
});

describe("the reporter's own hide (W1)", () => {
  beforeEach(resetSafetyTables);

  it("lists what this reporter reported, and nobody else's reports", async () => {
    const mine = await reportableEntry();
    const theirs = await reportableEntry();
    const me = await makeUser();
    const someoneElse = await makeUser();

    await fileReport({
      reporterId: me,
      subjectType: "entry",
      subjectId: mine,
      reason: "harassment",
    });
    await fileReport({
      reporterId: someoneElse,
      subjectType: "entry",
      subjectId: theirs,
      reason: "harassment",
    });

    // The promise is "hidden from YOUR feed" — one report must not hide an
    // entry from everyone, which is the whole point of the threshold.
    expect(await reportedSubjectIdsFor(me, "entry")).toEqual([mine]);
    expect(await reportedSubjectIdsFor(someoneElse, "entry")).toEqual([theirs]);
    expect(await moderationStatusOf(mine)).toBe("ok");
  });

  it("separates subject types, so a feed filter gets only entries", async () => {
    const entryId = await reportableEntry();
    const me = await makeUser();

    await fileReport({
      reporterId: me,
      subjectType: "entry",
      subjectId: entryId,
      reason: "other",
    });
    await fileReport({
      reporterId: me,
      subjectType: "product",
      subjectId: "some-product",
      reason: "spam",
    });

    expect(await reportedSubjectIdsFor(me, "entry")).toEqual([entryId]);
    expect(await reportedSubjectIdsFor(me, "product")).toEqual([
      "some-product",
    ]);
  });
});

describe("W1's block-with-report checkbox", () => {
  beforeEach(resetSafetyTables);

  it("blocks the reported runner in the same call", async () => {
    const reporter = await makeUser();
    const subject = await makeUser();

    await fileReport({
      reporterId: reporter,
      subjectType: "profile",
      subjectId: subject,
      reason: "harassment",
      alsoBlock: true,
    });

    // One call, not two. A reporter who ticked the box and lost a second
    // request would be told the report worked while the block silently
    // did not.
    expect(await isBlocked(reporter, subject)).toBe(true);
  });

  it("does not block when the box was not ticked", async () => {
    const reporter = await makeUser();
    const subject = await makeUser();

    await fileReport({
      reporterId: reporter,
      subjectType: "profile",
      subjectId: subject,
      reason: "harassment",
    });

    expect(await isBlocked(reporter, subject)).toBe(false);
  });

  it("ignores the request on a subject that is not a person", async () => {
    const reporter = await makeUser();
    const entryId = await reportableEntry();

    await fileReport({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: entryId,
      reason: "explicit",
      alsoBlock: true,
    });

    // An entry id is not a user id. Blocking it would create a row naming
    // a person who does not exist — and W1 only offers the checkbox where
    // there is somebody to block, so this is the same rule on the write
    // side.
    expect(await isBlocked(reporter, entryId)).toBe(false);
  });
});

describe("subjects with no moderation column of their own", () => {
  beforeEach(resetSafetyTables);

  it("queues a reported profile without hiding anything", async () => {
    const subject = await makeUser();

    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const reporter = await makeUser();
      await fileReport({
        reporterId: reporter,
        subjectType: "profile",
        subjectId: subject,
        reason: "harassment",
      });
    }

    // A reported profile is a ban decision, and a ban is a person's call —
    // so this reaches the queue and stops there.
    expect(await isQueuedForReview("profile", subject)).toBe(true);
  });
});
