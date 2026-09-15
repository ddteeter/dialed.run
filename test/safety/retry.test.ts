import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { entryPhotos } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  imageCategories,
  retryPendingScreenings,
  type CategoryScores,
  type Classify,
} from "../../src/modules/safety";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

function core() {
  return drizzle(env.DIALED_CORE);
}

function scores(overrides: Partial<CategoryScores> = {}): CategoryScores {
  const zeroes = Object.fromEntries(
    imageCategories.map((category) => [category, 0]),
  ) as CategoryScores;
  return { ...zeroes, ...overrides };
}

const clean: Classify = () =>
  Promise.resolve({ flagged: false, scores: scores() });

const explicit: Classify = () =>
  Promise.resolve({ flagged: true, scores: scores({ sexual: 0.99 }) });

const unavailable: Classify = () => Promise.reject(new Error("503"));

/**
 * A pending entry photo whose bytes are really in R2, so the sweep has
 * something to fetch. `hasBytes: false` makes the object missing, which
 * is the case the sweep has to survive rather than crash on.
 */
async function pendingPhoto(hasBytes = true): Promise<string> {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId, isPublic: true });
  const photoId = newUlid();
  const photoKey = `entries/${userId}/${entryId}/${photoId}`;
  await core()
    .insert(entryPhotos)
    .values({ id: photoId, entryId, photoKey, position: 0 });
  if (hasBytes) {
    await env.MEDIA.put(photoKey, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "image/jpeg" },
    });
  }
  return photoId;
}

async function statusOf(photoId: string): Promise<string> {
  const [row] = await core()
    .select({ status: entryPhotos.screenStatus })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId))
    .limit(1);
  if (!row) throw new Error("photo vanished");
  return row.status;
}

describe("the screening-retry sweep", () => {
  beforeEach(resetSafetyTables);

  it("screens what was left pending", async () => {
    const photoId = await pendingPhoto();
    const anomalies: string[] = [];

    const report = await retryPendingScreenings(clean, anomalies);

    expect(report).toMatchObject({ considered: 1, passed: 1, deferred: 0 });
    expect(await statusOf(photoId)).toBe("pass");
    expect(anomalies).toEqual([]);
  });

  it("hides what the classifier flags", async () => {
    const photoId = await pendingPhoto();
    await retryPendingScreenings(explicit, []);
    expect(await statusOf(photoId)).toBe("hidden_pending_review");
  });

  it("is safely re-runnable, which is the whole point (law 1)", async () => {
    const photoId = await pendingPhoto();

    await retryPendingScreenings(clean, []);
    const second = await retryPendingScreenings(clean, []);

    // The second firing finds nothing, because the first moved the row out
    // of `pending`. Overlapping invocations cannot double-process.
    expect(second.considered).toBe(0);
    expect(await statusOf(photoId)).toBe("pass");
  });
});

describe("when there is no key configured", () => {
  beforeEach(resetSafetyTables);

  it("leaves every photo pending rather than guessing", async () => {
    const photoId = await pendingPhoto();
    const anomalies: string[] = [];

    const report = await retryPendingScreenings(undefined, anomalies);

    expect(report).toMatchObject({ considered: 1, deferred: 1, passed: 0 });
    expect(await statusOf(photoId)).toBe("pending");
  });

  it("says so once, in the digest, rather than once per photo", async () => {
    await pendingPhoto();
    await pendingPhoto();
    const anomalies: string[] = [];

    await retryPendingScreenings(undefined, anomalies);

    // Law 6: a failure has to land where a human eventually sees it. Two
    // photos, one line — a per-photo anomaly would bury the digest.
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toContain("OPENAI_API_KEY");
    expect(anomalies[0]).toContain("2");
  });

  it("says nothing at all when there is nothing waiting", async () => {
    const anomalies: string[] = [];
    await retryPendingScreenings(undefined, anomalies);
    // An unconfigured key with an empty backlog is not an anomaly; a
    // digest that cries every day is one nobody reads.
    expect(anomalies).toEqual([]);
  });
});

describe("when a photo cannot be screened", () => {
  beforeEach(resetSafetyTables);

  it("survives a classifier outage and reports the backlog", async () => {
    const photoId = await pendingPhoto();
    const anomalies: string[] = [];

    const report = await retryPendingScreenings(unavailable, anomalies);

    expect(report).toMatchObject({ considered: 1, deferred: 1 });
    expect(await statusOf(photoId)).toBe("pending");
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toContain("still pending");
  });

  it("defers a photo whose bytes are missing instead of crashing", async () => {
    const photoId = await pendingPhoto(false);

    const report = await retryPendingScreenings(clean, []);

    // A missing R2 object is the one case where "try again forever" is
    // arguably wrong — but a photo nobody can see is a safe resting place,
    // and assuming it is gone would mean publishing bytes nothing
    // classified.
    expect(report).toMatchObject({ considered: 1, deferred: 1 });
    expect(await statusOf(photoId)).toBe("pending");
  });

  it("screens the others even when one of them cannot be", async () => {
    const broken = await pendingPhoto(false);
    const fine = await pendingPhoto();

    const report = await retryPendingScreenings(clean, []);

    // A sweep that dies on the third of fifty photos has done less work
    // than one that records three failures and screens the other
    // forty-seven.
    expect(report).toMatchObject({ considered: 2, passed: 1, deferred: 1 });
    expect(await statusOf(fine)).toBe("pass");
    expect(await statusOf(broken)).toBe("pending");
  });
});
