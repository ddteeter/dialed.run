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
  domainDenylist,
  photoScreenings,
  reports,
  reviewQueue,
} from "../../src/db/schema-core";
import { env } from "../../src/env";

import { deleteAllFrom, resetTables as resetSharedTables } from "../feed/helpers";

export { makeEntry, makeRun, makeUser, NOW } from "../feed/helpers";

export async function resetSafetyTables(): Promise<void> {
  await deleteAllFrom(drizzle(env.DIALED_CORE), [
    reports,
    reviewQueue,
    blocks,
    domainDenylist,
    photoScreenings,
  ]);
  await resetSharedTables();
}
