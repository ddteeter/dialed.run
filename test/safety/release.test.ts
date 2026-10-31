import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { entryPhotos, reviewQueue } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  burstsToRelease,
  RELEASE_BATCH,
  RELEASE_WINDOW_S,
  releaseHolds,
  waitingHoldsSince,
} from "../../src/modules/safety/release";

import {
  makeEntry,
  makeRun,
  makeUser,
  opened,
  resetSafetyTables,
} from "./helpers";

/**
 * Design 164: releasing a burst of one cause's holds, Approve for each,
 * from a time on.
 */

const core = () => drizzle(env.DIALED_CORE);

const SINCE = 1_000_000;

beforeEach(resetSafetyTables);

/**
 * A photo held by a fingerprint match, queued at `openedAt`: what a
 * release puts back.
 */
async function heldPhoto(openedAt: number): Promise<string> {
  const userId = await makeUser();
  const entryId = await makeEntry({
    userId,
    runId: await makeRun({ userId }),
  });
  const photoId = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id: photoId,
      entryId,
      photoKey: `entries/${photoId}`,
      position: 0,
      screenStatus: "hidden_pending_review",
    });
  await core().insert(reviewQueue).values({
    id: newUlid(),
    subjectType: "photo",
    subjectId: photoId,
    source: "fingerprint",
    status: "pending",
    createdAt: openedAt,
    openedAt,
  });
  return photoId;
}

async function statusesOf(): Promise<string[]> {
  const rows = await core()
    .select({ status: reviewQueue.status })
    .from(reviewQueue);
  return rows.map((row) => row.status).toSorted((a, b) => a.localeCompare(b));
}

describe("releaseHolds", () => {
  it("approves each waiting hold of the cause since the time, as the operator", async () => {
    const photoId = await heldPhoto(SINCE);
    const reviewer = await makeUser();

    const outcome = await releaseHolds("fingerprint", SINCE, reviewer);

    expect(outcome).toStrictEqual({ released: 1, hasMore: false });
    const [row] = await core()
      .select({
        status: reviewQueue.status,
        resolvedBy: reviewQueue.resolvedBy,
      })
      .from(reviewQueue);
    expect(row).toStrictEqual({ status: "approved", resolvedBy: reviewer });
    // Where an Approve puts a held photo: back to be screened.
    const [photo] = await core()
      .select({ screenStatus: entryPhotos.screenStatus })
      .from(entryPhotos)
      .where(eq(entryPhotos.id, photoId));
    expect(photo?.screenStatus).toBe("pending");
  });

  it("leaves another cause, an earlier hold, and a decided one alone", async () => {
    await opened("classifier", 1, SINCE);
    await opened("fingerprint", 1, SINCE - 1);
    await opened("fingerprint", 1, SINCE);
    await core()
      .update(reviewQueue)
      .set({ status: "removed" })
      .where(eq(reviewQueue.openedAt, SINCE - 1));

    const outcome = await releaseHolds("fingerprint", SINCE, "op");

    expect(outcome).toStrictEqual({ released: 1, hasMore: false });
    expect(await statusesOf()).toStrictEqual([
      "approved",
      "pending",
      "removed",
    ]);
  });

  it("says nothing more waits at exactly a batch", async () => {
    await opened("fingerprint", RELEASE_BATCH, SINCE);

    const outcome = await releaseHolds("fingerprint", SINCE, "op");

    expect(outcome).toStrictEqual({ released: RELEASE_BATCH, hasMore: false });
  });

  it("leaves a row another tab holds, and does not count it", async () => {
    await opened("fingerprint", 1, SINCE);
    await core().update(reviewQueue).set({ status: "reviewing" });

    const outcome = await releaseHolds("fingerprint", SINCE, "op");

    expect(outcome).toStrictEqual({ released: 0, hasMore: false });
    expect(await statusesOf()).toStrictEqual(["reviewing"]);
  });

  it("releases a bounded batch a call, oldest first, and says more wait", async () => {
    await opened("fingerprint", RELEASE_BATCH, SINCE);
    await opened("fingerprint", 1, SINCE + 1);

    const first = await releaseHolds("fingerprint", SINCE, "op");
    expect(first).toStrictEqual({ released: RELEASE_BATCH, hasMore: true });
    const [newest] = await core()
      .select({ status: reviewQueue.status })
      .from(reviewQueue)
      .where(eq(reviewQueue.openedAt, SINCE + 1));
    expect(newest?.status).toBe("pending");

    const second = await releaseHolds("fingerprint", SINCE, "op");
    expect(second).toStrictEqual({ released: 1, hasMore: false });
  });
});

describe("what Review offers to release", () => {
  it("counts each cause's open holds since the time, and lists no cause with none", async () => {
    await opened("reports", 2, SINCE);
    await opened("fingerprint", 1, SINCE);
    await opened("fingerprint", 1, SINCE - 1);
    await opened("classifier", 1, SINCE);
    await core()
      .update(reviewQueue)
      .set({ status: "approved" })
      .where(eq(reviewQueue.source, "classifier"));

    expect(await waitingHoldsSince(SINCE)).toStrictEqual([
      { cause: "fingerprint", waiting: 1 },
      { cause: "reports", waiting: 2 },
    ]);
  });

  it("counts a hold a tab has claimed and not decided as waiting", async () => {
    await opened("fingerprint", 1, SINCE);
    await core().update(reviewQueue).set({ status: "reviewing" });

    expect(await waitingHoldsSince(SINCE)).toStrictEqual([
      { cause: "fingerprint", waiting: 1 },
    ]);
  });

  it("reads the last day, and says where it starts", async () => {
    const before = nowSeconds();
    await opened("fingerprint", 1, before - 60);
    await opened("fingerprint", 1, before - RELEASE_WINDOW_S - 60);

    const { bursts, burstsSince } = await burstsToRelease();

    expect(bursts).toStrictEqual([{ cause: "fingerprint", waiting: 1 }]);
    expect(burstsSince).toBeGreaterThanOrEqual(before - RELEASE_WINDOW_S);
    expect(burstsSince).toBeLessThanOrEqual(
      nowSeconds() - RELEASE_WINDOW_S + 5,
    );
  });
});
