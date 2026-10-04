import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { outfitEntries, reports } from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  autoHideReporterThreshold,
  claimForReview,
  distinctReporterCount,
  fileReport,
  isBlocked,
  isQueuedForReview,
  pendingReviewQueue,
  reportedSubjectIdsFor,
} from "../../src/modules/safety";
import { isVerified } from "../../src/modules/account";

import {
  addAccount,
  makeEntry,
  makeRun,
  makeUser,
  resetSafetyTables,
  confirmedReporter,
} from "./helpers";
import { nowSeconds } from "../../src/lib/now";

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
  return makeEntry({ userId: author, runId, audience: "runners" });
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
        await fileReport(
          {
            reporterId: reporter,
            subjectType: "entry",
            subjectId: entryId,
            reason: "explicit",
          },
          confirmedReporter,
        ),
      );
    }

    // Only the third crosses it: the first two must leave the entry alone,
    // or "three reports" would be decoration on a one-report takedown.
    expect(results).toStrictEqual([
      { status: "filed", reporterCount: 1, hiddenPendingReview: false },
      { status: "filed", reporterCount: 2, hiddenPendingReview: false },
      { status: "filed", reporterCount: 3, hiddenPendingReview: true },
    ]);
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
      confirmedReporter,
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
        confirmedReporter,
      );
    }
    const [queued] = await pendingReviewQueue();
    if (!queued) throw new Error("nothing queued");
    expect(await claimForReview(queued.id, await makeUser())).toBe("claimed");

    expect(await isQueuedForReview("entry", entryId)).toBe(true);
  });

  it("does NOT hide it when one person reports three times", async () => {
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
        confirmedReporter,
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

    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const reporter = await makeUser();
      await fileReport(
        {
          reporterId: reporter,
          subjectType: "entry",
          subjectId: n === 0 ? second : first,
          reason: "other",
        },
        confirmedReporter,
      );
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

    await fileReport(
      {
        reporterId: reporter,
        subjectType: "entry",
        subjectId: sharedId,
        reason: "explicit",
      },
      confirmedReporter,
    );
    const asProduct = await fileReport(
      {
        reporterId: reporter,
        subjectType: "product",
        subjectId: sharedId,
        reason: "spam",
      },
      confirmedReporter,
    );

    expect(asProduct).toMatchObject({ status: "filed", reporterCount: 1 });
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

    await fileReport(
      {
        reporterId: me,
        subjectType: "entry",
        subjectId: mine,
        reason: "harassment",
      },
      confirmedReporter,
    );
    await fileReport(
      {
        reporterId: someoneElse,
        subjectType: "entry",
        subjectId: theirs,
        reason: "harassment",
      },
      confirmedReporter,
    );

    // The promise is "hidden from YOUR feed" — one report must not hide an
    // entry from everyone, which is the whole point of the threshold.
    expect(await reportedSubjectIdsFor(me, "entry")).toEqual([mine]);
    expect(await reportedSubjectIdsFor(someoneElse, "entry")).toEqual([theirs]);
    expect(await moderationStatusOf(mine)).toBe("ok");
  });

  it("separates subject types, so a feed filter gets only entries", async () => {
    const entryId = await reportableEntry();
    const me = await makeUser();

    await fileReport(
      {
        reporterId: me,
        subjectType: "entry",
        subjectId: entryId,
        reason: "other",
      },
      confirmedReporter,
    );
    await fileReport(
      {
        reporterId: me,
        subjectType: "product",
        subjectId: "some-product",
        reason: "spam",
      },
      confirmedReporter,
    );

    expect(await reportedSubjectIdsFor(me, "entry")).toEqual([entryId]);
    expect(await reportedSubjectIdsFor(me, "product")).toEqual([
      "some-product",
    ]);
  });
});

async function unconfirmedRunner(): Promise<string> {
  const userId = await makeUser();
  await addAccount(userId, false);
  return userId;
}

/**
`account`'s own check, as `fileReportAction` wires it.
*/
const accountGate = { isVerified };

describe("fileReport waits for a confirmed address (round 26 #11; SAF-15)", () => {
  beforeEach(resetSafetyTables);

  it("refuses an unconfirmed reporter with an answer, and writes nothing — the block included", async () => {
    const reporter = await unconfirmedRunner();
    const subject = await makeUser();

    expect(
      await fileReport(
        {
          reporterId: reporter,
          subjectType: "profile",
          subjectId: subject,
          reason: "harassment",
          alsoBlock: true,
        },
        accountGate,
      ),
    ).toStrictEqual({ status: "unverified" });

    expect(await distinctReporterCount("profile", subject)).toBe(0);
    expect(await reportedSubjectIdsFor(reporter, "profile")).toEqual([]);
    expect(await isBlocked(reporter, subject)).toBe(false);
  });

  it("does not let unconfirmed accounts reach the threshold", async () => {
    // An address nobody confirmed costs nothing to make: three of them
    // must not be a takedown on demand.
    const entryId = await reportableEntry();
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await fileReport(
        {
          reporterId: await unconfirmedRunner(),
          subjectType: "entry",
          subjectId: entryId,
          reason: "spam",
        },
        accountGate,
      );
    }

    expect(await moderationStatusOf(entryId)).toBe("ok");
    expect(await isQueuedForReview("entry", entryId)).toBe(false);
  });

  it("refuses a reporter with no account at all", async () => {
    const entryId = await reportableEntry();

    expect(
      await fileReport(
        {
          reporterId: await makeUser(),
          subjectType: "entry",
          subjectId: entryId,
          reason: "spam",
        },
        accountGate,
      ),
    ).toStrictEqual({ status: "unverified" });
    expect(await distinctReporterCount("entry", entryId)).toBe(0);
  });

  it("files once the address is confirmed", async () => {
    const entryId = await reportableEntry();
    const reporter = await makeUser();
    await addAccount(reporter, true);

    expect(
      await fileReport(
        {
          reporterId: reporter,
          subjectType: "entry",
          subjectId: entryId,
          reason: "spam",
        },
        accountGate,
      ),
    ).toStrictEqual({
      status: "filed",
      reporterCount: 1,
      hiddenPendingReview: false,
    });
  });
});

describe("W1's block-with-report checkbox", () => {
  beforeEach(resetSafetyTables);

  it("blocks the reported runner in the same call", async () => {
    const reporter = await makeUser();
    const subject = await makeUser();

    await fileReport(
      {
        reporterId: reporter,
        subjectType: "profile",
        subjectId: subject,
        reason: "harassment",
        alsoBlock: true,
      },
      confirmedReporter,
    );

    // One call, not two. A reporter who ticked the box and lost a second
    // request would be told the report worked while the block silently
    // did not.
    expect(await isBlocked(reporter, subject)).toBe(true);
  });

  it("does not block when the box was not ticked", async () => {
    const reporter = await makeUser();
    const subject = await makeUser();

    await fileReport(
      {
        reporterId: reporter,
        subjectType: "profile",
        subjectId: subject,
        reason: "harassment",
      },
      confirmedReporter,
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
      confirmedReporter,
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
    const subject = await makeUser();

    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      const reporter = await makeUser();
      await fileReport(
        {
          reporterId: reporter,
          subjectType: "profile",
          subjectId: subject,
          reason: "harassment",
        },
        confirmedReporter,
      );
    }

    // A reported profile is a ban decision, and a ban is a person's call —
    // so this reaches the queue and stops there.
    expect(await isQueuedForReview("profile", subject)).toBe(true);
  });
});
