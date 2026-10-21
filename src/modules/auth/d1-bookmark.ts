import { and, eq, gte, isNull, lt, or } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { nowSeconds } from "../../lib/now";
import { BOOKMARK_MAX_AGE_S } from "../../lib/sql/d1-session";
import { columnQuery } from "../../lib/sql/keyed-read";

type Db = ReturnType<typeof drizzle>;

/**
 * The runner's stored D1 bookmark (design 143): the newest point their
 * own writes reached, from any device. Built unexecuted, so the auth gate
 * sends it in the batch it already makes and it costs no round trip. A
 * seek on the primary key: at most one row.
 *
 * Only one stored in the last `BOOKMARK_MAX_AGE_S`: an older write is on
 * every replica already, and a very old bookmark is one D1 does not
 * document accepting. Filtered in SQL, so a stale one is simply no row.
 */
export function storedBookmarkOf(db: Db, userId: string, now = nowSeconds()) {
  return columnQuery(
    db,
    userProfiles,
    userProfiles.d1Bookmark,
    and(
      eq(userProfiles.userId, userId),
      gte(userProfiles.d1BookmarkAt, now - BOOKMARK_MAX_AGE_S),
    ),
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
  now = nowSeconds(),
): Promise<void> {
  const notNewer = or(
    isNull(userProfiles.d1Bookmark),
    lt(userProfiles.d1Bookmark, bookmark),
  );
  await db
    .update(userProfiles)
    .set({ d1Bookmark: bookmark, d1BookmarkAt: now })
    .where(and(eq(userProfiles.userId, userId), notNewer));
}
