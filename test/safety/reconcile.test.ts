import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { outfitEntries, reports, reviewQueue } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  autoHideReporterThreshold,
  claimForReview,
  claimLeaseSeconds,
  fileReport,
  pendingReviewQueue,
  reconcileUnhiddenReports,
  releaseStaleClaims,
} from "../../src/modules/safety";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

function core() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await resetSafetyTables();
});

/**
 * An entry with `autoHideReporterThreshold` reports written DIRECTLY,
 * bypassing `fileReport`.
 *
 * That bypass is the whole point: it reproduces the state a worker leaves
 * behind when it dies after the report insert and before the hide. Going
 * through `fileReport` would hide the entry on the way in and there would
 * be nothing left to reconcile.
 */
async function reportedButNotHidden(): Promise<string> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({ userId: author, runId, isPublic: true });

  for (let n = 0; n < autoHideReporterThreshold; n += 1) {
    await core().insert(reports).values({
      id: newUlid(),
      reporterId: await makeUser(),
      subjectType: "entry",
      subjectId: entryId,
      reason: "explicit",
      createdAt: nowSeconds(),
    });
  }
  return entryId;
}

async function statusOf(entryId: string): Promise<string | undefined> {
  const [row] = await core()
    .select({ status: outfitEntries.moderationStatus })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  return row?.status;
}

describe("reconciling reports that crossed the threshold and were never hidden", () => {
  it("hides the entry and puts it in front of a person", async () => {
    const entryId = await reportedButNotHidden();
    // The state a crash leaves: enough reporters, still public.
    expect(await statusOf(entryId)).toBe("ok");

    const outcome = await reconcileUnhiddenReports();

    expect(outcome).toStrictEqual({ found: 1, hidden: 1 });
    expect(await statusOf(entryId)).toBe("hidden_pending_review");
    const queued = await pendingReviewQueue();
    expect(queued.map((row) => row.subjectId)).toStrictEqual([entryId]);
  });

  it("leaves a subject one report short alone", async () => {
    const author = await makeUser();
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({ userId: author, runId, isPublic: true });
    for (let n = 0; n < autoHideReporterThreshold - 1; n += 1) {
      await core().insert(reports).values({
        id: newUlid(),
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
        createdAt: nowSeconds(),
      });
    }

    expect(await reconcileUnhiddenReports()).toStrictEqual({
      found: 0,
      hidden: 0,
    });
    expect(await statusOf(entryId)).toBe("ok");
  });

  it("counts people, not reports", async () => {
    // The UNIQUE index makes a second report by the same person impossible,
    // so this asserts the threshold is read off distinct reporters rather
    // than off a raw row count that a future schema change could diverge
    // from.
    const author = await makeUser();
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({ userId: author, runId, isPublic: true });
    const reporter = await makeUser();
    await core().insert(reports).values({
      id: newUlid(),
      reporterId: reporter,
      subjectType: "entry",
      subjectId: entryId,
      reason: "explicit",
      createdAt: nowSeconds(),
    });
    // The same person reporting several DIFFERENT subjects must not add up
    // to a threshold on any one of them.
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await core().insert(reports).values({
        id: newUlid(),
        reporterId: reporter,
        subjectType: "entry",
        subjectId: newUlid(),
        reason: "explicit",
        createdAt: nowSeconds(),
      });
    }

    const outcome = await reconcileUnhiddenReports();
    expect(outcome.hidden).toBe(0);
    expect(await statusOf(entryId)).toBe("ok");
  });

  it("does not re-hide a subject a reviewer already approved", async () => {
    // The case that makes "no queue row" the right marker. An approved
    // subject keeps its row, so reconciliation passes over it — otherwise
    // the sweep would undo a person's decision every hour, forever.
    const entryId = await reportedButNotHidden();
    await reconcileUnhiddenReports();
    const [queued] = await pendingReviewQueue();
    if (!queued) throw new Error("nothing queued");
    await core()
      .update(reviewQueue)
      .set({ status: "approved" })
      .where(eq(reviewQueue.id, queued.id));
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "ok" })
      .where(eq(outfitEntries.id, entryId));

    expect(await reconcileUnhiddenReports()).toStrictEqual({
      found: 0,
      hidden: 0,
    });
    expect(await statusOf(entryId)).toBe("ok");
  });

  it("is safe to run twice", async () => {
    // Law 1: crons re-fire. The second run must find nothing left to do
    // rather than queue the same subject again.
    await reportedButNotHidden();
    const first = await reconcileUnhiddenReports();
    expect(first.hidden).toBe(1);
    expect(await reconcileUnhiddenReports()).toStrictEqual({
      found: 0,
      hidden: 0,
    });
  });
});

/**
 * A queued entry with its review row already claimed — the state every
 * lease test starts from.
 */
async function queuedAndClaimed(): Promise<string> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({ userId: author, runId, isPublic: true });
  for (let n = 0; n < autoHideReporterThreshold; n += 1) {
    await fileReport({
      reporterId: await makeUser(),
      subjectType: "entry",
      subjectId: entryId,
      reason: "explicit",
    });
  }
  const [queued] = await pendingReviewQueue();
  if (!queued) throw new Error("nothing queued");
  expect(await claimForReview(queued.id, await makeUser())).toBe("claimed");
  return queued.id;
}

describe("review claims expire", () => {

  it("holds the lease for thirty minutes", () => {
    // Pinned as a number, not as `30 * 60`.
    //
    // Every other test here uses `claimLeaseSeconds` symbolically, which
    // is right — they are about the boundary behaviour, not the value —
    // but it means they all pass whatever the constant says. The mutation
    // gate caught exactly that: `30 * 60` mutated to `30 / 60` survived
    // the whole file, and a half-second lease would return every row to
    // the queue while its reviewer was still reading it. The lease length
    // is a product decision, so something has to assert the decision.
    expect(claimLeaseSeconds).toBe(1800);
  });

  it("takes a row back once its lease has run out", async () => {
    const queueId = await queuedAndClaimed();
    // Claimed rows leave the queue — which is exactly why an abandoned
    // claim is invisible rather than merely slow.
    expect(await pendingReviewQueue()).toStrictEqual([]);

    const outcome = await releaseStaleClaims(
      nowSeconds() + claimLeaseSeconds + 1,
    );

    expect(outcome).toStrictEqual({ released: 1 });
    const queue = await pendingReviewQueue();
    expect(queue.map((row) => row.id)).toStrictEqual([queueId]);
  });

  it("leaves a reviewer who is still inside the lease alone", async () => {
    await queuedAndClaimed();
    expect(await releaseStaleClaims()).toStrictEqual({ released: 0 });
    expect(await pendingReviewQueue()).toStrictEqual([]);
  });

  it("holds the row for exactly the lease and not a second less", async () => {
    // `lt`, not `lte`: on the boundary the reviewer has held it for the
    // lease and not longer, so the row stays theirs.
    await queuedAndClaimed();
    expect(
      await releaseStaleClaims(nowSeconds() + claimLeaseSeconds),
    ).toStrictEqual({ released: 0 });
  });

  it("clears the stale reviewer, so a released row reads as untouched", async () => {
    const queueId = await queuedAndClaimed();
    await releaseStaleClaims(nowSeconds() + claimLeaseSeconds + 1);

    const [row] = await core()
      .select({
        resolvedBy: reviewQueue.resolvedBy,
        claimedAt: reviewQueue.claimedAt,
      })
      .from(reviewQueue)
      .where(eq(reviewQueue.id, queueId));
    // Left set, both would say "somebody looked at this", which is the one
    // thing that did not happen.
    expect(row?.resolvedBy).toBeNull();
    expect(row?.claimedAt).toBeNull();
  });

  it("lets the row be claimed again afterwards", async () => {
    const queueId = await queuedAndClaimed();
    await releaseStaleClaims(nowSeconds() + claimLeaseSeconds + 1);
    expect(await claimForReview(queueId, await makeUser())).toBe("claimed");
  });

  it("does not touch rows nobody has claimed", async () => {
    const entryId = await reportedButNotHidden();
    await reconcileUnhiddenReports();
    expect(
      await releaseStaleClaims(nowSeconds() + claimLeaseSeconds + 1),
    ).toStrictEqual({ released: 0 });
    const queue = await pendingReviewQueue();
    expect(queue.map((row) => row.subjectId)).toStrictEqual([entryId]);
  });
});
