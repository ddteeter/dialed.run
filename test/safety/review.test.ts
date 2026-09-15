import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { outfitEntries, products, reviewQueue } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  autoHideReporterThreshold,
  claimForReview,
  fileReport,
  pendingReviewCount,
  pendingReviewQueue,
  resolveReview,
} from "../../src/modules/safety";

import { makeEntry, makeRun, makeUser, NOW, resetSafetyTables } from "./helpers";

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
 * Reports an entry up to the threshold and returns it with its queue row —
 * the state every test below starts from.
 */
async function queuedEntry(): Promise<{ entryId: string; queueId: string }> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({ userId: author, runId, isPublic: true });

  for (let n = 0; n < autoHideReporterThreshold; n += 1) {
    const reporter = await makeUser();
    await fileReport({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: entryId,
      reason: "explicit",
    });
  }

  const [queued] = await pendingReviewQueue();
  if (!queued) throw new Error("nothing queued");
  return { entryId, queueId: queued.id };
}

async function statusOf(entryId: string): Promise<string> {
  const [row] = await core()
    .select({ status: outfitEntries.moderationStatus })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId))
    .limit(1);
  if (!row) throw new Error("entry vanished");
  return row.status;
}

describe("claiming a decision (law 2)", () => {
  beforeEach(resetSafetyTables);

  it("lets the first claim through and refuses the second", async () => {
    const { queueId } = await queuedEntry();
    const reviewer = await makeUser();
    const other = await makeUser();

    expect(await claimForReview(queueId, reviewer)).toBe("claimed");
    // The duplicated tab. Without the status predicate in the UPDATE both
    // claims would "succeed" and the second reviewer would act on a row
    // the first is already deciding.
    expect(await claimForReview(queueId, other)).toBe("already_taken");
  });
});

describe("resolving a decision", () => {
  beforeEach(resetSafetyTables);

  it("approving puts the entry back in public view", async () => {
    const { entryId, queueId } = await queuedEntry();
    const reviewer = await makeUser();
    expect(await statusOf(entryId)).toBe("hidden_pending_review");

    expect(await resolveReview(queueId, reviewer, "approve")).toBe("resolved");

    expect(await statusOf(entryId)).toBe("ok");
    expect(await pendingReviewCount()).toBe(0);
  });

  it("approving leaves the runner's own sharing choice untouched", async () => {
    const author = await makeUser();
    const runId = await makeRun({ userId: author });
    // A private entry that then gets reported. If the hide had written
    // isPublic, approving would silently publish it.
    const entryId = await makeEntry({ userId: author, runId, isPublic: false });
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await fileReport({
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "spam",
      });
    }
    const [queued] = await pendingReviewQueue();
    if (!queued) throw new Error("nothing queued");

    await resolveReview(queued.id, await makeUser(), "approve");

    const [row] = await core()
      .select({ isPublic: outfitEntries.isPublic })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId))
      .limit(1);
    expect(row?.isPublic).toBe(false);
  });

  it("removing marks the entry removed and stamps the reviewer", async () => {
    const { entryId, queueId } = await queuedEntry();
    const reviewer = await makeUser();

    expect(await resolveReview(queueId, reviewer, "remove")).toBe("resolved");

    expect(await statusOf(entryId)).toBe("removed");
    const [row] = await core()
      .select({
        status: reviewQueue.status,
        resolvedBy: reviewQueue.resolvedBy,
        resolvedAt: reviewQueue.resolvedAt,
      })
      .from(reviewQueue)
      .where(eq(reviewQueue.id, queueId))
      .limit(1);
    expect(row?.status).toBe("removed");
    expect(row?.resolvedBy).toBe(reviewer);
    expect(row?.resolvedAt).toBeGreaterThan(0);
  });

  it("refuses to resolve the same row twice", async () => {
    const { queueId } = await queuedEntry();
    const reviewer = await makeUser();

    expect(await resolveReview(queueId, reviewer, "remove")).toBe("resolved");
    // The stale tab again — and this time the damage would be reversing a
    // removal, so the answer has to be distinguishable from success.
    expect(await resolveReview(queueId, reviewer, "approve")).toBe(
      "already_resolved",
    );
  });

  it("reports a queue id that does not exist as not_found", async () => {
    expect(await resolveReview(newUlid(), await makeUser(), "approve")).toBe(
      "not_found",
    );
  });

  it("hides a removed product so it drops out of autocomplete", async () => {
    const productId = newUlid();
    await core().insert(products).values({
      id: productId,
      brandId: newUlid(),
      name: "Some Shoe",
      normalizedName: "some shoe",
      createdBy: await makeUser(),
      createdAt: NOW,
    });

    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await fileReport({
        reporterId: await makeUser(),
        subjectType: "product",
        subjectId: productId,
        reason: "spam",
      });
    }
    const [queued] = await pendingReviewQueue();
    if (!queued) throw new Error("nothing queued");

    await resolveReview(queued.id, await makeUser(), "remove");

    const [row] = await core()
      .select({ status: products.status })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(row?.status).toBe("hidden");
  });
});

describe("what a decision writes", () => {
  beforeEach(resetSafetyTables);

  it("stamps the claiming reviewer on the row", async () => {
    const { queueId } = await queuedEntry();
    const reviewer = await makeUser();

    await claimForReview(queueId, reviewer);

    // Not just "reviewing": the row must name WHO, or a second tab
    // cannot tell whether it is looking at its own claim.
    const [row] = await core()
      .select({
        status: reviewQueue.status,
        resolvedBy: reviewQueue.resolvedBy,
      })
      .from(reviewQueue)
      .where(eq(reviewQueue.id, queueId))
      .limit(1);
    expect(row?.status).toBe("reviewing");
    expect(row?.resolvedBy).toBe(reviewer);
  });

  it("stamps a resolution time, so a queue row records when it was settled", async () => {
    const { queueId } = await queuedEntry();
    const before = Math.floor(Date.now() / 1000);

    await resolveReview(queueId, await makeUser(), "approve");

    const [row] = await core()
      .select({ resolvedAt: reviewQueue.resolvedAt })
      .from(reviewQueue)
      .where(eq(reviewQueue.id, queueId))
      .limit(1);
    expect(row?.resolvedAt).toBeGreaterThanOrEqual(before);
  });

  it("records the queue row's own creation time", async () => {
    const before = Math.floor(Date.now() / 1000);
    await queuedEntry();

    const [queued] = await pendingReviewQueue();

    // The queue is read oldest-first, so a wrong timestamp reorders a
    // reviewer's worklist.
    expect(queued?.createdAt).toBeGreaterThanOrEqual(before);
  });

  it("approving a product puts it back in autocomplete", async () => {
    const productId = newUlid();
    await core().insert(products).values({
      id: productId,
      brandId: newUlid(),
      name: "Some Shoe",
      normalizedName: "some shoe",
      createdBy: await makeUser(),
      createdAt: NOW,
    });
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await fileReport({
        reporterId: await makeUser(),
        subjectType: "product",
        subjectId: productId,
        reason: "spam",
      });
    }
    const [queued] = await pendingReviewQueue();
    if (!queued) throw new Error("nothing queued");

    await resolveReview(queued.id, await makeUser(), "approve");

    // The other half of the product path: removing hides it, and
    // approving must put it back rather than leave it hidden forever.
    const [row] = await core()
      .select({ status: products.status })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(row?.status).toBe("active");
  });

  it("leaves a reported profile's own rows alone", async () => {
    // `subjectWritesFor` has no profile branch on purpose: removing a
    // person is a ban, with its own path and its own notice. A resolve
    // here must settle the queue row and touch nothing else.
    const subject = await makeUser();
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await fileReport({
        reporterId: await makeUser(),
        subjectType: "profile",
        subjectId: subject,
        reason: "harassment",
      });
    }
    const [queued] = await pendingReviewQueue();
    if (!queued) throw new Error("nothing queued");

    expect(await resolveReview(queued.id, await makeUser(), "remove")).toBe(
      "resolved",
    );
    expect(await pendingReviewCount()).toBe(0);
  });
});

describe("the queue itself", () => {
  beforeEach(resetSafetyTables);

  it("is one row per subject, however many people reported it", async () => {
    const { entryId } = await queuedEntry();
    // A fourth reporter on an already-queued entry.
    await fileReport({
      reporterId: await makeUser(),
      subjectType: "entry",
      subjectId: entryId,
      reason: "harassment",
    });

    expect(await pendingReviewCount()).toBe(1);
  });

  it("re-opens a subject reported again after being approved", async () => {
    const { entryId, queueId } = await queuedEntry();
    const reviewer = await makeUser();
    await resolveReview(queueId, reviewer, "approve");
    expect(await pendingReviewCount()).toBe(0);

    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await fileReport({
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
      });
    }

    // Settled last week is not settled forever, and the reviewer must see
    // it as pending rather than as already decided.
    expect(await pendingReviewCount()).toBe(1);
    const [row] = await core()
      .select({
        resolvedBy: reviewQueue.resolvedBy,
        resolvedAt: reviewQueue.resolvedAt,
      })
      .from(reviewQueue)
      .where(eq(reviewQueue.subjectId, entryId))
      .limit(1);
    // The previous reviewer's stamp is cleared, or the re-opened row would
    // read as "someone already looked at this".
    expect(row?.resolvedBy).toBeNull();
    expect(row?.resolvedAt).toBeNull();
  });

  it("returns the oldest decision first", async () => {
    const first = await queuedEntry();
    const second = await queuedEntry();

    const queue = await pendingReviewQueue();
    expect(queue.map((row) => row.subjectId)).toEqual([
      first.entryId,
      second.entryId,
    ]);
    expect(queue.every((row) => row.source === "reports")).toBe(true);
  });
});
