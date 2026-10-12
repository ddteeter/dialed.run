/**
 * The morning digest's two marks in `cron_checkpoints`, the table's
 * "when did this last happen", one row per name. Apart from the digest
 * itself so the Desk can read one without importing the email, which
 * imports the Desk's counts.
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { cronCheckpoints } from "../../db/schema-core";
import { firstColumnWhere } from "../../lib/sql/keyed-read";

type Db = ReturnType<typeof drizzle>;

/**
 * The day's digest was owed: written in the same batch as the debts, so a
 * firing re-run later that day owes nothing (`oweDigestEmail`).
 */
export const DIGEST_OWED = "digest-email";

/**
 * The day's digest skipped an operator whose address is not confirmed
 * (OPS-11): an address nobody has proved is theirs may be somebody
 * else's, and the digest says what is waiting at the Desk. Written in the
 * same batch as `DIGEST_OWED`, and read by Today, so the skip is on the
 * page the operator opens rather than in an email they never got.
 */
export const DIGEST_UNCONFIRMED = "digest-unconfirmed";

/**
When `name` was last marked (epoch seconds), or `undefined` for never.
*/
export async function markedAt(
  db: Db,
  name: typeof DIGEST_OWED | typeof DIGEST_UNCONFIRMED,
): Promise<number | undefined> {
  return firstColumnWhere(
    db,
    cronCheckpoints,
    cronCheckpoints.lastRunAt,
    eq(cronCheckpoints.cronName, name),
  );
}

/**
The statement that marks `name` at `now`, for the caller's batch.
*/
export function markStatement(
  db: Db,
  name: typeof DIGEST_OWED | typeof DIGEST_UNCONFIRMED,
  now: number,
) {
  return db
    .insert(cronCheckpoints)
    .values({ cronName: name, lastRunAt: now })
    .onConflictDoUpdate({
      target: cronCheckpoints.cronName,
      set: { lastRunAt: now },
    });
}
