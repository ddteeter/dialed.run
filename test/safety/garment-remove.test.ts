import { eq, sql } from "drizzle-orm";
import {
  batchWithAfter,
  copiesDeleted,
  firstBatchAfter,
  shownRowOf,
} from "./helpers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  moderationActions,
  notifications,
  outbox,
  photoScreenings,
  quarantinedContent,
  removedFingerprints,
  reviewQueue,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, ulidSchema } from "../../src/lib/ids";
import { removeItemPhoto } from "../../src/modules/closet/photos";
import { moderateGarmentPhoto } from "../../src/modules/feed/moderation/garment-moderation";
import { decideReview } from "../../src/modules/feed/moderation/moderation";
import {
  enqueueForReview,
  openSubject,
  resolveReview,
} from "../../src/modules/safety";
import { quarantineKeyFor } from "../../src/lib/entry-photo-key";
import { preservedKeysOf } from "../../src/modules/safety/takedowns/quarantine";
import type { Report } from "../../src/modules/feed/entries/retract";
import { addAccount } from "../feed/helpers";
import { makeItem, makeUser, resetSafetyTables } from "./helpers";

/**
 * R-167, design 159: a person's Remove of a garment photo takes it off the
 * garment and tells its owner, in the owner's words (2026-10-26).
 */
function core() {
  return drizzle(env.DIALED_CORE);
}

function quiet(): void {
  // No report is expected on any path here.
}

const FINGERPRINT = "fedcba9876543210";

async function cleared(): Promise<void> {
  await resetSafetyTables();
  await core().delete(removedFingerprints);
  await core().delete(notifications);
  const listed = await env.MEDIA.list({ prefix: "items/" });
  const keys = listed.objects.map((object) => object.key);
  if (keys.length > 0) await env.MEDIA.delete(keys);
}

/**
A garment whose photo is waiting on a person, with one size stored.
*/
async function heldGarment() {
  const owner = await makeUser();
  // A real account, so an owed email has someone to go to.
  await addAccount(owner, true);
  const itemId = await makeItem({ userId: owner });
  const photoKey = `items/${owner}/${itemId}/${newUlid()}`;
  await env.MEDIA.put(`${photoKey}/card.webp`, new Uint8Array([7]));
  await core()
    .update(wardrobeItems)
    .set({
      photoKey,
      photoFingerprint: FINGERPRINT,
      visibility: "hidden_pending_review",
    })
    .where(eq(wardrobeItems.id, itemId));
  await core().insert(photoScreenings).values({
    id: newUlid(),
    photoScope: "garment",
    photoId: itemId,
    decision: "flag",
    scores: "{}",
    model: "test",
    createdAt: 1,
  });
  return { owner, itemId, photoKey };
}

async function queueRow(
  itemId: string,
  source: "classifier" | "fingerprint" | "reports",
) {
  await core().batch([
    enqueueForReview(core(), {
      subjectType: "garment",
      subjectId: itemId,
      source,
    }),
  ]);
  const [row] = await core()
    .select({ id: reviewQueue.id })
    .from(reviewQueue)
    .where(eq(reviewQueue.subjectId, itemId));
  return ulidSchema.parse(row?.id);
}

async function owedEmails() {
  const rows = await core()
    .select({ dedupeKey: outbox.dedupeKey, payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.kind, "email"));
  return rows.map((row) => {
    const payload: unknown = JSON.parse(row.payload);
    return { dedupeKey: row.dedupeKey, payload };
  });
}

async function bellOf(userId: string) {
  return core()
    .select({
      kind: notifications.kind,
      subjectId: notifications.subjectId,
      body: notifications.body,
      read: notifications.read,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

async function garmentOf(itemId: string) {
  const [row] = await core()
    .select({
      photoKey: wardrobeItems.photoKey,
      photoFingerprint: wardrobeItems.photoFingerprint,
      visibility: wardrobeItems.visibility,
    })
    .from(wardrobeItems)
    .where(eq(wardrobeItems.id, itemId));
  return row;
}

describe("a garment photo's Remove tells its owner (R-167, design 159)", () => {
  beforeEach(cleared);
  // The sender is down, so each owed email stays in the outbox to be read.
  beforeEach(() => {
    vi.spyOn(env.EMAIL, "send").mockRejectedValue(new Error("sender down"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("takes nothing down when the row is decided between its read and the takedown's batch", async () => {
    const { owner, itemId, photoKey } = await heldGarment();
    const queueId = await queueRow(itemId, "reports");
    const shown = await shownRowOf(queueId);

    const outcome = await decideReview(
      firstBatchAfter(() =>
        core()
          .update(reviewQueue)
          .set({ status: "approved", resolvedBy: "other" })
          .where(eq(reviewQueue.id, queueId)),
      ),
      "rev",
      { queueId, shown, action: "remove", reason: "home" },
    );

    expect(outcome).toBe("already_resolved");
    const garment = await garmentOf(itemId);
    expect(garment?.photoKey).toBe(photoKey);
    expect(
      await core()
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.subjectId, itemId)),
    ).toStrictEqual([]);
    expect(await bellOf(owner)).toStrictEqual([]);
  });

  it("takes nothing down when the row is re-opened for another cause in between", async () => {
    const { itemId, photoKey } = await heldGarment();
    const queueId = await queueRow(itemId, "reports");
    const shown = await shownRowOf(queueId);

    const outcome = await decideReview(
      firstBatchAfter(() =>
        core()
          .update(reviewQueue)
          .set({ source: "fingerprint" })
          .where(eq(reviewQueue.id, queueId)),
      ),
      "rev",
      { queueId, shown, action: "quarantine", reason: "explicit" },
    );

    expect(outcome).toBe("already_resolved");
    const garment = await garmentOf(itemId);
    expect(garment?.photoKey).toBe(photoKey);
  });

  it("passes on a takedown's failure that is not the row's", async () => {
    const { itemId } = await heldGarment();
    const queueId = await queueRow(itemId, "reports");
    const shown = await shownRowOf(queueId);
    const failing = core();
    Reflect.set(failing, "batch", () =>
      Promise.reject(new Error("D1 is down")),
    );

    await expect(
      decideReview(failing, "rev", {
        queueId,
        shown,
        action: "remove",
        reason: "home",
      }),
    ).rejects.toThrow("D1 is down");
  });

  it("takes the photo off the garment and tells its owner a person decided", async () => {
    const { owner, itemId, photoKey } = await heldGarment();
    const queueId = await queueRow(itemId, "reports");

    expect(
      await decideReview(core(), "rev", {
        queueId,
        shown: await shownRowOf(queueId),
        action: "remove",
        reason: "home",
      }),
    ).toBe("resolved");

    // The garment stays; its photo, fingerprint and screenings go.
    const garment = await garmentOf(itemId);
    expect(garment?.photoKey).toBeNull();
    expect(garment?.photoFingerprint).toBeNull();
    expect(garment?.visibility).toBe("ok");
    expect(
      await core()
        .select()
        .from(photoScreenings)
        .where(eq(photoScreenings.photoId, itemId)),
    ).toStrictEqual([]);
    // The bytes were owed their delete, and the fast path paid it.
    const left = await env.MEDIA.list({ prefix: `${photoKey}/` });
    expect(left.objects).toStrictEqual([]);
    const [audit] = await core()
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.subjectId, itemId));
    expect(audit).toMatchObject({
      actorId: "rev",
      action: "remove",
      subjectType: "garment",
      subjectOwnerId: owner,
      reason: "it shows where someone lives",
    });
    expect(audit?.preservedKey).toBeNull();
    const [settled] = await core()
      .select({
        status: reviewQueue.status,
        resolvedBy: reviewQueue.resolvedBy,
      })
      .from(reviewQueue);
    expect(settled).toStrictEqual({ status: "removed", resolvedBy: "rev" });
    expect(await bellOf(owner)).toStrictEqual([
      {
        kind: "content_removed",
        subjectId: itemId,
        body: "We removed the photo of one of your garments. Reason: it shows where someone lives.",
        read: false,
      },
    ]);
    expect(await owedEmails()).toStrictEqual([
      {
        dedupeKey: `content_removed:garment:${photoKey}`,
        payload: {
          dedupeKey: `content_removed:garment:${photoKey}`,
          email: {
            to: { userId: owner },
            template: {
              kind: "content_removed",
              subject: "garment",
              reason: "it shows where someone lives",
              rule: "home",
              flagged: false,
            },
          },
        },
      },
    ]);
    // Not intimate, so no fingerprint is kept.
    expect(await core().select().from(removedFingerprints)).toStrictEqual([]);
  });

  it.each(["classifier", "fingerprint"] as const)(
    "says the automatic check flagged it when the %s queued it",
    async (source) => {
      const { itemId } = await heldGarment();
      const queueId = await queueRow(itemId, source);

      await decideReview(core(), "rev", {
        queueId,
        shown: await shownRowOf(queueId),
        action: "remove",
        reason: "explicit",
      });

      const [owed] = await owedEmails();
      expect(owed?.payload).toMatchObject({
        email: { template: { flagged: true, rule: "explicit" } },
      });
    },
  );

  it("keeps an intimate image's fingerprint for the re-upload check (D-147)", async () => {
    const { itemId } = await heldGarment();

    await moderateGarmentPhoto(
      core(),
      { actorId: "rev", itemId, action: "remove", reason: "intimate" },
      quiet,
    );

    const [audit] = await core()
      .select({ id: moderationActions.id })
      .from(moderationActions);
    const kept = await core().select().from(removedFingerprints);
    expect(kept).toMatchObject([
      {
        fingerprint: FINGERPRINT,
        photoId: itemId,
        moderationActionId: audit?.id,
      },
    ]);
    expect(kept[0]?.createdAt).toBeGreaterThan(0);
  });

  it("keeps no fingerprint for a photo that has none", async () => {
    const { itemId } = await heldGarment();
    await core()
      .update(wardrobeItems)
      .set({ photoFingerprint: sql`NULL` })
      .where(eq(wardrobeItems.id, itemId));

    await moderateGarmentPhoto(
      core(),
      { actorId: "rev", itemId, action: "remove", reason: "intimate" },
      quiet,
    );

    expect(await core().select().from(removedFingerprints)).toStrictEqual([]);
  });

  it("keeps no fingerprint too plain to tell from other pictures (design 164)", async () => {
    const { itemId } = await heldGarment();
    await core()
      .update(wardrobeItems)
      .set({ photoFingerprint: "0000000000000000" })
      .where(eq(wardrobeItems.id, itemId));

    await moderateGarmentPhoto(
      core(),
      { actorId: "rev", itemId, action: "remove", reason: "intimate" },
      quiet,
    );

    expect(await core().select().from(removedFingerprints)).toStrictEqual([]);
  });

  it("answers a repeat as already removed, telling the owner once", async () => {
    const { owner, itemId } = await heldGarment();
    const input = {
      actorId: "rev",
      itemId,
      action: "remove",
      reason: "spam",
    } as const;

    expect(await moderateGarmentPhoto(core(), input, quiet)).toBe("removed");
    expect(await moderateGarmentPhoto(core(), input, quiet)).toBe(
      "already_removed",
    );
    expect(await bellOf(owner)).toHaveLength(1);
    expect(await owedEmails()).toHaveLength(1);
  });

  it("tells the owner again when a later photo on the same garment goes", async () => {
    const { owner, itemId } = await heldGarment();
    const input = {
      actorId: "rev",
      itemId,
      action: "remove",
      reason: "spam",
    } as const;
    await moderateGarmentPhoto(core(), input, quiet);
    await core()
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.userId, owner));
    const secondKey = `items/${owner}/${itemId}/${newUlid()}`;
    await core()
      .update(wardrobeItems)
      .set({ photoKey: secondKey })
      .where(eq(wardrobeItems.id, itemId));

    await moderateGarmentPhoto(core(), { ...input, reason: "home" }, quiet);

    expect(await bellOf(owner)).toStrictEqual([
      {
        kind: "content_removed",
        subjectId: itemId,
        body: "We removed the photo of one of your garments. Reason: it shows where someone lives.",
        read: false,
      },
    ]);
    const owed = await owedEmails();
    const keys = owed.map((one) => one.dedupeKey);
    expect(keys).toContain(`content_removed:garment:${secondKey}`);
    expect(keys).toHaveLength(2);
  });

  it("keeps a photo hidden when safety's own Remove is reached without the takedown", async () => {
    const { owner, itemId, photoKey } = await heldGarment();
    const queueId = await queueRow(itemId, "classifier");

    expect(await resolveReview(queueId, "rev", "remove")).toBe("resolved");

    const garment = await garmentOf(itemId);
    expect(garment?.visibility).toBe("flagged");
    expect(garment?.photoKey).toBe(photoKey);
    expect(await bellOf(owner)).toStrictEqual([]);
  });

  it("still tells nobody of a quarantine (D-70)", async () => {
    const { owner, itemId } = await heldGarment();

    await moderateGarmentPhoto(
      core(),
      { actorId: "rev", itemId, action: "quarantine", reason: "explicit" },
      quiet,
    );

    expect(await bellOf(owner)).toStrictEqual([]);
    expect(await owedEmails()).toStrictEqual([]);
    expect(await core().select().from(removedFingerprints)).toStrictEqual([]);
  });
});

/**
Another reviewer's decision on the row, landing after the page's read.
*/
async function decided(queueId: string): Promise<void> {
  await core()
    .update(reviewQueue)
    .set({ status: "approved", resolvedBy: "other" })
    .where(eq(reviewQueue.id, queueId));
}

async function quarantined(): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix: "quarantine/items/" });
  return listed.objects.map((object) => object.key);
}

/**
A held garment with its original beside its size, and its open row's hold.
*/
async function heldWithHold() {
  const garment = await heldGarment();
  await env.MEDIA.put(`${garment.photoKey}/original.jpg`, new Uint8Array([8]));
  const queueId = await queueRow(garment.itemId, "reports");
  const subject = await openSubject(queueId, await shownRowOf(queueId));
  if (subject === undefined) throw new Error("not open");
  return { ...garment, queueId, heldTo: subject.heldTo };
}

describe("a refused garment quarantine and the copies it made", () => {
  beforeEach(cleared);
  beforeEach(async () => {
    const keys = await quarantined();
    if (keys.length > 0) await env.MEDIA.delete(keys);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records nothing when another reviewer decided the row, and keeps the copies", async () => {
    const { itemId, photoKey } = await heldGarment();
    const queueId = await queueRow(itemId, "reports");
    const shown = await shownRowOf(queueId);

    const outcome = await decideReview(
      firstBatchAfter(() => decided(queueId)),
      "rev",
      { queueId, shown, action: "quarantine", reason: "explicit" },
    );

    expect(outcome).toBe("already_resolved");
    expect(await quarantined()).toStrictEqual([
      quarantineKeyFor(`${photoKey}/card.webp`),
    ]);
    expect(await core().select().from(quarantinedContent)).toStrictEqual([]);
    const garment = await garmentOf(itemId);
    expect(garment?.photoKey).toBe(photoKey);
  });
  it("records a quarantine whose photo its owner removed while it was in flight, with its copies", async () => {
    const { owner, itemId, photoKey, heldTo } = await heldWithHold();
    const copies = [
      quarantineKeyFor(`${photoKey}/card.webp`),
      quarantineKeyFor(`${photoKey}/original.jpg`),
    ];

    const outcome = await moderateGarmentPhoto(
      batchWithAfter(heldTo.statement, () =>
        removeItemPhoto(core(), owner, itemId, quiet),
      ),
      {
        actorId: "rev",
        itemId,
        action: "quarantine",
        reason: "explicit",
        heldTo,
      },
      quiet,
    );

    expect(outcome).toBe("removed");
    expect(await quarantined()).toStrictEqual(copies);
    const records = await core()
      .select({
        subjectId: quarantinedContent.subjectId,
        uploaderId: quarantinedContent.uploaderId,
        actionId: quarantinedContent.moderationActionId,
        snapshot: quarantinedContent.photosSnapshot,
      })
      .from(quarantinedContent);
    expect(
      records.map(({ snapshot, subjectId, uploaderId }) => ({
        subjectId,
        uploaderId,
        copies: preservedKeysOf(snapshot),
      })),
    ).toStrictEqual([
      {
        subjectId: itemId,
        uploaderId: owner,
        copies: { ok: true, keys: copies },
      },
    ]);
    const audit = await core()
      .select({
        id: moderationActions.id,
        actorId: moderationActions.actorId,
        action: moderationActions.action,
      })
      .from(moderationActions)
      .where(eq(moderationActions.action, "quarantine"));
    expect(audit).toStrictEqual([
      { id: records[0]?.actionId, actorId: "rev", action: "quarantine" },
    ]);
    expect(await bellOf(owner)).toStrictEqual([]);
  });

  it("records nothing when its owner removed the photo but the batch failed for another cause", async () => {
    const { owner, itemId, heldTo } = await heldWithHold();

    const taking = moderateGarmentPhoto(
      batchWithAfter(heldTo.statement, () =>
        removeItemPhoto(core(), owner, itemId, quiet),
      ),
      {
        actorId: "rev",
        itemId,
        action: "quarantine",
        reason: "explicit",
        heldTo: { statement: heldTo.statement, refused: () => false },
      },
      quiet,
    );

    await expect(taking).rejects.toThrow(
      /NOT NULL[\s\S]*review_queue\.status/u,
    );
    expect(await core().select().from(quarantinedContent)).toStrictEqual([]);
  });

  it("keeps the copies a landed quarantine lists when another of the photo is refused", async () => {
    const { itemId, photoKey, queueId, heldTo } = await heldWithHold();
    const landing = await openSubject(queueId, await shownRowOf(queueId));
    if (landing === undefined) throw new Error("not open");
    const quarantine = {
      actorId: "rev",
      itemId,
      action: "quarantine",
      reason: "explicit",
    } as const;
    const deletes = vi.spyOn(env.MEDIA, "delete");

    const taking = moderateGarmentPhoto(
      batchWithAfter(heldTo.statement, () =>
        moderateGarmentPhoto(
          core(),
          { ...quarantine, heldTo: landing.heldTo },
          quiet,
        ),
      ),
      { ...quarantine, heldTo },
      quiet,
    );

    await expect(taking).rejects.toThrow(
      /NOT NULL[\s\S]*review_queue\.status/u,
    );
    expect(copiesDeleted(deletes)).toStrictEqual([]);
    expect(await quarantined()).toStrictEqual([
      quarantineKeyFor(`${photoKey}/card.webp`),
      quarantineKeyFor(`${photoKey}/original.jpg`),
    ]);
  });

  it("keeps the copies when the batch fails for any other cause", async () => {
    const { itemId, photoKey, queueId, heldTo } = await heldWithHold();
    const report = vi.fn<Report>();

    const taking = moderateGarmentPhoto(
      firstBatchAfter(() => decided(queueId)),
      {
        actorId: "rev",
        itemId,
        action: "quarantine",
        reason: "explicit",
        heldTo: { statement: heldTo.statement, refused: () => false },
      },
      report,
    );

    await expect(taking).rejects.toThrow(/NOT NULL/u);
    const copies = await quarantined();
    expect(copies.toSorted((a, b) => a.localeCompare(b))).toStrictEqual([
      quarantineKeyFor(`${photoKey}/card.webp`),
      quarantineKeyFor(`${photoKey}/original.jpg`),
    ]);
    expect(report).not.toHaveBeenCalled();
  });

  it("passes on a failed quarantine held to no Review row as it came, and keeps the copies", async () => {
    const { itemId, photoKey } = await heldGarment();
    await env.MEDIA.put(`${photoKey}/original.jpg`, new Uint8Array([8]));
    const failure = new Error("D1 is down");
    const failing = core();
    const batch = failing.batch.bind(failing);
    // The reads before the takedown go through; the takedown's own batch,
    // the only one with more than three statements, fails.
    Reflect.set(
      failing,
      "batch",
      (statements: Parameters<typeof failing.batch>[0]) =>
        statements.length > 3 ? Promise.reject(failure) : batch(statements),
    );
    const report = vi.fn<Report>();

    const taking = moderateGarmentPhoto(
      failing,
      { actorId: "rev", itemId, action: "quarantine", reason: "explicit" },
      report,
    );

    // The very error the batch failed with, not one the hold's absence made.
    await expect(taking).rejects.toBe(failure);
    const copies = await quarantined();
    expect(copies.toSorted((a, b) => a.localeCompare(b))).toStrictEqual([
      quarantineKeyFor(`${photoKey}/card.webp`),
      quarantineKeyFor(`${photoKey}/original.jpg`),
    ]);
    expect(report).not.toHaveBeenCalled();
    const garment = await garmentOf(itemId);
    expect(garment?.photoKey).toBe(photoKey);
  });

  it("deletes nothing when a refused takedown is a Remove", async () => {
    const { itemId, queueId, heldTo } = await heldWithHold();
    const deletes = vi.spyOn(env.MEDIA, "delete");
    const report = vi.fn();

    const taking = moderateGarmentPhoto(
      firstBatchAfter(() => decided(queueId)),
      { actorId: "rev", itemId, action: "remove", reason: "home", heldTo },
      report,
    );

    await expect(taking).rejects.toThrow(/NOT NULL/u);
    expect(copiesDeleted(deletes)).toStrictEqual([]);
    expect(report).not.toHaveBeenCalled();
  });
});
