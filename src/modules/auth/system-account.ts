import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { columnQuery } from "../../lib/sql/keyed-read";

type Db = ReturnType<typeof drizzle>;

/**
 * Whether this account is one the service runs (design 193, #533), as rows
 * of `{ value }`, unsent: the verification gate reads it in the batch it
 * already sends, so it costs no round trip. A primary-key seek; no profile
 * row reads as no row, which the gate takes as an ordinary runner.
 */
export function systemAccountOf(db: Db, userId: string) {
  return columnQuery(
    db,
    userProfiles,
    userProfiles.systemAccount,
    eq(userProfiles.userId, userId),
  );
}
