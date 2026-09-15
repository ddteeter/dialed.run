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
  brands,
  domainDenylist,
  entryPhotos,
  photoScreenings,
  products,
  reports,
  reviewQueue,
} from "../../src/db/schema-core";
import { env } from "../../src/env";

import { deleteAllFrom, resetTables as resetSharedTables } from "../feed/helpers";

export { makeEntry, makeItem, makeRun, makeUser, NOW } from "../feed/helpers";

export async function resetSafetyTables(): Promise<void> {
  await deleteAllFrom(drizzle(env.DIALED_CORE), [
    // entry_photos is NOT in feed/helpers' reset — no feed test had ever
    // inserted one. Left out here, screening rows leaked between tests and
    // a sweep that should have seen two photos saw three.
    entryPhotos,
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
  ]);
  await resetSharedTables();
}
