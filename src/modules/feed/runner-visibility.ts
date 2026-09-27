import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { blocks } from "../../db/schema-core";

/**
 * W2's promise, for a runner rather than an entry: "They can't … find you
 * in search" and "You won't see them … in search" (FEED-7, D-107). No block
 * row between the viewer and the runner in `runnerId`, from either end.
 *
 * The entry form of this is `publiclyVisibleEntry(viewerId)` in
 * `modules/safety`, which probes the same row against an entry's author.
 * That helper is private to safety and bound to `outfit_entries.user_id`,
 * so search and H — whose subject is a profile row — cannot reuse it. The
 * probe is the same shape: one row, read from both ends, `blocks_pk`
 * leading on `blocker_id` and `blocks_blocked` on `blocked_id`, so a
 * `NOT EXISTS` per candidate is two index lookups and never a scan.
 */
export function runnerShownTo(viewerId: string, runnerId: SQLiteColumn): SQL {
  return sql`not exists (select 1 from ${blocks} where (${blocks.blockerId} = ${viewerId} and ${blocks.blockedId} = ${runnerId}) or (${blocks.blockerId} = ${runnerId} and ${blocks.blockedId} = ${viewerId}))`;
}
