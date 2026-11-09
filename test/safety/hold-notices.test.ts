import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  entryPhotos,
  notifications,
  reviewQueue,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  enqueueForReview,
  imageCategories,
  resolveReview,
  screenPhoto,
  type CategoryScores,
  type Classify,
} from "../../src/modules/safety";
import {
  SCREENING_HIDDEN_NOTICE,
  SCREENING_KEPT_NOTICE,
} from "../../src/modules/safety/notice-copy";
import {
  moderationThresholds,
  photoThresholds,
  reviewFloorsOf,
} from "../../src/modules/safety";

/**
 * The test config's invented hold scores (design 183), read back as the
 * Worker reads them, never production's.
 */
function configuredHolds() {
  const holds = photoThresholds(moderationThresholds());
  if (holds === undefined)
    throw new Error("the test config sets no thresholds");
  return holds;
}
const thresholds = configuredHolds();
const reviewFloors = reviewFloorsOf(thresholds);

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

/**
 * D-162: when automatic screening holds a kit photo, its author gets the
 * in-app notice a report's hide sends, with the reason "automatic
 * screening", and is told again when a person leaves it up. Suspected
 * CSAM stays silent (a quarantine sends nothing, as before), and a garment
 * photo, which only its owner sees, is held with nobody told.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

function answering(overrides: Partial<CategoryScores>): Classify {
  const scores = Object.fromEntries(
    imageCategories.map((category) => [category, 0]),
  ) as CategoryScores;
  return () =>
    Promise.resolve({ flagged: false, scores: { ...scores, ...overrides } });
}

const flagging = answering({ sexual: thresholds.sexual });
const borderline = answering({ sexual: reviewFloors.sexual });
const passing = answering({});

async function kitPhoto(
  screenStatus: "pending" | "hidden_pending_review" = "pending",
) {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId, audience: "runners" });
  const photoId = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id: photoId,
      entryId,
      photoKey: `entries/${userId}/${entryId}/${photoId}`,
      position: 0,
      screenStatus,
    });
  return { userId, photoId };
}

async function screened(photoId: string, classify: Classify) {
  return screenPhoto(
    {
      scope: "entry",
      photoId,
      bytes: new Uint8Array([1]),
      contentType: "image/jpeg",
    },
    classify,
  );
}

async function noticesOf(userId: string) {
  return core()
    .select({
      kind: notifications.kind,
      subjectId: notifications.subjectId,
      body: notifications.body,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

async function queueIdOf(photoId: string): Promise<string> {
  const [row] = await core()
    .select({ id: reviewQueue.id })
    .from(reviewQueue)
    .where(eq(reviewQueue.subjectId, photoId));
  if (row === undefined) throw new Error("not queued");
  return row.id;
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(notifications);
});

describe("a classifier flag tells the photo's author (D-162)", () => {
  it("raises one hide notice, in the screening words, for the photo it hid", async () => {
    const { userId, photoId } = await kitPhoto();

    expect(await screened(photoId, flagging)).toBe("flagged");

    expect(await noticesOf(userId)).toStrictEqual([
      {
        kind: "content_hidden",
        subjectId: photoId,
        body: SCREENING_HIDDEN_NOTICE,
      },
    ]);
  });

  it("says automatic screening, not a report", () => {
    expect(SCREENING_HIDDEN_NOTICE).toBe(
      "Photo hidden while we review it. Our automatic screening flagged a photo on your run, so other runners can't see it until a person reviews it, usually within a day. We'll tell you what we decide.",
    );
    expect(SCREENING_KEPT_NOTICE).toBe(
      "We reviewed the flagged photo on your run and left it up.",
    );
  });

  it.each([
    ["the middle band, which publishes", borderline],
    ["a pass", passing],
  ] as const)("tells nobody for %s", async (_label, classify) => {
    const { userId, photoId } = await kitPhoto();

    await screened(photoId, classify);

    expect(await noticesOf(userId)).toStrictEqual([]);
  });

  it("tells nobody of a photo a report already hid, which was told then", async () => {
    const { userId, photoId } = await kitPhoto("hidden_pending_review");

    await screened(photoId, flagging);

    expect(await noticesOf(userId)).toStrictEqual([]);
  });

  it("tells nobody of a garment photo, which only its owner sees", async () => {
    const userId = await makeUser();
    const itemId = newUlid();
    await core()
      .insert(wardrobeItems)
      .values({
        id: itemId,
        userId,
        category: "top",
        type: "tee",
        name: "Tee",
        photoKey: `items/${userId}/${itemId}/original`,
        origin: "manual",
        createdAt: 1,
      });

    await screenPhoto(
      {
        scope: "garment",
        photoId: itemId,
        bytes: new Uint8Array([1]),
        contentType: "image/webp",
      },
      flagging,
    );

    expect(await noticesOf(userId)).toStrictEqual([]);
  });
});

describe("an Approve of a held photo tells its author it stayed up (D-162)", () => {
  it("raises the kept notice after a classifier hold", async () => {
    const { userId, photoId } = await kitPhoto();
    await screened(photoId, flagging);

    await resolveReview(await queueIdOf(photoId), "op", "approve");

    expect(await noticesOf(userId)).toContainEqual({
      kind: "content_kept",
      subjectId: photoId,
      body: SCREENING_KEPT_NOTICE,
    });
  });

  it("raises it after a fingerprint hold", async () => {
    const { userId, photoId } = await kitPhoto("hidden_pending_review");
    await enqueueForReview(core(), {
      subjectType: "photo",
      subjectId: photoId,
      source: "fingerprint",
    });

    await resolveReview(await queueIdOf(photoId), "op", "approve");

    expect(await noticesOf(userId)).toStrictEqual([
      { kind: "content_kept", subjectId: photoId, body: SCREENING_KEPT_NOTICE },
    ]);
  });

  it("tells nobody in the screening words for a row no screening raised", async () => {
    const { userId, photoId } = await kitPhoto("hidden_pending_review");
    await enqueueForReview(core(), {
      subjectType: "photo",
      subjectId: photoId,
      source: "unscreened",
    });

    await resolveReview(await queueIdOf(photoId), "op", "approve");

    const notices = await noticesOf(userId);
    expect(notices.map(({ body }) => body)).not.toContain(
      SCREENING_KEPT_NOTICE,
    );
  });

  it("tells nobody when the classifier's row hid nothing (the middle band)", async () => {
    const { userId, photoId } = await kitPhoto();
    await screened(photoId, borderline);

    await resolveReview(await queueIdOf(photoId), "op", "approve");

    expect(await noticesOf(userId)).toStrictEqual([]);
  });
});
