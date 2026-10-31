import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { session } from "../../src/db/schema-auth";
import {
  entryPhotos,
  moderationActions,
  notifications,
  outbox,
  photoScreenings,
  quarantinedContent,
  removedFingerprints,
  reviewQueue,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryPhotoKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid, ulidSchema, type Ulid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { purgeAccount } from "../../src/modules/account/purge";
import { FINGERPRINT_HOLDS_PER_HOUR } from "../../src/modules/safety/breakers";
import { sweepExpiredAuthRows } from "../../src/modules/auth/expired-rows";
import {
  removeItemPhoto,
  uploadItemPhoto,
} from "../../src/modules/closet/photos";
import { createItem, deleteItem } from "../../src/modules/closet/service";
import { moderateGarmentPhoto } from "../../src/modules/feed/garment-moderation";
import {
  decideReview,
  moderateContent,
} from "../../src/modules/feed/moderation";
import { deleteEntryPhoto, retractEntry } from "../../src/modules/feed/retract";
import {
  banUser,
  enqueueForReview,
  garmentPhotoForgotten,
  pendingReviewQueue,
  purgeExpiredQuarantine,
  QUARANTINE_RETENTION_SECONDS,
  screenPhoto,
  type CategoryScores,
  type Classify,
  type PhotoScope,
} from "../../src/modules/safety";

import { addAccount } from "../feed/helpers";
import { fingerprintOfBytes, sceneJpeg } from "../fixtures/scenes";
import {
  makeEntry,
  makeItem,
  makeRun,
  makeUser,
  opened,
  resetSafetyTables,
} from "./helpers";

/**
 * Design 157 (C17): what a quarantine keeps of its uploader, garment
 * photos in the moderation pipeline, and screenings that go with their
 * photo.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

function quiet(): void {
  // No report is expected on any path here.
}

const ZERO: CategoryScores = {
  sexual: 0,
  violence: 0,
  "violence/graphic": 0,
  "self-harm": 0,
  "self-harm/intent": 0,
  "self-harm/instructions": 0,
};
const explicit: Classify = () =>
  Promise.resolve({ flagged: true, scores: { ...ZERO, sexual: 0.99 } });
const borderline: Classify = () =>
  Promise.resolve({ flagged: false, scores: { ...ZERO, sexual: 0.6 } });
const clean: Classify = () => Promise.resolve({ flagged: false, scores: ZERO });

const BYTES = new Uint8Array([1, 2, 3]);
const SIZES = ["card.webp", "full.webp", "original.jpg", "thumb.webp"];

async function stored(prefix: string): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix });
  return listed.objects
    .map((object) => object.key)
    .toSorted((a, b) => a.localeCompare(b));
}

async function freshState(): Promise<void> {
  await resetSafetyTables();
  await core().delete(session);
  for (const prefix of ["entries/", "items/", "quarantine/"]) {
    const keys = await stored(prefix);
    if (keys.length > 0) await env.MEDIA.delete(keys);
  }
}

/**
Two sessions' [IP, browser] pairs in a fixed order, by IP.
*/
function byIp(a: readonly string[], b: readonly string[]): number {
  return String(a[0]).localeCompare(String(b[0]));
}

const SESSIONS = [
  ["203.0.113.7", "Firefox"],
  ["198.51.100.9", "Safari"],
] as const;

/**
An uploader with an account, a handle and two signed-in sessions.
*/
async function uploader(): Promise<string> {
  const userId = await makeUser({ username: `up_${newUlid().slice(-6)}` });
  await addAccount(userId, true);
  const now = new Date();
  const later = new Date(now.getTime() + 7 * 86_400_000);
  for (const [ip, agent] of SESSIONS) {
    await core()
      .insert(session)
      .values({
        id: newUlid(),
        token: `secret-token-${ip}`,
        userId,
        expiresAt: later,
        createdAt: now,
        updatedAt: now,
        ipAddress: ip,
        userAgent: agent,
      });
  }
  return userId;
}

async function postedPhoto(author: string) {
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({
    userId: author,
    runId,
    audience: "runners",
  });
  const photoId = newUlid();
  const key = entryPhotoKeyFor(author, entryId, photoId);
  await env.MEDIA.put(key, BYTES);
  await core().insert(entryPhotos).values({
    id: photoId,
    entryId,
    photoKey: key,
    position: 0,
    screenStatus: "pending",
  });
  return { entryId, photoId };
}

/**
A garment with a photo: the original and its sizes, under one version.
*/
async function garmentPhoto(owner: string) {
  const itemId = await makeItem({ userId: owner });
  const photoKey = `items/${owner}/${itemId}/${newUlid()}`;
  for (const name of SIZES) await env.MEDIA.put(`${photoKey}/${name}`, BYTES);
  await core()
    .update(wardrobeItems)
    .set({
      photoKey,
      photoFingerprint: "0123456789abcdef",
      visibility: "pending",
    })
    .where(eq(wardrobeItems.id, itemId));
  return { itemId, photoKey };
}

async function screen(
  scope: PhotoScope,
  photoId: string,
  classify: Classify,
): Promise<string> {
  return screenPhoto(
    { scope, photoId, bytes: BYTES, contentType: "image/jpeg" },
    classify,
  );
}

async function screeningCount(scope: PhotoScope, photoId: string) {
  const rows = await core()
    .select({ id: photoScreenings.id })
    .from(photoScreenings)
    .where(
      and(
        eq(photoScreenings.photoScope, scope),
        eq(photoScreenings.photoId, photoId),
      ),
    );
  return rows.length;
}

async function allScreenings() {
  return core().select().from(photoScreenings);
}

async function queueRowsFor(subjectId: string) {
  return core()
    .select({
      subjectType: reviewQueue.subjectType,
      source: reviewQueue.source,
      status: reviewQueue.status,
      resolvedBy: reviewQueue.resolvedBy,
    })
    .from(reviewQueue)
    .where(eq(reviewQueue.subjectId, subjectId));
}

async function statusesFor(subjectId: string): Promise<string[]> {
  const rows = await queueRowsFor(subjectId);
  return rows.map((row) => row.status);
}

async function garmentRow(itemId: string) {
  const [row] = await core()
    .select({
      visibility: wardrobeItems.visibility,
      photoKey: wardrobeItems.photoKey,
      photoFingerprint: wardrobeItems.photoFingerprint,
    })
    .from(wardrobeItems)
    .where(eq(wardrobeItems.id, itemId));
  return row;
}

async function photoKeyOf(itemId: string) {
  const row = await garmentRow(itemId);
  return row?.photoKey;
}

async function visibilityOf(itemId: string): Promise<string | undefined> {
  const row = await garmentRow(itemId);
  return row?.visibility;
}

async function queued(
  subjectId: string,
  source: "classifier" | "fingerprint",
): Promise<Ulid> {
  await core().batch([
    enqueueForReview(core(), { subjectType: "garment", subjectId, source }),
  ]);
  const [row] = await core()
    .select({ id: reviewQueue.id })
    .from(reviewQueue)
    .where(eq(reviewQueue.subjectId, subjectId));
  return ulidSchema.parse(row?.id);
}

const sessionSchema = z
  .object({
    createdAt: z.string(),
    updatedAt: z.string(),
    expiresAt: z.string(),
    ipAddress: z.string(),
    userAgent: z.string(),
  })
  .strict();

const uploaderSnapshotSchema = z
  .object({
    email: z.string().optional(),
    accountCreatedAt: z.string().optional(),
    username: z.string().optional(),
    sessions: z.array(sessionSchema),
  })
  .strict();

function parsedJson(text: string | null | undefined): unknown {
  const decoded: unknown = JSON.parse(text ?? "");
  return decoded;
}

async function onlyRecord() {
  const [record] = await core().select().from(quarantinedContent);
  return record;
}

async function keptUploader() {
  const record = await onlyRecord();
  return uploaderSnapshotSchema.parse(parsedJson(record?.uploaderSnapshot));
}

async function quarantinePhoto(photoId: string): Promise<void> {
  await moderateContent(
    core(),
    {
      actorId: "moderator",
      action: "quarantine",
      subjectType: "photo",
      subjectId: photoId,
      reason: "explicit",
    },
    quiet,
  );
}

async function purgeAYearOn(): Promise<void> {
  const record = await onlyRecord();
  const due = (record?.quarantinedAt ?? 0) + QUARANTINE_RETENTION_SECONDS;
  await purgeExpiredQuarantine(core(), env.MEDIA, due);
}

describe("a quarantine keeps who uploaded it (§2258A(h)(2), design 157)", () => {
  beforeEach(freshState);

  it("keeps the email, the handle and every session's IP and browser, never a token", async () => {
    const author = await uploader();
    const { photoId } = await postedPhoto(author);

    await quarantinePhoto(photoId);

    const record = await onlyRecord();
    expect(record?.uploaderSnapshot).not.toContain("secret-token");
    const kept = await keptUploader();
    expect(kept.email).toBe(`${author.toLowerCase()}@example.test`);
    expect(kept.username).toMatch(/^up_/);
    expect(kept.accountCreatedAt).toBeDefined();
    const seen = kept.sessions.map(({ ipAddress, userAgent }) => [
      ipAddress,
      userAgent,
    ]);
    const expected = SESSIONS.map((pair) => [...pair]);
    expect(seen.toSorted(byIp)).toStrictEqual(expected.toSorted(byIp));
  });

  it("outlives a ban, the session sweep and the account's rows, and goes with the record", async () => {
    const author = await uploader();
    const { photoId } = await postedPhoto(author);
    await quarantinePhoto(photoId);
    const before = await onlyRecord();

    // A ban deletes every session at once; the sweep, a year on, would
    // take any left.
    await banUser({
      userId: author,
      reason: "Suspected CSAM",
      rule: "suspected_csam",
      bannedBy: "moderator",
    });
    await sweepExpiredAuthRows(core(), nowSeconds() + 400 * 86_400);
    expect(await core().select().from(session)).toStrictEqual([]);

    const after = await onlyRecord();
    expect(after?.uploaderSnapshot).toBe(before?.uploaderSnapshot);
    const kept = await keptUploader();
    expect(kept.sessions).toHaveLength(2);

    // The record's year is the context's year: the purge takes both.
    await purgeAYearOn();
    expect(await core().select().from(quarantinedContent)).toStrictEqual([]);
  });

  it("leaves the handle out for a runner with no profile", async () => {
    const author = await uploader();
    const { photoId } = await postedPhoto(author);
    await core().delete(userProfiles).where(eq(userProfiles.userId, author));

    await quarantinePhoto(photoId);

    const kept = await keptUploader();
    expect(kept.username).toBeUndefined();
    expect(kept.sessions).toHaveLength(2);
  });

  it("names nobody for an account already gone, and keeps the record", async () => {
    const author = await makeUser();
    const { photoId } = await postedPhoto(author);

    await quarantinePhoto(photoId);

    const kept = await keptUploader();
    expect(kept.email).toBeUndefined();
    expect(kept.accountCreatedAt).toBeUndefined();
    expect(kept.sessions).toStrictEqual([]);
  });
});

describe("garment photos reach a person (design 157)", () => {
  beforeEach(freshState);

  it("queues a garment photo the classifier flags, by the garment's id, and hides it", async () => {
    const owner = await makeUser();
    const { itemId } = await garmentPhoto(owner);

    expect(await screen("garment", itemId, explicit)).toBe("flagged");

    const rows = await queueRowsFor(itemId);
    expect(rows).toMatchObject([
      { subjectType: "garment", source: "classifier", status: "pending" },
    ]);
    expect(await visibilityOf(itemId)).toBe("hidden_pending_review");
  });

  it("queues the middle band too, and leaves it clear", async () => {
    const owner = await makeUser();
    const { itemId } = await garmentPhoto(owner);

    await screen("garment", itemId, borderline);

    const rows = await queueRowsFor(itemId);
    expect(rows.map((row) => row.subjectType)).toStrictEqual(["garment"]);
    expect(await visibilityOf(itemId)).toBe("pass");
  });

  it("never lets a late verdict clear a garment photo already held", async () => {
    const owner = await makeUser();
    const { itemId } = await garmentPhoto(owner);
    await core()
      .update(wardrobeItems)
      .set({ visibility: "hidden_pending_review" })
      .where(eq(wardrobeItems.id, itemId));

    await screen("garment", itemId, clean);

    expect(await visibilityOf(itemId)).toBe("hidden_pending_review");
  });

  it("shows the reviewer the garment's card and its owner's handle", async () => {
    const owner = await makeUser({ username: "closet_owner" });
    const { itemId, photoKey } = await garmentPhoto(owner);
    await queued(itemId, "classifier");

    const [row] = await pendingReviewQueue();
    expect(row).toMatchObject({
      subjectType: "garment",
      subjectId: itemId,
      subject: { photoKeys: [`${photoKey}/card.webp`], owner: "closet_owner" },
    });
  });

  it("shows nothing for a queued garment whose photo is gone", async () => {
    const owner = await makeUser();
    const itemId = await makeItem({ userId: owner });
    await queued(itemId, "classifier");

    const [row] = await pendingReviewQueue();
    expect(row?.subject).toStrictEqual({ photoKeys: [] });
  });

  it("clears it on Approve, telling nobody", async () => {
    const owner = await makeUser();
    const approved = await garmentPhoto(owner);
    const approvalRow = await queued(approved.itemId, "classifier");

    expect(
      await decideReview(core(), "rev", {
        queueId: approvalRow,
        action: "approve",
      }),
    ).toBe("resolved");

    expect(await visibilityOf(approved.itemId)).toBe("pass");
    expect(await core().select().from(notifications)).toStrictEqual([]);
    expect(await statusesFor(approved.itemId)).toStrictEqual(["approved"]);
  });

  it("tells nobody on Approve, even a row that somehow carries a report", async () => {
    const owner = await makeUser();
    const reporter = await makeUser();
    const { itemId } = await garmentPhoto(owner);
    // Nothing files a report on a garment; written raw, past the enum,
    // to show the decision would still name nobody.
    await core().run(
      sql`INSERT INTO reports (id, reporter_id, subject_type, subject_id, reason, created_at) VALUES (${newUlid()}, ${reporter}, 'garment', ${itemId}, 'explicit', ${nowSeconds()})`,
    );
    await core().batch([
      enqueueForReview(core(), {
        subjectType: "garment",
        subjectId: itemId,
        source: "reports",
      }),
    ]);
    const [row] = await core().select({ id: reviewQueue.id }).from(reviewQueue);

    await decideReview(core(), "rev", {
      queueId: ulidSchema.parse(row?.id),
      action: "approve",
    });

    expect(await visibilityOf(itemId)).toBe("pass");
    expect(await core().select().from(notifications)).toStrictEqual([]);
  });

  it("writes nothing to a garment whose photo is already gone", async () => {
    const owner = await makeUser();
    const itemId = await makeItem({ userId: owner });
    const queueId = await queued(itemId, "classifier");

    await decideReview(core(), "rev", { queueId, action: "approve" });

    expect(await visibilityOf(itemId)).toBe("ok");
  });
});

/**
A runner's garment, as the closet makes one.
*/
async function closetGarment() {
  const userId = await makeUser();
  const item = await createItem(core(), userId, {
    category: "top",
    name: "Held shirt",
  });
  return { userId, itemId: item.id };
}

async function upload(
  garment: { userId: string; itemId: string },
  bytes: Uint8Array,
  classify: Classify,
): Promise<void> {
  await uploadItemPhoto(
    core(),
    garment.userId,
    garment.itemId,
    bytes,
    "image/jpeg",
    classify,
    quiet,
  );
}

/**
The Remove a kept fingerprint names: one batch writes both.
*/
async function anIntimateRemoval() {
  const id = newUlid();
  await core().insert(moderationActions).values({
    id,
    actorId: "rev",
    action: "remove",
    subjectType: "photo",
    subjectId: newUlid(),
    reason: "intimate",
    createdAt: nowSeconds(),
  });
  return id;
}

function neverAsked() {
  return vi.fn<Classify>(() =>
    Promise.reject(new Error("a held photo is not screened")),
  );
}

describe("a garment photo that copies a removed image is held (D-147, design 157)", () => {
  beforeEach(freshState);

  it("hides it for a person, by the garment's id, and asks the classifier nothing", async () => {
    const bytes = await sceneJpeg(3);
    await core()
      .insert(removedFingerprints)
      .values({
        id: newUlid(),
        fingerprint: await fingerprintOfBytes(bytes),
        moderationActionId: await anIntimateRemoval(),
        createdAt: nowSeconds(),
      });
    const garment = await closetGarment();
    const classify = neverAsked();

    const uploaded = await uploadItemPhoto(
      core(),
      garment.userId,
      garment.itemId,
      bytes,
      "image/jpeg",
      classify,
      quiet,
    );

    expect(classify).not.toHaveBeenCalled();
    expect(await photoKeyOf(garment.itemId)).toBe(uploaded.photoKey);
    expect(await visibilityOf(garment.itemId)).toBe("hidden_pending_review");
    expect(await queueRowsFor(garment.itemId)).toMatchObject([
      { subjectType: "garment", source: "fingerprint", status: "pending" },
    ]);
    expect(await allScreenings()).toStrictEqual([]);
    // The Review row says what it is a copy of.
    const [row] = await pendingReviewQueue();
    expect(row?.removedMatches).toMatchObject([{ distance: 0 }]);
  });

  it("screens a copy past the fingerprint breaker's ceiling instead (design 164)", async () => {
    const bytes = await sceneJpeg(3);
    await core()
      .insert(removedFingerprints)
      .values({
        id: newUlid(),
        fingerprint: await fingerprintOfBytes(bytes),
        moderationActionId: await anIntimateRemoval(),
        createdAt: nowSeconds(),
      });
    await opened("fingerprint", FINGERPRINT_HOLDS_PER_HOUR, nowSeconds());
    const garment = await closetGarment();

    await upload(garment, bytes, clean);

    expect(await visibilityOf(garment.itemId)).toBe("pass");
    expect(await queueRowsFor(garment.itemId)).toStrictEqual([]);
  });

  it("screens one that matches nothing, as before", async () => {
    const garment = await closetGarment();

    await upload(garment, await sceneJpeg(4), clean);

    expect(await visibilityOf(garment.itemId)).toBe("pass");
    expect(await queueRowsFor(garment.itemId)).toStrictEqual([]);
    expect(await screeningCount("garment", garment.itemId)).toBe(1);
  });

  it("forgets a replaced photo's verdicts and settles its review", async () => {
    const garment = await closetGarment();
    await upload(garment, await sceneJpeg(5), explicit);

    await upload(garment, await sceneJpeg(6), clean);

    expect(await screeningCount("garment", garment.itemId)).toBe(1);
    const [screening] = await allScreenings();
    expect(screening?.decision).toBe("pass");
    expect(await queueRowsFor(garment.itemId)).toMatchObject([
      { status: "removed", resolvedBy: garment.userId },
    ]);
  });
});

const copiesSchema = z.array(
  z.object({
    key: z.string(),
    preservedKey: z.string(),
    uploadedAt: z.number(),
  }),
);

const decisionSchema = z.object({ decision: z.string() });
const garmentSnapshotSchema = z.object({
  item: z.object({ id: z.string(), photoKey: z.string() }),
  screenings: z.array(decisionSchema),
});

describe("a garment photo quarantined as suspected CSAM (design 157, D-70)", () => {
  beforeEach(freshState);

  it("copies every size and takes the photo off the garment, which stays", async () => {
    const owner = await uploader();
    const { itemId, photoKey } = await garmentPhoto(owner);
    // A replaced version not yet cleaned up, and another runner's photo:
    // neither is the photo being quarantined.
    await env.MEDIA.put(`items/${owner}/${itemId}/older/card.webp`, BYTES);
    await garmentPhoto(await makeUser());
    await screen("garment", itemId, explicit);
    const queueId = await queued(itemId, "classifier");

    expect(
      await decideReview(core(), "rev", {
        queueId,
        action: "quarantine",
        reason: "explicit",
      }),
    ).toBe("resolved");

    // Preserved, every object of the version and nothing else, outside the
    // garment's prefix.
    expect(await stored("quarantine/")).toStrictEqual(
      SIZES.map((name) => `quarantine/${photoKey}/${name}`),
    );
    // The garment stays; its photo, fingerprint and screenings go.
    const row = await garmentRow(itemId);
    expect(row?.visibility).toBe("ok");
    expect(row?.photoKey).toBeNull();
    expect(row?.photoFingerprint).toBeNull();
    expect(await screeningCount("garment", itemId)).toBe(0);
    // The prefix was owed its delete (law 8c), and the fast path paid it.
    expect(await stored(`${photoKey}/`)).toStrictEqual([]);
    expect(await core().select().from(outbox)).toStrictEqual([]);
    // Silent (D-70), and the review settled by the reviewer.
    expect(await core().select().from(notifications)).toStrictEqual([]);
    expect(await queueRowsFor(itemId)).toMatchObject([
      { status: "removed", resolvedBy: "rev" },
    ]);
  });

  it("records who did it, what it was, and who uploaded it, for a year", async () => {
    const owner = await uploader();
    const { itemId, photoKey } = await garmentPhoto(owner);
    await screen("garment", itemId, explicit);
    const before = nowSeconds();

    await moderateGarmentPhoto(
      core(),
      { actorId: "rev", itemId, action: "quarantine", reason: "explicit" },
      quiet,
    );

    const [audit] = await core()
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.subjectId, itemId));
    expect(audit).toMatchObject({
      actorId: "rev",
      action: "quarantine",
      subjectType: "garment",
      subjectOwnerId: owner,
      preservedKey: `quarantine/${photoKey}`,
    });
    const record = await onlyRecord();
    expect(record).toMatchObject({
      moderationActionId: audit?.id,
      subjectType: "garment",
      subjectId: itemId,
      uploaderId: owner,
    });
    expect(record?.entryId).toBeNull();
    expect(record?.quarantinedAt).toBeGreaterThanOrEqual(before);
    const snapshotJson = parsedJson(record?.entrySnapshot);
    const snapshot = garmentSnapshotSchema.parse(snapshotJson);
    expect(snapshot.item).toMatchObject({ id: itemId, photoKey });
    expect(snapshot.screenings.map((one) => one.decision)).toStrictEqual([
      "flag",
    ]);
    const copies = copiesSchema.parse(parsedJson(record?.photosSnapshot));
    const preserved = copies.map((copy) => copy.preservedKey);
    expect(preserved.toSorted((a, b) => a.localeCompare(b))).toStrictEqual(
      SIZES.map((name) => `quarantine/${photoKey}/${name}`),
    );
    expect(copies.every((copy) => copy.uploadedAt >= before - 60)).toBe(true);
    const kept = await keptUploader();
    expect(kept.sessions).toHaveLength(2);

    // A year on, the purge deletes exactly these copies.
    await purgeAYearOn();
    expect(await stored("quarantine/")).toStrictEqual([]);
  });

  it("answers a repeat as already removed, and an unknown garment as not found", async () => {
    const owner = await makeUser();
    const { itemId } = await garmentPhoto(owner);
    const input = {
      actorId: "rev",
      itemId,
      action: "quarantine",
      reason: "explicit",
    } as const;

    expect(await moderateGarmentPhoto(core(), input, quiet)).toBe("removed");
    expect(await moderateGarmentPhoto(core(), input, quiet)).toBe(
      "already_removed",
    );
    const unknown = { ...input, itemId: newUlid() };
    expect(await moderateGarmentPhoto(core(), unknown, quiet)).toBe(
      "not_found",
    );
    expect(await core().select().from(quarantinedContent)).toHaveLength(1);
  });

  it("settles a garment row whose photo is gone through safety, without a record", async () => {
    const owner = await makeUser();
    const itemId = await makeItem({ userId: owner });
    const queueId = await queued(itemId, "classifier");

    expect(
      await decideReview(core(), "rev", {
        queueId,
        action: "quarantine",
        reason: "explicit",
      }),
    ).toBe("resolved");
    expect(await core().select().from(quarantinedContent)).toStrictEqual([]);
    expect(await statusesFor(itemId)).toStrictEqual(["removed"]);
  });

  it("quarantines a garment's photo only for a garment row", async () => {
    const owner = await makeUser();
    const { itemId, photoKey } = await garmentPhoto(owner);
    // A product row that happens to carry the garment's id.
    await core().batch([
      enqueueForReview(core(), {
        subjectType: "product",
        subjectId: itemId,
        source: "reports",
      }),
    ]);
    const [row] = await core().select({ id: reviewQueue.id }).from(reviewQueue);

    await decideReview(core(), "rev", {
      queueId: ulidSchema.parse(row?.id),
      action: "quarantine",
      reason: "explicit",
    });

    expect(await photoKeyOf(itemId)).toBe(photoKey);
    expect(await core().select().from(quarantinedContent)).toStrictEqual([]);
  });
});

const screeningRowSchema = z.object({ photoId: z.string() });
const entrySnapshotSchema = z.object({
  screenings: z.array(screeningRowSchema),
});

async function screened(scope: PhotoScope, photoId: string): Promise<void> {
  await screen(scope, photoId, clean);
  expect(await screeningCount(scope, photoId)).toBe(1);
}

describe("screenings go with their photo (design 157)", () => {
  beforeEach(freshState);
  afterEach(freshState);

  it("writes none for a photo already deleted, or a garment with no photo", async () => {
    const owner = await makeUser();
    const itemId = await makeItem({ userId: owner });

    await screen("entry", newUlid(), clean);
    await screen("garment", itemId, clean);

    expect(await allScreenings()).toStrictEqual([]);
  });

  it("deletes a kit photo's when its runner deletes it, or the kit", async () => {
    const author = await makeUser();
    const one = await postedPhoto(author);
    const two = await postedPhoto(author);
    await screened("entry", one.photoId);
    await screened("entry", two.photoId);

    await deleteEntryPhoto(core(), author, one.photoId, quiet);
    await retractEntry(core(), author, two.entryId, quiet);

    expect(await allScreenings()).toStrictEqual([]);
  });

  it("deletes a kit photo's when the Desk removes or quarantines it, keeping the quarantined one in its record", async () => {
    const author = await makeUser();
    const removal = await postedPhoto(author);
    const quarantined = await postedPhoto(author);
    await screened("entry", removal.photoId);
    await screened("entry", quarantined.photoId);

    await moderateContent(
      core(),
      {
        actorId: "rev",
        action: "remove",
        subjectType: "photo",
        subjectId: removal.photoId,
        reason: "explicit",
      },
      quiet,
    );
    await quarantinePhoto(quarantined.photoId);

    expect(await allScreenings()).toStrictEqual([]);
    const record = await onlyRecord();
    const snapshot = entrySnapshotSchema.parse(
      parsedJson(record?.entrySnapshot),
    );
    expect(snapshot.screenings.map((one) => one.photoId)).toStrictEqual([
      quarantined.photoId,
    ]);
  });

  it("deletes a garment's when its owner removes the photo or the garment, and settles its review", async () => {
    const owner = await makeUser();
    const removedPhoto = await garmentPhoto(owner);
    const deletedGarment = await garmentPhoto(owner);
    await screen("garment", removedPhoto.itemId, explicit);
    await screen("garment", deletedGarment.itemId, explicit);

    await removeItemPhoto(core(), owner, removedPhoto.itemId, quiet);
    await deleteItem(core(), owner, deletedGarment.itemId);

    expect(await allScreenings()).toStrictEqual([]);
    for (const { itemId } of [removedPhoto, deletedGarment]) {
      expect(await queueRowsFor(itemId)).toMatchObject([
        { subjectType: "garment", status: "removed", resolvedBy: owner },
      ]);
    }
  });

  it("settles a garment's open review when the account is purged", async () => {
    const owner = await makeUser();
    const { itemId } = await garmentPhoto(owner);
    await screen("garment", itemId, explicit);

    await purgeAccount(
      {
        core: core(),
        weather: drizzle(env.DIALED_WEATHER),
        now: nowSeconds(),
        revokeStrava: () => Promise.resolve(),
        importsBucket: env.IMPORTS,
        report: quiet,
      },
      owner,
    );

    expect(await queueRowsFor(itemId)).toMatchObject([
      { status: "removed", resolvedBy: owner },
    ]);
  });

  it("forgets only the garment named", async () => {
    const owner = await makeUser();
    const kept = await garmentPhoto(owner);
    const forgotten = await garmentPhoto(owner);
    await screened("garment", kept.itemId);
    await screened("garment", forgotten.itemId);
    await queued(kept.itemId, "classifier");
    await queued(forgotten.itemId, "classifier");

    await core().batch([
      ...garmentPhotoForgotten(core(), owner, forgotten.itemId),
    ]);

    expect(await screeningCount("garment", kept.itemId)).toBe(1);
    expect(await screeningCount("garment", forgotten.itemId)).toBe(0);
    expect(await statusesFor(kept.itemId)).toStrictEqual(["pending"]);
    expect(await statusesFor(forgotten.itemId)).toStrictEqual(["removed"]);
  });
});
