import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  blocks,
  brands,
  copyrightHolds,
  entryPhotos,
  moderationActions,
  products,
  quarantinedContent,
  reviewQueue,
  takedownRequests,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { normalizeIdentity } from "../../src/lib/normalize";
import {
  blockedRunners,
  pendingReviewQueue,
  pendingTakedownRequests,
  removalsOnRun,
} from "../../src/modules/safety";
import { heldCopyrightContent } from "../../src/modules/safety/copyright-holds";
import { duplicateProducts } from "../../src/modules/safety/duplicates";
import { quarantinedContentFor } from "../../src/modules/safety/quarantine";
import { burstsToRelease } from "../../src/modules/safety/release";

import { queryCounts, type QueryCounts } from "../d1-spy";
import {
  makeEntry,
  makeRun,
  makeUser,
  NOW,
  opened,
  resetSafetyTables,
} from "./helpers";

/**
 * Design 182: the Desk's safety queues ask D1 the same number of
 * statements for 1 row as for 25. Rows read may grow; the statement count
 * may not, unless the read says why (a formula, with its reason).
 */

const core = () => drizzle(env.DIALED_CORE);

/**
 * A fingerprint the matches search by: 32 bits set, so it is distinctive
 * (design 164) and every search for it runs.
 */
const PRINT = "00000000ffffffff";
const ADMIN = "the-admin";

/**
Clears the tables and seeds `n` rows of the read's world, then counts the read.
*/
async function countedAt<T>(
  n: number,
  seed: (index: number) => Promise<unknown>,
  read: () => Promise<T>,
): Promise<{ counts: QueryCounts; result: T }> {
  await resetSafetyTables();
  await core().delete(takedownRequests);
  for (let index = 0; index < n; index += 1) await seed(index);
  let result: T | undefined;
  const counts = await queryCounts(async () => {
    result = await read();
  });
  if (result === undefined) throw new Error("the read returned nothing");
  return { counts, result };
}

/**
A kit with one fingerprinted photo on it.
*/
async function printedKit() {
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
      fingerprint: PRINT,
    });
  return { userId, runId, entryId, photoId };
}

/**
A Review row a fingerprint match started, on a kit photo or a kit.
*/
async function fingerprintRow(subjectType: "photo" | "entry") {
  const kit = await printedKit();
  await core()
    .insert(reviewQueue)
    .values({
      id: newUlid(),
      subjectType,
      subjectId: subjectType === "photo" ? kit.photoId : kit.entryId,
      source: "fingerprint",
      status: "pending",
      createdAt: NOW,
    });
}

/**
A Review row the classifier raised on a kit photo.
*/
async function classifierRow() {
  const kit = await printedKit();
  await core().insert(reviewQueue).values({
    id: newUlid(),
    subjectType: "photo",
    subjectId: kit.photoId,
    source: "classifier",
    status: "pending",
    createdAt: NOW,
  });
}

/**
A request whose link names a kit with a fingerprinted photo on it.
*/
async function requestForKit() {
  const kit = await printedKit();
  await core()
    .insert(takedownRequests)
    .values({
      id: newUlid(),
      requesterEmail: `${newUlid().toLowerCase()}@example.test`,
      signature: "Sam Runner",
      location: `https://dialed.run/feed/entry/${kit.entryId}`,
      dueAt: NOW + 48 * 3600,
      createdAt: NOW,
      idempotencyKey: newUlid(),
    });
}

async function openTakedowns() {
  return pendingTakedownRequests(core(), NOW);
}

/**
Asserts the read asks the same for 1 row as for 25, and returned them.
*/
async function flat<T>(
  seed: (index: number) => Promise<unknown>,
  read: () => Promise<T>,
  lengthOf: (result: T) => number,
) {
  const one = await countedAt(1, seed, read);
  const many = await countedAt(25, seed, read);
  expect(lengthOf(one.result)).toBe(1);
  expect(lengthOf(many.result)).toBe(25);
  expect(many.counts.core).toBe(one.counts.core);
  expect(many.counts.weather).toBe(one.counts.weather);
  expect(many.counts.coreRowsRead).toBeGreaterThan(one.counts.coreRowsRead);
}

/**
An audit row for a takedown or quarantine, which the record joins.
*/
async function action(): Promise<string> {
  const id = newUlid();
  await core().insert(moderationActions).values({
    id,
    actorId: "desk",
    action: "takedown",
    subjectType: "photo",
    subjectId: newUlid(),
    reason: "a copyright notice",
    createdAt: NOW,
  });
  return id;
}

beforeEach(async () => {
  await resetSafetyTables();
});

/**
 * Asserts a queue asks the same for 1 row as for 25, in statements and in
 * the length of its longest one (design 188, #490): the per-row subjects
 * are bound as one JSON list, so neither the count nor the SQL grows.
 */
async function flatQueue<T extends readonly unknown[]>(
  seed: () => Promise<unknown>,
  read: () => Promise<T>,
) {
  const one = await countedAt(1, seed, read);
  const many = await countedAt(25, seed, read);
  expect(one.result).toHaveLength(1);
  expect(many.result).toHaveLength(25);
  expect(many.counts.core).toBe(one.counts.core);
  expect(many.counts.coreLongestSql).toBe(one.counts.coreLongestSql);
  expect(many.counts.coreRowsRead).toBeGreaterThan(one.counts.coreRowsRead);
  expect(many.counts.weather).toBe(one.counts.weather);
}

/**
D1's cap on one statement's text, in bytes (the SQL here is ASCII).
*/
const D1_STATEMENT_LIMIT = 100_000;

describe("pendingReviewQueue", () => {
  it("asks the same for 1 fingerprinted photo row as for 25", async () => {
    await flatQueue(
      async () => fingerprintRow("photo"),
      async () => pendingReviewQueue(),
    );
  });

  it("asks the same for 1 fingerprinted entry row as for 25", async () => {
    await flatQueue(
      async () => fingerprintRow("entry"),
      async () => pendingReviewQueue(),
    );
  });

  it("asks the same for a page of rows nobody's copies are asked about", async () => {
    // A classifier row on a photo: no at-once report, not a fingerprint
    // match, so none of the per-subject reads run.
    await flatQueue(classifierRow, async () => pendingReviewQueue());
  });

  it("keeps a full page of fingerprinted rows under D1's statement size", async () => {
    // A hundred rows, the page's cap. Spelt into the SQL as `nearestOf`
    // spells a fingerprint, about 1.5 KB each, one search for all of
    // them would be past the limit; bound as JSON, it is the same text as
    // for one.
    const { counts, result } = await countedAt(
      100,
      async () => fingerprintRow("photo"),
      async () => pendingReviewQueue(),
    );

    expect(result).toHaveLength(100);
    expect(counts.coreLongestSql).toBeLessThan(D1_STATEMENT_LIMIT);
  });
});

describe("pendingTakedownRequests", () => {
  it("asks the same for 1 request for a kit of ours as for 25", async () => {
    await flatQueue(requestForKit, openTakedowns);
  });
});

describe("the Desk's single-read lists", () => {
  it("quarantinedContentFor", async () => {
    const admins: unknown = env.ADMIN_USER_IDS;
    Reflect.set(env, "ADMIN_USER_IDS", ADMIN);
    try {
      await flat(
        async (index) =>
          core()
            .insert(quarantinedContent)
            .values({
              id: newUlid(),
              moderationActionId: await action(),
              subjectType: "photo",
              subjectId: newUlid(),
              uploaderId: newUlid(),
              entrySnapshot: "{}",
              photosSnapshot: "[]",
              quarantinedAt: NOW + index,
              retainUntil: NOW + 365 * 86_400,
            }),
        async () => quarantinedContentFor(core(), ADMIN),
        (rows) => rows.length,
      );
    } finally {
      Reflect.set(env, "ADMIN_USER_IDS", admins);
    }
  });

  it("heldCopyrightContent", async () => {
    await flat(
      async (index) =>
        core()
          .insert(copyrightHolds)
          .values({
            id: newUlid(),
            moderationActionId: await action(),
            subjectType: "photo",
            subjectId: newUlid(),
            ownerId: newUlid(),
            entryId: newUlid(),
            status: "hidden",
            hiddenAt: NOW,
            purgeAt: NOW + 86_400 + index,
          }),
      async () => heldCopyrightContent(core()),
      (rows) => rows.length,
    );
  });

  it("burstsToRelease (waitingHoldsSince)", async () => {
    // One grouped count: the rows are holds, the answer one row per cause.
    await flat(
      async () => opened("fingerprint", 1, nowSeconds()),
      async () => burstsToRelease(),
      ({ bursts }) => bursts.reduce((sum, burst) => sum + burst.waiting, 0),
    );
  });

  it("blockedRunners", async () => {
    const blocker = newUlid();
    await flat(
      async () =>
        core()
          .insert(blocks)
          .values({
            blockerId: blocker,
            blockedId: await makeUser(),
            createdAt: NOW,
          }),
      async () => blockedRunners(blocker),
      (rows) => rows.length,
    );
  });

  it("removalsOnRun", async () => {
    const ownerId = newUlid();
    const runId = newUlid();
    await flat(
      async (index) =>
        core()
          .insert(moderationActions)
          .values({
            id: newUlid(),
            actorId: "desk",
            action: "remove",
            subjectType: "photo",
            subjectId: newUlid(),
            subjectOwnerId: ownerId,
            reason: "it's an ad or spam",
            createdAt: NOW + index,
            runId,
          }),
      async () => removalsOnRun(core(), ownerId, runId),
      (rows) => rows.length,
    );
  });

  it("duplicateProducts", async () => {
    // One near-miss pair per brand: one candidate each.
    await flat(
      async (index) => {
        const brandId = newUlid();
        const name = `Brand ${String(index)}`;
        await core()
          .insert(brands)
          .values({ id: brandId, name, normalized: normalizeIdentity(name) });
        for (const productName of ["Thermal Tight", "Thermal Tights"]) {
          await core()
            .insert(products)
            .values({
              id: newUlid(),
              brandId,
              name: productName,
              normalizedName: normalizeIdentity(productName),
              createdBy: newUlid(),
              createdAt: NOW,
            });
        }
      },
      async () => duplicateProducts(),
      (candidates) => candidates.length,
    );
  });
});
