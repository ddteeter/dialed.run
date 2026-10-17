import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { columnQuery } from "../../lib/sql/keyed-read";

type Db = ReturnType<typeof drizzle>;

/**
 * The runner's stored D1 bookmark (design 143): the newest point their
 * own writes reached, from any device. Built unexecuted, so the auth gate
 * sends it in the batch it already makes and it costs no round trip. A
 * seek on the primary key: at most one row.
 */
export function storedBookmarkOf(db: Db, userId: string) {
  return columnQuery(
    db,
    userProfiles,
    userProfiles.d1Bookmark,
    eq(userProfiles.userId, userId),
  );
}

/**
 * Record `bookmark` for the runner, unless what is stored is already as
 * new. Compared in SQL, in the same order `newerBookmark` uses, so two
 * devices finishing at once cannot move it backwards. A runner with no
 * profile row yet has nothing to move forward, and a missing row is fine:
 * the next write after onboarding records one.
 */
export async function storeRunnerBookmark(
  db: Db,
  userId: string,
  bookmark: string,
): Promise<void> {
  const notNewer = or(
    isNull(userProfiles.d1Bookmark),
    lt(userProfiles.d1Bookmark, bookmark),
  );
  await db
    .update(userProfiles)
    .set({ d1Bookmark: bookmark })
    .where(and(eq(userProfiles.userId, userId), notNewer));
}
