/**
 * Whether the runner a column names has a confirmed address (design 133,
 * decision D-113 Q2), as a `WHERE` clause over that column. Here rather
 * than in account, which re-exports it, and beside the tables it reads, so every module that asks the
 * question (account, feed's search and H, safety's reports) reads one rule.
 */
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { user } from "./schema-auth";

/**
 * A primary-key probe on `user` per candidate, so it never scans. An absent
 * account is not confirmed, as account's `isVerified` reads it. For a
 * surface that shows one runner to another, where an unconfirmed runner
 * must not be found.
 */
export function runnerConfirmed(runnerId: SQLiteColumn): SQL {
  return sql`exists (select 1 from ${user} where ${user.id} = ${runnerId} and ${user.emailVerified} = 1)`;
}
