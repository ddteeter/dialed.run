/**
 * What a pending removal request holds, as SQL over `takedown_requests`:
 * read by the review queue's Approve and by an owner's delete (design
 * 232). Beside the review that reads it, since `takedowns` already reads
 * `review`.
 */
import { sql, type SQL } from "drizzle-orm";

import { takedownRequests } from "../../../db/schema-core";
import { qualified } from "../../../lib/sql/qualified";

/**
 * A pending request holds its subject: one that held it at
 * filing or at its confirm (`held_at`), whether it hid it then or it was
 * already out of public view. A request that was blocked, past the valve
 * or unconfirmed held nothing. True where some such request meets
 * `names`, a condition on `takedown_requests` with its columns
 * `qualified`, so it may be correlated with an outer read: what pins an
 * Approve, and what makes an owner's delete keep (design 232).
 */
export function requestHolds(names: SQL): SQL {
  const pending = sql`${qualified(takedownRequests, takedownRequests.status)} = 'pending'`;
  const held = sql`${qualified(takedownRequests, takedownRequests.heldAt)} is not null`;
  return sql`exists (select 1 from ${takedownRequests} where ${pending} and ${held} and ${names})`;
}
