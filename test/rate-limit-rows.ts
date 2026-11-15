import type { drizzle } from "drizzle-orm/d1";

import { rateLimits } from "../src/db/schema-core";
import type { RateLimitKind } from "../src/lib/contracts/rate-limits";

type Db = ReturnType<typeof drizzle>;

/**
 * Every count in `rate_limits` as `kind:subject`, sorted: one line for an
 * assertion to read, where the table itself has two columns.
 */
export async function countedKeys(db: Db): Promise<string[]> {
  const rows = await db
    .select({ kind: rateLimits.kind, subject: rateLimits.subject })
    .from(rateLimits);
  return rows
    .map((row) => `${row.kind}:${row.subject}`)
    .toSorted((a, b) => a.localeCompare(b));
}

/**
A count's row, for a test to insert as it stands.
*/
export function countRow(
  kind: RateLimitKind,
  subject: string,
  count: number,
  windowStartedAt: number,
) {
  return { kind, subject, count, windowStartedAt };
}
