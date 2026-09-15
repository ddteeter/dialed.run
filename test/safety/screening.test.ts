import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { entryPhotos, photoScreenings } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  imageCategories,
  pendingEntryPhotos,
  screenPhoto,
  thresholds,
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

/**
A classifier that answers, so a test can say what it answers.
*/
function answering(result: {
  flagged: boolean;
  scores: CategoryScores;
}): Classify {
  return () => Promise.resolve(result);
}

/**
A classifier that is down — the path this lane most needs to get right.
*/
const unavailable: Classify = () =>
  Promise.reject(new Error("moderation 503"));

async function entryPhotoRow(): Promise<string> {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId, isPublic: true });
  const photoId = newUlid();
  await core().insert(entryPhotos).values({
    id: photoId,
    entryId,
    photoKey: `entries/${userId}/${entryId}/${photoId}`,
    position: 0,
  });
  return photoId;
}

async function screenStatusOf(photoId: string): Promise<string> {
  const [row] = await core()
    .select({ status: entryPhotos.screenStatus })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId))
    .limit(1);
  if (!row) throw new Error("photo vanished");
  return row.status;
}

describe("a photo starts invisible to the public", () => {
  beforeEach(resetSafetyTables);

  it("is pending the moment it exists, before anything classifies it", async () => {
    const photoId = await entryPhotoRow();
    // The column's default, not something the upload path remembers to
    // set. A photo that were visible-by-default would be public for
    // however long the classifier took.
    expect(await screenStatusOf(photoId)).toBe("pending");
  });
});

describe("screening a photo", () => {
  beforeEach(resetSafetyTables);

  it("passes a clean photo and records the scores", async () => {
    const photoId = await entryPhotoRow();

    const outcome = await screenPhoto(
      { scope: "entry", photoId, bytes: new Uint8Array([1]), contentType: "image/jpeg" },
      answering({ flagged: false, scores: scores({ sexual: 0.01 }) }),
    );

    expect(outcome).toBe("pass");
    expect(await screenStatusOf(photoId)).toBe("pass");

    const [record] = await core()
      .select()
      .from(photoScreenings)
      .where(eq(photoScreenings.photoId, photoId));
    expect(record?.decision).toBe("pass");
    // The raw scores are kept so a threshold can be re-tuned later against
    // real numbers without re-classifying anything.
    expect(JSON.parse(record?.scores ?? "{}")).toMatchObject({ sexual: 0.01 });
  });

  it("hides a photo that crosses a threshold", async () => {
    const photoId = await entryPhotoRow();

    const outcome = await screenPhoto(
      { scope: "entry", photoId, bytes: new Uint8Array([1]), contentType: "image/jpeg" },
      answering({ flagged: true, scores: scores({ sexual: 0.99 }) }),
    );

    expect(outcome).toBe("flagged");
    // hidden_pending_review, not "flagged": the state every reader cares
    // about is "not public, a person will look", and a second name for it
    // is a value some query eventually forgets to check.
    expect(await screenStatusOf(photoId)).toBe("hidden_pending_review");
  });

  it("ignores the model's own boolean and uses the scores", async () => {
    const photoId = await entryPhotoRow();

    // The model says flagged; every score is far below our thresholds.
    // This is the sports-bra case the packet is about, and the whole
    // reason `decide` exists.
    const outcome = await screenPhoto(
      { scope: "entry", photoId, bytes: new Uint8Array([1]), contentType: "image/jpeg" },
      answering({ flagged: true, scores: scores({ sexual: 0.4 }) }),
    );

    expect(outcome).toBe("pass");
    expect(await screenStatusOf(photoId)).toBe("pass");
  });

  it("flags exactly at the threshold, not only above it", async () => {
    const photoId = await entryPhotoRow();
    const outcome = await screenPhoto(
      { scope: "entry", photoId, bytes: new Uint8Array([1]), contentType: "image/jpeg" },
      answering({ flagged: false, scores: scores({ sexual: thresholds.sexual }) }),
    );
    expect(outcome).toBe("flagged");
  });
});

describe("when the classifier is down", () => {
  beforeEach(resetSafetyTables);

  it("does not throw, so the runner's own save still succeeds", async () => {
    const photoId = await entryPhotoRow();

    // Law 5 and the packet's "fail open for the owner": a Workers-AI-shaped
    // outage must never block someone logging their own run.
    const outcome = await screenPhoto(
      { scope: "entry", photoId, bytes: new Uint8Array([1]), contentType: "image/jpeg" },
      unavailable,
    );

    expect(outcome).toBe("deferred");
  });

  it("leaves the photo pending — invisible to the public, not passed", async () => {
    const photoId = await entryPhotoRow();
    await screenPhoto(
      { scope: "entry", photoId, bytes: new Uint8Array([1]), contentType: "image/jpeg" },
      unavailable,
    );

    // The important half. Degrading to `pass` would publish an
    // unclassified photo, which is a WRONG answer rather than no answer —
    // the distinction lane 107 retired a whole code path over.
    expect(await screenStatusOf(photoId)).toBe("pending");
  });

  it("records no verdict it does not have", async () => {
    const photoId = await entryPhotoRow();
    await screenPhoto(
      { scope: "entry", photoId, bytes: new Uint8Array([1]), contentType: "image/jpeg" },
      unavailable,
    );

    const records = await core()
      .select()
      .from(photoScreenings)
      .where(eq(photoScreenings.photoId, photoId));
    expect(records).toEqual([]);
  });

  it("stays in the retry sweep's queue", async () => {
    const photoId = await entryPhotoRow();
    await screenPhoto(
      { scope: "entry", photoId, bytes: new Uint8Array([1]), contentType: "image/jpeg" },
      unavailable,
    );

    // The row IS the retry record — no queue, no outbox, just the marker
    // the cron reconciles against (law 8c).
    const pending = await pendingEntryPhotos();
    expect(pending.map((photo) => photo.photoId)).toContain(photoId);
  });
});

describe("the pending sweep's reading list", () => {
  beforeEach(resetSafetyTables);

  it("does not return photos already decided", async () => {
    const decided = await entryPhotoRow();
    const waiting = await entryPhotoRow();
    await screenPhoto(
      { scope: "entry", photoId: decided, bytes: new Uint8Array([1]), contentType: "image/jpeg" },
      answering({ flagged: false, scores: scores() }),
    );

    const pending = await pendingEntryPhotos();
    const ids = pending.map((photo) => photo.photoId);
    expect(ids).toContain(waiting);
    expect(ids).not.toContain(decided);
  });

  it("is bounded, so one firing cannot run away", async () => {
    for (let n = 0; n < 4; n += 1) await entryPhotoRow();
    // A backlog drains over several firings rather than one firing timing
    // out and achieving nothing.
    expect(await pendingEntryPhotos(2)).toHaveLength(2);
  });

  it("carries the R2 key the sweep needs to fetch the bytes", async () => {
    await entryPhotoRow();
    const [photo] = await pendingEntryPhotos();
    expect(photo?.photoKey).toMatch(/^entries\//);
    expect(photo?.scope).toBe("entry");
  });
});
