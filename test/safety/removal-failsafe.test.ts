import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  entryPhotos,
  outfitEntries,
  takedownRequests,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { cronSchedules } from "../../src/modules/ops/crons";
import { handleScheduled } from "../../src/modules/ops";
import {
  fileReport,
  fileTakedownRequest,
  imageCategories,
  screenPhoto,
  type CategoryScores,
} from "../../src/modules/safety";
import { oweInCore } from "../queue-fakes";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

/**
 * C6: an undecided removal is never undone by itself. What a removal
 * request or an intimate-image report hid stays hidden until a person
 * decides — past its 48 hours too, and whatever the classifier says about
 * a photo it was still screening.
 */
const HOUR = 3600;

function core() {
  return drizzle(env.DIALED_CORE);
}

const deps = { verify: () => Promise.resolve({ ok: true }), owe: oweInCore };

function takedownOf(location: string) {
  return {
    email: "sam@example.com",
    signature: "Sam Runner",
    location,
    description: "",
    isAttested: true as const,
    idempotencyKey: newUlid(),
    attempt: "token",
    remoteIp: "203.0.113.9",
    isLimited: false,
  };
}

async function sharedEntry(): Promise<string> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  return makeEntry({ userId: author, runId, audience: "runners" });
}

/**
A photo on `entryId` the classifier has not answered for yet.
*/
async function pendingPhoto(entryId: string): Promise<string> {
  const id = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id,
      entryId,
      photoKey: `entries/x/${entryId}/${id}`,
      position: 0,
    });
  return id;
}

async function entryStatus(entryId: string) {
  const [row] = await core()
    .select({ status: outfitEntries.moderationStatus })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  return row?.status;
}

async function photoStatus(photoId: string) {
  const [row] = await core()
    .select({ status: entryPhotos.screenStatus })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId));
  return row?.status;
}

/**
The classifier's clean answer, landing after the photo was hidden.
*/
async function screenedClean(photoId: string) {
  const zeroes = Object.fromEntries(
    imageCategories.map((category) => [category, 0]),
  ) as CategoryScores;
  return screenPhoto(
    {
      scope: "entry",
      photoId,
      bytes: new Uint8Array([1]),
      contentType: "image/jpeg",
    },
    () => Promise.resolve({ flagged: false, scores: zeroes }),
  );
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(takedownRequests);
});

describe("past its 48 hours", () => {
  it("a request's entry stays hidden and the request undecided through every cron", async () => {
    const entryId = await sharedEntry();
    // Filed 60 hours ago: twelve hours overdue.
    const filedAt = nowSeconds() - 60 * HOUR;
    await fileTakedownRequest(
      core(),
      takedownOf(`https://dialed.run/feed/entry/${entryId}`),
      deps,
      filedAt,
    );
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");

    for (const cron of cronSchedules) {
      await handleScheduled({ cron } as ScheduledController);
    }

    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    const [request] = await core().select().from(takedownRequests);
    expect(request?.status).toBe("pending");
    expect(request?.dueAt).toBeLessThan(nowSeconds());
  });
});

describe("a photo hidden while it was being screened", () => {
  it("stays hidden when a removal request's hide beats the classifier's pass", async () => {
    const entryId = await sharedEntry();
    const photoId = await pendingPhoto(entryId);
    await fileTakedownRequest(
      core(),
      takedownOf(
        `https://dialed.run/feed/photo/entries/x/${entryId}/${photoId}`,
      ),
      deps,
    );
    expect(await photoStatus(photoId)).toBe("hidden_pending_review");

    expect(await screenedClean(photoId)).toBe("pass");

    expect(await photoStatus(photoId)).toBe("hidden_pending_review");
  });

  it("stays hidden when an intimate-image report's hide beats the classifier's pass", async () => {
    const entryId = await sharedEntry();
    const photoId = await pendingPhoto(entryId);
    await fileReport(
      {
        reporterId: await makeUser(),
        subjectType: "photo",
        subjectId: photoId,
        reason: "intimate",
      },
      oweInCore,
    );
    expect(await photoStatus(photoId)).toBe("hidden_pending_review");

    await screenedClean(photoId);

    expect(await photoStatus(photoId)).toBe("hidden_pending_review");
  });

  it("still passes a photo nothing hid", async () => {
    const photoId = await pendingPhoto(await sharedEntry());
    await screenedClean(photoId);
    expect(await photoStatus(photoId)).toBe("pass");
  });
});
