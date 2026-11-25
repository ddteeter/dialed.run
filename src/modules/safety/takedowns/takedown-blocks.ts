/**
 * The blocks on `/takedown` (design 137), as the Desk lists and lifts
 * them. Block and decline all writes them (`./takedown-requests`); the
 * limits read them as a request is filed or confirmed.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { takedownBlocks, takedownRequests } from "../../../db/schema-core";
import { qualified } from "../../../lib/sql/qualified";
import { BLOCKED_REASON } from "./takedown-requests";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

export interface TakedownBlockListed {
  /**
  What Unblock names: an address's key, or a network's.
  */
  readonly key: string;
  readonly kind: "email" | "ip";
  readonly createdAt: number;
  /**
   * What an operator knows it by: an address's key is the address; a
   * network is known by the address on the request it was blocked from,
   * `undefined` once that request is gone.
   */
  readonly address: string | undefined;
}

/**
 * The newest `limit` blocks. A network's address is the request the
 * block declined at the moment it was made, read by `ip_key`'s index.
 */
export async function takedownBlocksListed(
  db: Db,
  limit = 50,
): Promise<TakedownBlockListed[]> {
  const blockedFrom = sql<
    string | null
  >`(select ${takedownRequests.requesterEmail} from ${takedownRequests} where ${and(
    sql`${qualified(takedownRequests, takedownRequests.ipKey)} = ${qualified(takedownBlocks, takedownBlocks.key)}`,
    eq(takedownRequests.declineReason, BLOCKED_REASON),
    sql`${qualified(takedownRequests, takedownRequests.resolvedAt)} = ${qualified(takedownBlocks, takedownBlocks.createdAt)}`,
  )} limit 1)`;
  const rows = await db
    .select({
      key: takedownBlocks.key,
      kind: takedownBlocks.kind,
      createdAt: takedownBlocks.createdAt,
      blockedFrom,
    })
    .from(takedownBlocks)
    .orderBy(desc(takedownBlocks.createdAt), asc(takedownBlocks.kind))
    .limit(limit);
  return rows.map((row) => ({
    key: row.key,
    kind: row.kind,
    createdAt: row.createdAt,
    address: row.kind === "email" ? row.key : (row.blockedFrom ?? undefined),
  }));
}

export type UnblockResult = "unblocked" | "not_found";

/**
 * Unblock: the key is no longer blocked, so what it files next hides
 * and alerts like any other request does.
 */
export async function unblockTakedownKey(
  db: Db,
  key: string,
): Promise<UnblockResult> {
  const lifted = await db
    .delete(takedownBlocks)
    .where(eq(takedownBlocks.key, key))
    .returning({ key: takedownBlocks.key });
  return lifted.length === 0 ? "not_found" : "unblocked";
}
