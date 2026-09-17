import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  entryPhotos,
  outfitEntries,
  products,
  reviewQueue,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  autoHideReporterThreshold,
  claimForReview,
  fileReport,
  pendingEntryPhotos,
  pendingReviewCount,
  pendingReviewQueue,
  reasonsFrom,
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

/**
 * An entry photo three distinct people have reported — the state all
 * three photo tests below start from.
 */
async function reportedPhoto(): Promise<string> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({ userId: author, runId, isPublic: true });
  const photoId = newUlid();
  await core().insert(entryPhotos).values({
    id: photoId,
    entryId,
    photoKey: `entries/${author}/${entryId}/${photoId}`,
    position: 0,
  });
  for (let n = 0; n < autoHideReporterThreshold; n += 1) {
    await fileReport({
      reporterId: await makeUser(),
      subjectType: "photo",
      subjectId: photoId,
      reason: "explicit",
    });
  }
  return photoId;
}

async function photoStatusOf(photoId: string): Promise<string> {
  const [row] = await core()
    .select({ status: entryPhotos.screenStatus })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId))
    .limit(1);
  if (!row) throw new Error("photo vanished");
  return row.status;
}

/**
 * A queue row with no reports behind it, the way the screening path
 * raises one.
 */
async function enqueueClassifierRow(): Promise<void> {
  await core()
    .insert(reviewQueue)
    .values({
      id: newUlid(),
      subjectType: "photo",
      subjectId: newUlid(),
      source: "classifier",
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    });
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

  it("refuses to resolve an approved row a second time", async () => {
    // The mirror of the removal case below, and not the same test: the
    // "already resolved" guard names both settled statuses, and a guard
    // that knew only about `removed` would let a second reviewer reverse
    // an approval.
    const { queueId } = await queuedEntry();
    const reviewer = await makeUser();

    expect(await resolveReview(queueId, reviewer, "approve")).toBe("resolved");

    expect(await resolveReview(queueId, reviewer, "remove")).toBe(
      "already_resolved",
    );
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
      .select({
        status: reviewQueue.status,
        resolvedAt: reviewQueue.resolvedAt,
      })
      .from(reviewQueue)
      .where(eq(reviewQueue.id, queueId))
      .limit(1);
    // Bounded on both sides, because every column in this schema counts
    // seconds: a millisecond value is still "greater than before" and
    // would sort this row ahead of everything for the next thousand
    // years.
    expect(row?.resolvedAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.resolvedAt).toBeLessThanOrEqual(before + 5);
    // The approving half of the queue row's own status. The removing
    // half is asserted above; without this one, a rule that wrote
    // "removed" whatever the reviewer chose would pass.
    expect(row?.status).toBe("approved");
  });

  it("records the queue row's own creation time", async () => {
    const before = Math.floor(Date.now() / 1000);
    await queuedEntry();

    const [queued] = await pendingReviewQueue();

    // The queue is read oldest-first, so a wrong timestamp reorders a
    // reviewer's worklist — and in seconds, like every other time column
    // here, or it reorders it just as badly by being a thousand times
    // too large.
    expect(queued?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(queued?.createdAt).toBeLessThanOrEqual(before + 5);
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

  it("hides a reported photo when the threshold is crossed", async () => {
    const photoId = await reportedPhoto();

    // The same state a classifier flag produces, and for the same
    // reason: not public, a person will look. Before this, three people
    // could report a photo and it stayed up.
    expect(await photoStatusOf(photoId)).toBe("hidden_pending_review");
  });

  it("settles a removed photo out of public view for good", async () => {
    const photoId = await reportedPhoto();
    const [queued] = await pendingReviewQueue();
    if (!queued) throw new Error("nothing queued");

    expect(await resolveReview(queued.id, await makeUser(), "remove")).toBe(
      "resolved",
    );

    // `flagged`, not `hidden_pending_review`: the latter promises a
    // person will look, and a person just did. Neither is `pass`, so the
    // public sees neither.
    expect(await photoStatusOf(photoId)).toBe("flagged");
    expect(await pendingReviewCount()).toBe(0);
  });

  it("sends an approved photo back to be screened, not straight to the public", async () => {
    const photoId = await reportedPhoto();
    const [queued] = await pendingReviewQueue();
    if (!queued) throw new Error("nothing queued");

    await resolveReview(queued.id, await makeUser(), "approve");

    // NOT `pass`. A photo can reach this queue having never been
    // screened, and approving straight to `pass` would publish bytes no
    // classifier ever saw — fail open for the owner, closed for the
    // public. `pending` is what the retry sweep reads.
    expect(await photoStatusOf(photoId)).toBe("pending");
    const [stillPending] = await pendingEntryPhotos();
    expect(stillPending?.photoId).toBe(photoId);
  });

  it("leaves a reported profile's own rows alone", async () => {
    // `subjectWriters` has no profile branch on purpose: removing a
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

  it("carries what was alleged and how many people said it", async () => {
    const { entryId } = await queuedEntry();
    // A fourth reporter, with a different reason.
    await fileReport({
      reporterId: await makeUser(),
      subjectType: "entry",
      subjectId: entryId,
      reason: "spam",
    });

    const [queued] = await pendingReviewQueue();

    // The reviewer's entire basis for a decision. Three people said the
    // photo was explicit and a fourth said it was spam; a row that
    // carried neither fact would be a subject type and a ULID.
    expect(queued?.reporterCount).toBe(4);
    expect(
      [...(queued?.reasons ?? [])].toSorted((one, other) =>
        one.localeCompare(other),
      ),
    ).toEqual(["explicit", "spam"]);
  });

  it("counts people, not reports, the way the threshold does", async () => {
    const { entryId } = await queuedEntry();
    const repeater = await makeUser();
    await fileReport({
      reporterId: repeater,
      subjectType: "entry",
      subjectId: entryId,
      reason: "spam",
    });
    await fileReport({
      reporterId: repeater,
      subjectType: "entry",
      subjectId: entryId,
      reason: "spam",
    });

    // One person reporting twice is one person — the same rule that
    // decides the auto-hide. A reviewer reading "5 people" about four
    // would weigh it differently, which is the whole reason the count is
    // on the row.
    const queue = await pendingReviewQueue();
    expect(queue[0]?.reporterCount).toBe(4);
  });

  it("does not attribute one subject's reports to another", async () => {
    const first = await queuedEntry();
    await queuedEntry();
    await fileReport({
      reporterId: await makeUser(),
      subjectType: "entry",
      subjectId: first.entryId,
      reason: "not_theirs",
    });

    // The join is on subject type AND id. Getting it wrong pools every
    // report in the table onto every row, which reads as unanimity.
    const queue = await pendingReviewQueue();
    expect(queue[0]?.reporterCount).toBe(4);
    expect(queue[1]?.reporterCount).toBe(3);
    expect(queue[1]?.reasons).not.toContain("not_theirs");
  });

  it("keeps a row nobody reported, and says nobody did", async () => {
    // A classifier-sourced row has no reports at all. An inner join
    // would drop it from the queue entirely — a photo the model hid that
    // no person ever sees again.
    await enqueueClassifierRow();

    const [queued] = await pendingReviewQueue();
    expect(queued?.source).toBe("classifier");
    expect(queued?.reporterCount).toBe(0);
    expect(queued?.reasons).toEqual([]);
    // Its subject id names no row — the classifier row here stands for a
    // photo that has since been deleted. The row still has to render, so
    // "nothing found" is an empty subject rather than a missing one.
    expect(queued?.subject).toEqual({ photoKeys: [] });
  });

  it("carries the photo a reported photo actually is", async () => {
    await reportedPhoto();

    const [queued] = await pendingReviewQueue();

    // The subject that most needs looking at was the one the queue showed
    // nothing for: a type and a ULID. A reviewer pressing Approve on that
    // is approving an identifier.
    expect(queued?.subject.photoKeys).toHaveLength(1);
    expect(queued?.subject.photoKeys[0]).toMatch(/^entries\//u);
  });

  it("carries a reported entry's photos, in the order they were posted", async () => {
    const author = await makeUser();
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({ userId: author, runId, isPublic: true });
    for (const position of [1, 0]) {
      await core().insert(entryPhotos).values({
        id: newUlid(),
        entryId,
        photoKey: `entries/${author}/${entryId}/${String(position)}`,
        position,
      });
    }
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await fileReport({
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
      });
    }

    const [queued] = await pendingReviewQueue();

    // Inserted out of order on purpose: a kit posted as two photos is one
    // thing to judge, and judging it out of order is judging something
    // else.
    expect(queued?.subject.photoKeys).toEqual([
      `entries/${author}/${entryId}/0`,
      `entries/${author}/${entryId}/1`,
    ]);
  });

  it("names a reported runner and a reported product", async () => {
    const subject = await makeUser();
    await core()
      .update(userProfiles)
      .set({ displayName: "mark_t" })
      .where(eq(userProfiles.userId, subject));
    const productId = newUlid();
    await core().insert(products).values({
      id: productId,
      brandId: newUlid(),
      name: "Some Shoe",
      normalizedName: "some shoe",
      createdBy: await makeUser(),
      createdAt: NOW,
    });
    for (const [subjectType, subjectId] of [
      ["profile", subject],
      ["product", productId],
    ] as const) {
      for (let n = 0; n < autoHideReporterThreshold; n += 1) {
        await fileReport({
          reporterId: await makeUser(),
          subjectType,
          subjectId,
          reason: "spam",
        });
      }
    }

    const queue = await pendingReviewQueue();

    // Words are the whole content of these two, the way pixels are of a
    // photo. "product · 01M2P5…" tells a reviewer nothing they can weigh.
    const labels = queue.map((row) => row.subject.label);
    expect(labels).toContain("mark_t");
    expect(labels).toContain("Some Shoe");
    // And no photos: a name is the whole content of these rows, and a
    // stray key would put an empty frame on one, which reads as an image
    // that failed to load rather than as a row with no image.
    expect(queue.every((row) => row.subject.photoKeys.length === 0)).toBe(true);
  });

  it("looks a subject up by its type, not by its id alone", async () => {
    // A product whose id IS a runner's id. Nothing forbids it — user ids
    // and product ids are different namespaces that happen to share a
    // column type — and a lookup keyed on the id alone would label the
    // reported runner with the product's name.
    const subject = await makeUser();
    await core()
      .update(userProfiles)
      .set({ displayName: "mark_t" })
      .where(eq(userProfiles.userId, subject));
    await core().insert(products).values({
      id: subject,
      brandId: newUlid(),
      name: "Some Shoe",
      normalizedName: "some shoe",
      createdBy: await makeUser(),
      createdAt: NOW,
    });
    for (let n = 0; n < autoHideReporterThreshold; n += 1) {
      await fileReport({
        reporterId: await makeUser(),
        subjectType: "profile",
        subjectId: subject,
        reason: "harassment",
      });
    }

    const [queued] = await pendingReviewQueue();

    expect(queued?.subject.label).toBe("mark_t");
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

describe("reading the reasons back out of one column", () => {
  it("keeps the ones this app knows", () => {
    expect(reasonsFrom("explicit,spam")).toEqual(["explicit", "spam"]);
  });

  it("gives back nothing for a subject nobody reported", () => {
    // SQLite's `group_concat` over no rows is NULL, which is what a
    // classifier-sourced row produces. Not an edge case — it is half
    // the queue's sources.
    const nothing = z.null().parse(JSON.parse("null"));
    expect(reasonsFrom(nothing)).toEqual([]);
  });

  it("drops a value it does not recognise rather than rendering a blank", () => {
    // The column comes back as one opaque string. A reason this app no
    // longer knows about would reach a label lookup and render as
    // nothing, and a reviewer cannot tell a blank line from a reason
    // with no words.
    expect(reasonsFrom("explicit,retired_reason,")).toEqual(["explicit"]);
  });
});
