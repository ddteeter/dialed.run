/**
 * Safety-lane fixtures.
 *
 * The entity factories are `test/feed/helpers.ts`'s, imported rather than
 * re-declared — a second `makeUser` would be the copy-then-rename a clone
 * detector is for, and these tests need exactly the rows that file already
 * knows how to build. What lives here is only the part feed has no reason
 * to know about: clearing task 106's own tables.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  blocks,
  copyrightHolds,
  heldTakeDowns,
  brands,
  domainDenylist,
  entryPhotos,
  linkLandings,
  photoScreenings,
  products,
  reports,
  reviewQueue,
  moderationActions,
  outbox,
  publicPhotos,
  quarantinedContent,
  usernameHistory,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import type {
  ReviewSubjectType,
  ShownRow,
} from "../../src/modules/safety/review/review";

import {
  deleteAllFrom,
  makeUser,
  NOW,
  resetTables as resetSharedTables,
} from "../feed/helpers";

export {
  makeEntry,
  makeItem,
  makeRun,
  makeUser,
  makeVerifiedUser,
  NOW,
} from "../feed/helpers";

export async function resetSafetyTables(): Promise<void> {
  await deleteAllFrom(drizzle(env.DIALED_CORE), [
    // entry_photos is NOT in feed/helpers' reset — no feed test had ever
    // inserted one. Left out here, screening rows leaked between tests and
    // a sweep that should have seen two photos saw three.
    entryPhotos,
    // The public bucket's record (design 163 step 8), which outlives the
    // photo rows on purpose; a test that copies a photo clears the bucket.
    publicPhotos,
    // products before brands: the report joins them, and a leaked brand
    // trips its UNIQUE(normalized) on the next test's insert. Neither was
    // in any reset helper, for the same reason entry_photos was not — no
    // earlier suite inserted one.
    products,
    brands,
    reports,
    reviewQueue,
    blocks,
    domainDenylist,
    // Where links landed (R-176): a landing left behind would deny the
    // next test's link the moment its domain was.
    linkLandings,
    photoScreenings,
    moderationActions,
    quarantinedContent,
    copyrightHolds,
    heldTakeDowns,
    outbox,
    usernameHistory,
  ]);
  await resetSharedTables();
}

/**
Runs one insert per row, in order, against the core database.
*/
async function times(
  n: number,
  insert: (core: ReturnType<typeof drizzle>) => PromiseLike<unknown>,
): Promise<void> {
  const core = drizzle(env.DIALED_CORE);
  for (let index = 0; index < n; index += 1) {
    await insert(core);
  }
}

/**
 * `n` rows of a cause in Review, each opened at `openedAt`: an hour's
 * holds, as the hold breakers count them (design 164).
 */
export async function opened(
  cause: (typeof reviewQueue.$inferInsert)["source"],
  n: number,
  openedAt: number,
  subjectType: ReviewSubjectType = "photo",
  hid?: number,
  /**
  A runner id, or "each" for a fresh one per row.
  */
  uploader?: string,
): Promise<void> {
  await times(n, (core) =>
    core.insert(reviewQueue).values({
      id: newUlid(),
      subjectType,
      subjectId: newUlid(),
      source: cause,
      status: "pending",
      createdAt: 1,
      openedAt,
      hid,
      // Whom the fingerprint breaker counts it against (design 232): a
      // subject this row names no longer exists, so its runner is the one
      // who settled it, as an owner's delete records. "each" gives every
      // row its own runner.
      resolvedBy: uploader === "each" ? newUlid() : uploader,
    }),
  );
}

/**
 * `n` screenings with one decision, each made at `createdAt`: an hour of
 * the classifier, as its breaker counts it (design 164).
 */
export async function screened(
  decision: (typeof photoScreenings.$inferInsert)["decision"],
  n: number,
  createdAt: number,
): Promise<void> {
  await times(n, (core) =>
    core.insert(photoScreenings).values({
      id: newUlid(),
      photoScope: "entry",
      photoId: newUlid(),
      model: "test",
      scores: "{}",
      decision,
      createdAt,
    }),
  );
}

/**
 * A shared product row, so a report can name one (design 232: a report
 * names something that exists). `id` lets a test reuse another subject's
 * id across types.
 */
export async function makeProduct(id: string = newUlid()): Promise<string> {
  await drizzle(env.DIALED_CORE)
    .insert(products)
    .values({
      id,
      brandId: newUlid(),
      name: "Some Shoe",
      normalizedName: "some shoe",
      createdBy: await makeUser(),
      createdAt: NOW,
    });
  return id;
}

/**
 * What a decision on a row that does not exist sends as shown: anything,
 * since the decision is answered as not found either way.
 */
export const anyShownRow: ShownRow = {
  openedAt: 0,
  source: "reports",
  readAt: 0,
};

/**
 * A Review row as a page that read it now would show it, which a decision
 * sends back.
 */
export async function shownRowOf(queueId: string): Promise<ShownRow> {
  const [row] = await drizzle(env.DIALED_CORE)
    .select({ openedAt: reviewQueue.openedAt, source: reviewQueue.source })
    .from(reviewQueue)
    .where(eq(reviewQueue.id, queueId));
  return row === undefined ? anyShownRow : { ...row, readAt: nowSeconds() };
}

/**
 * A handle on the core database whose first batch first lets `before`
 * land: the moment between a decision's read and its takedown.
 */
export function firstBatchAfter(before: () => Promise<unknown>) {
  const db = drizzle(env.DIALED_CORE);
  const batch = db.batch.bind(db);
  const seen = { batches: 0 };
  Reflect.set(
    db,
    "batch",
    async (...statements: Parameters<typeof db.batch>) => {
      seen.batches += 1;
      if (seen.batches === 1) await before();
      return batch(...statements);
    },
  );
  return db;
}
