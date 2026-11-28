import { and, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import {
  notifications,
  outfitEntries,
  reports,
  reviewQueue,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { resolveReview } from "../../src/modules/safety/review";
import { moderationThresholds } from "../../src/modules/safety/screening";
import {
  claimForReview,
  pendingReviewQueue,
  releaseReview,
} from "../../src/modules/safety/review/review";
import {
  distinctReporterCount,
  fileReport,
  isQueuedForReview,
  reportedSubjectIdsFor,
} from "../../src/modules/safety/reports/reports";
import { isBlocked } from "../../src/modules/safety/reports/blocks";
import { reportersToHide } from "../../src/modules/safety/screening/thresholds";

/**
 * How many distinct reporters hide a subject for a reason off the clock,
 * from the test config's invented thresholds (design 183), never a
 * hand-written number that would pin production's.
 */
const autoHideReporterThreshold = reportersToHide(
  "spam",
  moderationThresholds(),
);

import { noPurge } from "../purge-spy";
import {
  makeEntry,
  makeProduct,
  makeRun,
  makeUser,
  makeVerifiedUser,
  opened,
  resetSafetyTables,
} from "./helpers";
import { REPORT_HIDES_FLOOR } from "../../src/modules/safety/limits/breakers";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { oweInCore } from "../queue-fakes";

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

/**
Whether the entry's Review opening hid it (`review_queue.hid`).
*/
async function hidOf(entryId: string): Promise<number | null | undefined> {
  const [row] = await core()
    .select({ hid: reviewQueue.hid })
    .from(reviewQueue)
    .where(
      and(
        eq(reviewQueue.subjectType, "entry"),
        eq(reviewQueue.subjectId, entryId),
      ),
    );
  return row?.hid;
}

async function reportableEntry(): Promise<string> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  return makeEntry({ userId: author, runId, audience: "runners" });
}

describe("the distinct-reporter threshold", () => {
  beforeEach(resetSafetyTables);

  it("hides the entry once enough DIFFERENT people report it", async () => {
    const entryId = await reportableEntry();
    expect(await moderationStatusOf(entryId)).toBe("ok");

    const results = [];
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const reporter = await makeUser();
      results.push(
        await fileReport(
          {
            reporterId: reporter,
            subjectType: "entry",
            subjectId: entryId,
            reason: "explicit",
          },
          oweInCore,
          noPurge,
        ),
      );
    }

    // Only the last crosses it: every one before must leave the entry
    // alone, or the threshold would be decoration on a one-report takedown.
    expect(results).toStrictEqual(
      results.map((_, index) => ({
        status: "filed",
        reporterCount: index + 1,
        hiddenPendingReview: index + 1 === autoHideReporterThreshold,
      })),
    );
    expect(results).toHaveLength(autoHideReporterThreshold);
    expect(autoHideReporterThreshold).toBeGreaterThan(1);
    expect(await moderationStatusOf(entryId)).toBe("hidden_pending_review");
    expect(await isQueuedForReview("entry", entryId)).toBe(true);
  });

  it("stamps when a report was filed, in seconds", async () => {
    const entryId = await reportableEntry();
    const before = nowSeconds();

    await fileReport(
      {
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "spam",
      },
      oweInCore,
      noPurge,
    );

    const [row] = await core()
      .select({ createdAt: reports.createdAt })
      .from(reports);
    // Bounded both ways: the review queue and any later audit read this
    // column as seconds, and a millisecond value passes every one-sided
    // assertion while sorting a report ahead of everything forever.
    expect(row?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.createdAt).toBeLessThanOrEqual(before + 5);
  });

  it("is still queued once a reviewer has claimed it", async () => {
    // "Waiting on a person" covers both pending and claimed. A check
    // that named only `pending` would tell the report sheet a subject
    // someone is actively deciding has never been queued, and invite a
    // second queue row for it.
    const entryId = await reportableEntry();
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await fileReport(
        {
          reporterId: await makeUser(),
          subjectType: "entry",
          subjectId: entryId,
          reason: "spam",
        },
        oweInCore,
        noPurge,
      );
    }
    const [queued] = await pendingReviewQueue();
    if (!queued) throw new Error("nothing queued");
    expect(await claimForReview(queued.id, await makeUser(), "reports")).toBe(
      "claimed",
    );

    expect(await isQueuedForReview("entry", entryId)).toBe(true);
  });

  it("does NOT hide it when one person reports again and again", async () => {
    const entryId = await reportableEntry();
    const reporter = await makeUser();

    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const result = await fileReport(
        {
          reporterId: reporter,
          subjectType: "entry",
          subjectId: entryId,
          reason: "spam",
        },
        oweInCore,
        noPurge,
      );
      // Every repeat reports the same truth rather than erroring: a
      // double-click and a retried POST are indistinguishable (law 8b).
      expect(result).toEqual({
        status: "filed",
        reporterCount: 1,
        hiddenPendingReview: false,
      });
    }

    expect(await distinctReporterCount("entry", entryId)).toBe(1);
    expect(await moderationStatusOf(entryId)).toBe("ok");
    expect(await isQueuedForReview("entry", entryId)).toBe(false);
  });

  it("counts reporters per subject, not across subjects", async () => {
    const first = await reportableEntry();
    const second = await reportableEntry();

    // One short of the bar on `first`, and one more on `second`: together
    // they reach it, so a naive global count would wrongly hide both.
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const reporter = await makeUser();
      await fileReport(
        {
          reporterId: reporter,
          subjectType: "entry",
          subjectId: n === 0 ? second : first,
          reason: "other",
        },
        oweInCore,
        noPurge,
      );
    }

    expect(await distinctReporterCount("entry", first)).toBe(
      autoHideReporterThreshold - 1,
    );
    expect(await distinctReporterCount("entry", second)).toBe(1);
    expect(await moderationStatusOf(first)).toBe("ok");
    expect(await moderationStatusOf(second)).toBe("ok");
  });

  it("keeps the same id distinct across subject types", async () => {
    // An entry id and a product id could collide in principle; the UNIQUE
    // index includes subject_type precisely so they do not share a count.
    const sharedId = await reportableEntry();
    await makeProduct(sharedId);
    const reporter = await makeUser();

    await fileReport(
      {
        reporterId: reporter,
        subjectType: "entry",
        subjectId: sharedId,
        reason: "explicit",
      },
      oweInCore,
      noPurge,
    );
    const asProduct = await fileReport(
      {
        reporterId: reporter,
        subjectType: "product",
        subjectId: sharedId,
        reason: "spam",
      },
      oweInCore,
      noPurge,
    );

    expect(asProduct).toMatchObject({ status: "filed", reporterCount: 1 });
    expect(await distinctReporterCount("entry", sharedId)).toBe(1);
  });
});

/**
An entry report, as W1 files it.
*/
function report(
  entryId: string,
  reporterId: string,
  reason: "explicit" | "intimate",
) {
  return fileReport(
    { reporterId, subjectType: "entry", subjectId: entryId, reason },
    oweInCore,
    noPurge,
  );
}

/**
A second on from the faked clock.
*/
function later(): void {
  vi.setSystemTime(Date.now() + 1000);
}

/**
 * An entry hidden by ordinary reports, its row opened earlier, and the
 * page a reviewer read now.
 */
async function readPage(entryId: string) {
  for (let n = 0; n < autoHideReporterThreshold; n += 1) {
    await report(entryId, await makeUser(), "explicit");
  }
  await core()
    .update(reviewQueue)
    .set({ openedAt: nowSeconds() - 100 });
  const [page] = await pendingReviewQueue();
  if (page === undefined) throw new Error("nothing listed");
  return page;
}

/**
 * An entry reported to the bar, approved, with its reports and the
 * Approve moved into the past so a report now is filed after both.
 */
async function approvedEntry(): Promise<string> {
  const entryId = await reportableEntry();
  for (let n = 0; n < autoHideReporterThreshold; n += 1) {
    await report(entryId, await makeUser(), "explicit");
  }
  const [row] = await pendingReviewQueue();
  if (row === undefined) throw new Error("nothing queued");
  await resolveReview(row.id, await makeUser(), "approve");
  const now = nowSeconds();
  await core()
    .update(reports)
    .set({ createdAt: now - 100 });
  await core()
    .update(reviewQueue)
    .set({ approvedAt: now - 50 });
  return entryId;
}

function byId(one: string, other: string): number {
  return one.localeCompare(other);
}

describe("after a person approved it", () => {
  beforeEach(resetSafetyTables);

  it("records when it was approved, and keeps it when the row is opened again", async () => {
    const entryId = await reportableEntry();
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await report(entryId, await makeUser(), "explicit");
    }
    const [row] = await pendingReviewQueue();
    if (row === undefined) throw new Error("nothing queued");
    const before = nowSeconds();
    await resolveReview(row.id, await makeUser(), "approve");
    const [approved] = await core()
      .select({ approvedAt: reviewQueue.approvedAt })
      .from(reviewQueue);
    expect(approved?.approvedAt).toBeGreaterThanOrEqual(before);
    expect(approved?.approvedAt).toBeLessThanOrEqual(before + 5);

    await core().update(reviewQueue).set({ approvedAt: 7 });
    await report(entryId, await makeUser(), "intimate");

    const [reopened] = await core()
      .select({
        status: reviewQueue.status,
        approvedAt: reviewQueue.approvedAt,
      })
      .from(reviewQueue);
    expect(reopened).toStrictEqual({ status: "pending", approvedAt: 7 });
  });

  it("records the moment the page was read, and tells only those who reported by then", async () => {
    const entryId = await reportableEntry();
    const early = [];
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const reporter = await makeUser();
      early.push(reporter);
      await report(entryId, reporter, "explicit");
    }
    const [row] = await pendingReviewQueue();
    if (row === undefined) throw new Error("nothing queued");
    const now = nowSeconds();
    await core()
      .update(reports)
      .set({ createdAt: now - 100 });
    await core()
      .update(reviewQueue)
      .set({ openedAt: now - 100 });
    const late = await makeUser();
    await report(entryId, late, "explicit");
    await core()
      .update(reports)
      .set({ createdAt: now - 10 })
      .where(eq(reports.reporterId, late));

    expect(
      await resolveReview(row.id, await makeUser(), "approve", {
        openedAt: now - 100,
        source: "reports",
        readAt: now - 50,
      }),
    ).toBe("resolved");

    const [approved] = await core()
      .select({ approvedAt: reviewQueue.approvedAt })
      .from(reviewQueue);
    expect(approved?.approvedAt).toBe(now - 50);
    const told = await core()
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(eq(notifications.kind, "report_kept"));
    expect(told.map((notice) => notice.userId).toSorted(byId)).toStrictEqual(
      early.toSorted(byId),
    );
  });

  it("never records a read time later than now, nor earlier than the row's opening", async () => {
    for (const [readAt, expected] of [
      [nowSeconds() + 1000, "now"],
      [5, "opened"],
    ] as const) {
      await resetSafetyTables();
      const entryId = await reportableEntry();
      for (let n = 0; n < autoHideReporterThreshold; n += 1) {
        await report(entryId, await makeUser(), "explicit");
      }
      const [row] = await pendingReviewQueue();
      if (row === undefined) throw new Error("nothing queued");
      const before = nowSeconds();

      await resolveReview(row.id, await makeUser(), "approve", {
        openedAt: row.openedAt,
        source: row.source,
        readAt,
      });

      const [approved] = await core()
        .select({ approvedAt: reviewQueue.approvedAt })
        .from(reviewQueue);
      if (expected === "opened") {
        expect(approved?.approvedAt).toBe(row.openedAt);
      } else {
        expect(approved?.approvedAt).toBeGreaterThanOrEqual(before);
        expect(approved?.approvedAt).toBeLessThanOrEqual(nowSeconds());
      }
    }
  });

  describe("a report filed after the page was read", () => {
    beforeEach(() => {
      // The page is read at this second, and each report after it a
      // second later (`later`).
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-23T15:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("lets an Approve land though a report of an ordinary reason re-opened the row", async () => {
      const entryId = await reportableEntry();
      const page = await readPage(entryId);

      later();
      await report(entryId, await makeUser(), "explicit");

      expect(
        await resolveReview(page.id, await makeUser(), "approve", page),
      ).toBe("resolved");
    });

    it("refuses an Approve after a report of a reason that hides at once, and the reloaded page shows it", async () => {
      const entryId = await reportableEntry();
      const page = await readPage(entryId);

      later();
      await report(entryId, await makeUser(), "intimate");

      expect(
        await resolveReview(page.id, await makeUser(), "approve", page),
      ).toBe("already_resolved");
      expect(await moderationStatusOf(entryId)).not.toBe("ok");
      const [reloaded] = await pendingReviewQueue();
      expect(reloaded?.id).toBe(page.id);
      expect(reloaded?.reasons).toContain("intimate");

      const [again] = await pendingReviewQueue();
      if (again === undefined) throw new Error("nothing listed");
      expect(
        await resolveReview(page.id, await makeUser(), "approve", again),
      ).toBe("resolved");
    });

    it("lets a Remove land after a report of a reason that hides at once", async () => {
      const entryId = await reportableEntry();
      const page = await readPage(entryId);

      later();
      await report(entryId, await makeUser(), "intimate");

      expect(
        await resolveReview(page.id, await makeUser(), "remove", page),
      ).toBe("resolved");
    });
  });

  it("records no time for a burst release's Approve, which nobody opened", async () => {
    const entryId = await reportableEntry();
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await report(entryId, await makeUser(), "explicit");
    }
    const [row] = await pendingReviewQueue();
    if (row === undefined) throw new Error("nothing queued");

    expect(await releaseReview(row.id, await makeUser())).toBe("resolved");

    const [released] = await core()
      .select({
        status: reviewQueue.status,
        approvedAt: reviewQueue.approvedAt,
      })
      .from(reviewQueue);
    expect(released?.status).toBe("approved");
    expect(released?.approvedAt).toBeNull();
  });

  it("keeps the Approve's time when the row is then removed", async () => {
    const entryId = await reportableEntry();
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await report(entryId, await makeUser(), "explicit");
    }
    const [row] = await pendingReviewQueue();
    if (row === undefined) throw new Error("nothing queued");

    await resolveReview(row.id, await makeUser(), "remove");

    const [removed] = await core()
      .select({ approvedAt: reviewQueue.approvedAt })
      .from(reviewQueue);
    expect(removed?.approvedAt).toBeNull();
  });

  it("does not hide it again for one new reporter under the bar", async () => {
    const entryId = await approvedEntry();

    const filed = await report(entryId, await makeUser(), "explicit");

    expect(filed).toStrictEqual({
      status: "filed",
      reporterCount: 1,
      hiddenPendingReview: false,
    });
    expect(await moderationStatusOf(entryId)).toBe("ok");
    expect(await pendingReviewQueue()).toStrictEqual([]);
  });

  it("hides it again once enough new people report it", async () => {
    const entryId = await approvedEntry();

    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await report(entryId, await makeUser(), "explicit");
    }

    expect(await moderationStatusOf(entryId)).toBe("hidden_pending_review");
  });

  it("still hides it on one report of a reason that hides at once", async () => {
    const entryId = await approvedEntry();

    const filed = await report(entryId, await makeUser(), "intimate");

    expect(filed).toMatchObject({
      reporterCount: 1,
      hiddenPendingReview: true,
    });
    expect(await moderationStatusOf(entryId)).toBe("hidden_pending_review");
  });

  it("re-opens and hides nothing when an Approve lands between the count and the hide", async () => {
    expect(autoHideReporterThreshold).toBeGreaterThan(1);
    const entryId = await reportableEntry();
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await report(entryId, await makeUser(), "explicit");
    }
    await core()
      .update(reports)
      .set({ createdAt: nowSeconds() - 100 });
    const [row] = await pendingReviewQueue();
    if (row === undefined) throw new Error("nothing queued");
    // The moderator's Approve commits after the new report was counted
    // over the bar, just before its hide: the report's one batch.
    const binding = env.DIALED_CORE;
    const batch: D1Database["batch"] = binding.batch.bind(binding);
    const spy = vi
      .spyOn(binding, "batch")
      .mockImplementation(async <T>(statements: D1PreparedStatement[]) => {
        spy.mockRestore();
        await resolveReview(row.id, await makeUser(), "approve");
        return batch<T>(statements);
      });
    onTestFinished(() => {
      spy.mockRestore();
    });

    expect(await report(entryId, await makeUser(), "explicit")).toMatchObject({
      status: "filed",
    });
    expect(await moderationStatusOf(entryId)).toBe("ok");
    expect(await pendingReviewQueue()).toStrictEqual([]);
    const [settled] = await core()
      .select({ status: reviewQueue.status })
      .from(reviewQueue)
      .where(eq(reviewQueue.subjectId, entryId));
    expect(settled).toStrictEqual({ status: "approved" });
  });

  it("still hides on a report that is over the bar alone when an Approve lands first", async () => {
    const entryId = await reportableEntry();
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await report(entryId, await makeUser(), "explicit");
    }
    const [row] = await pendingReviewQueue();
    if (row === undefined) throw new Error("nothing queued");
    const binding = env.DIALED_CORE;
    const batch: D1Database["batch"] = binding.batch.bind(binding);
    const spy = vi
      .spyOn(binding, "batch")
      .mockImplementation(async <T>(statements: D1PreparedStatement[]) => {
        spy.mockRestore();
        await resolveReview(row.id, await makeUser(), "approve");
        // The Approve's second falls after the report's own time, as it
        // does when the clock ticks between the report's write and its
        // batch: the report still counts, as if filed a moment later.
        await core()
          .update(reviewQueue)
          .set({ approvedAt: nowSeconds() + 60 })
          .where(eq(reviewQueue.id, row.id));
        return batch<T>(statements);
      });
    onTestFinished(() => {
      spy.mockRestore();
    });

    // A reason that hides at once is over its bar on one report, so the
    // Approve before it answers nothing this report needs.
    await report(entryId, await makeUser(), "intimate");

    expect(await moderationStatusOf(entryId)).toBe("hidden_pending_review");
    const [reopened] = await core()
      .select({
        status: reviewQueue.status,
        approvedAt: reviewQueue.approvedAt,
      })
      .from(reviewQueue)
      .where(eq(reviewQueue.subjectId, entryId));
    expect(reopened?.status).toBe("pending");
    expect(reopened?.approvedAt).toBeTypeOf("number");
  });

  it("counts a report filed in the Approve's own second, and none before it", async () => {
    const entryId = await approvedEntry();
    const approvedAt = nowSeconds() + 60;
    await core().update(reviewQueue).set({ approvedAt });
    for (const createdAt of [approvedAt, approvedAt - 1]) {
      await core()
        .insert(reports)
        .values({
          id: newUlid(),
          reporterId: await makeUser(),
          subjectType: "entry",
          subjectId: entryId,
          reason: "explicit",
          createdAt,
        });
    }

    const filed = await fileReport(
      {
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
      },
      oweInCore,
      noPurge,
    );

    expect(filed).toMatchObject({ reporterCount: 1 });
  });
});

describe("the reporter's own hide (W1)", () => {
  beforeEach(resetSafetyTables);

  it("lists what this reporter reported, and nobody else's reports", async () => {
    const mine = await reportableEntry();
    const theirs = await reportableEntry();
    const me = await makeUser();
    const someoneElse = await makeUser();

    await fileReport(
      {
        reporterId: me,
        subjectType: "entry",
        subjectId: mine,
        reason: "harassment",
      },
      oweInCore,
      noPurge,
    );
    await fileReport(
      {
        reporterId: someoneElse,
        subjectType: "entry",
        subjectId: theirs,
        reason: "harassment",
      },
      oweInCore,
      noPurge,
    );

    // The promise is "hidden from YOUR feed" — one report must not hide an
    // entry from everyone, which is the whole point of the threshold.
    expect(await reportedSubjectIdsFor(me, "entry")).toEqual([mine]);
    expect(await reportedSubjectIdsFor(someoneElse, "entry")).toEqual([theirs]);
    expect(await moderationStatusOf(mine)).toBe("ok");
  });

  it("separates subject types, so a feed filter gets only entries", async () => {
    const entryId = await reportableEntry();
    const productId = await makeProduct();
    const me = await makeUser();

    await fileReport(
      {
        reporterId: me,
        subjectType: "entry",
        subjectId: entryId,
        reason: "other",
      },
      oweInCore,
      noPurge,
    );
    await fileReport(
      {
        reporterId: me,
        subjectType: "product",
        subjectId: productId,
        reason: "spam",
      },
      oweInCore,
      noPurge,
    );

    expect(await reportedSubjectIdsFor(me, "entry")).toEqual([entryId]);
    expect(await reportedSubjectIdsFor(me, "product")).toEqual([productId]);
  });
});

describe("W1's block-with-report checkbox", () => {
  beforeEach(resetSafetyTables);

  it("blocks the reported runner in the same call", async () => {
    const reporter = await makeUser();
    const subject = await makeVerifiedUser();

    await fileReport(
      {
        reporterId: reporter,
        subjectType: "profile",
        subjectId: subject,
        reason: "harassment",
        alsoBlock: true,
      },
      oweInCore,
      noPurge,
    );

    // One call, not two. A reporter who ticked the box and lost a second
    // request would be told the report worked while the block silently
    // did not.
    expect(await isBlocked(reporter, subject)).toBe(true);
  });

  it("answers a replay as the first call, though the block it made now hides the runner", async () => {
    const reporter = await makeUser();
    const subject = await makeVerifiedUser();
    const input = {
      reporterId: reporter,
      subjectType: "profile",
      subjectId: subject,
      reason: "harassment",
      alsoBlock: true,
    } as const;

    const first = await fileReport(input, oweInCore, noPurge);
    const replay = await fileReport(input, oweInCore, noPurge);

    expect(first).toMatchObject({ status: "filed", reporterCount: 1 });
    expect(replay).toStrictEqual({
      status: "filed",
      reporterCount: 1,
      hiddenPendingReview: false,
    });
  });

  it("does not block when the box was not ticked", async () => {
    const reporter = await makeUser();
    const subject = await makeVerifiedUser();

    await fileReport(
      {
        reporterId: reporter,
        subjectType: "profile",
        subjectId: subject,
        reason: "harassment",
      },
      oweInCore,
      noPurge,
    );

    expect(await isBlocked(reporter, subject)).toBe(false);
  });

  it("ignores the request on a subject that is not a person", async () => {
    const reporter = await makeUser();
    const entryId = await reportableEntry();

    await fileReport(
      {
        reporterId: reporter,
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
        alsoBlock: true,
      },
      oweInCore,
      noPurge,
    );

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
    const subject = await makeVerifiedUser();

    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const reporter = await makeUser();
      await fileReport(
        {
          reporterId: reporter,
          subjectType: "profile",
          subjectId: subject,
          reason: "harassment",
        },
        oweInCore,
        noPurge,
      );
    }

    // A reported profile is a ban decision, and a ban is a person's call —
    // so this reaches the queue and stops there.
    expect(await isQueuedForReview("profile", subject)).toBe(true);
  });
});

/**
Reports an entry by enough people to hide it, and says what the last report did.
*/
async function reportedToTheThreshold(entryId: string) {
  let last;
  for (let n = 0; n < autoHideReporterThreshold; n += 1) {
    last = await fileReport(
      {
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
      },
      oweInCore,
      noPurge,
    );
  }
  return last;
}

describe("the report breaker (design 164)", () => {
  beforeEach(resetSafetyTables);
  beforeEach(async () => {
    await core().delete(notifications);
  });

  it("still hides under its ceiling", async () => {
    await opened("reports", REPORT_HIDES_FLOOR - 1, nowSeconds());
    const entryId = await reportableEntry();

    const last = await reportedToTheThreshold(entryId);

    expect(last).toMatchObject({ hiddenPendingReview: true });
    expect(await moderationStatusOf(entryId)).toBe("hidden_pending_review");
    expect(await hidOf(entryId)).toBe(1);
  });

  it("only queues at its ceiling: nothing hidden, nobody told", async () => {
    await opened("reports", REPORT_HIDES_FLOOR, nowSeconds());
    const entryId = await reportableEntry();

    const last = await reportedToTheThreshold(entryId);

    expect(last).toMatchObject({ hiddenPendingReview: false });
    expect(await moderationStatusOf(entryId)).toBe("ok");
    expect(await isQueuedForReview("entry", entryId)).toBe(true);
    expect(await core().select().from(notifications)).toStrictEqual([]);
    expect(await hidOf(entryId)).toBe(0);
  });

  it("records each opening's own hide when a queued row is opened again", async () => {
    await opened("reports", REPORT_HIDES_FLOOR, nowSeconds());
    const entryId = await reportableEntry();
    await reportedToTheThreshold(entryId);
    expect(await hidOf(entryId)).toBe(0);

    // The flood's rows settle; the next report hides, and says so.
    await core().delete(reviewQueue).where(ne(reviewQueue.subjectId, entryId));
    await fileReport(
      {
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
      },
      oweInCore,
      noPurge,
    );

    expect(await moderationStatusOf(entryId)).toBe("hidden_pending_review");
    expect(await hidOf(entryId)).toBe(1);
  });

  it("does not count a report that hid at once (SA-L12)", async () => {
    const flooder = await makeUser();
    for (let n = 0; n < REPORT_HIDES_FLOOR; n += 1) {
      await fileReport(
        {
          reporterId: flooder,
          subjectType: "entry",
          subjectId: await reportableEntry(),
          reason: "intimate",
        },
        oweInCore,
        noPurge,
      );
    }
    const entryId = await reportableEntry();

    const last = await reportedToTheThreshold(entryId);

    expect(last).toMatchObject({ hiddenPendingReview: true });
    expect(await moderationStatusOf(entryId)).toBe("hidden_pending_review");
  });
});
