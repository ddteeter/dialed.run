/**
 * Safety-lane fixtures.
 *
 * The entity factories are `test/feed/helpers.ts`'s, imported rather than
 * re-declared — a second `makeUser` would be the copy-then-rename a clone
 * detector is for, and these tests need exactly the rows that file already
 * knows how to build. What lives here is only the part feed has no reason
 * to know about: clearing task 106's own tables.
 */
import { drizzle } from "drizzle-orm/d1";

import {
  blocks,
  copyrightHolds,
  brands,
  domainDenylist,
  entryPhotos,
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
import type { HoldCause } from "../../src/modules/safety/breakers";
import type { ReviewSubjectType } from "../../src/modules/safety/review";

import {
  deleteAllFrom,
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
    photoScreenings,
    moderationActions,
    quarantinedContent,
    copyrightHolds,
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
  cause: HoldCause,
  n: number,
  openedAt: number,
  subjectType: ReviewSubjectType = "photo",
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
    }),
  );
}

/**
 * `n` screenings with one decision, each made at `createdAt`: an hour of
 * the classifier, as its breaker counts it (design 164).
 */
export async function screened(
  decision: "pass" | "review" | "flag",
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
