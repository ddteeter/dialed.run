import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  moderationActions,
  notifications,
  outbox,
  photoScreenings,
  removedFingerprints,
  reviewQueue,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, ulidSchema } from "../../src/lib/ids";
import { moderateGarmentPhoto } from "../../src/modules/feed/garment-moderation";
import { decideReview } from "../../src/modules/feed/moderation";
import { enqueueForReview } from "../../src/modules/safety";
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

  it("takes the photo off the garment and tells its owner a person decided", async () => {
    const { owner, itemId, photoKey } = await heldGarment();
    const queueId = await queueRow(itemId, "reports");

    expect(
      await decideReview(core(), "rev", {
        queueId,
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
      { fingerprint: FINGERPRINT, moderationActionId: audit?.id },
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
